import type { PrincipalId, ThreadId } from "@intero/domain";
import type { FastifyInstance } from "fastify";
import { AccessToken } from "livekit-server-sdk";
import { z } from "zod";

import type { RequestAuth } from "./auth.js";
import type { PlatformStore } from "./platform-store.js";
import { PilotStoreError } from "./pilot-store.js";
import { threadChannel, userChannel } from "./realtime-routes.js";

export interface CallRoutesOptions {
  store: PlatformStore;
  requestAuth: RequestAuth;
  tokenIssuer?: CallTokenIssuer;
  eventPublisher?: CallEventPublisher;
}

export interface CallTokenIssuer {
  issue(input: {
    callId: string;
    threadId: ThreadId;
    principal: {
      id: PrincipalId;
      displayName: string;
    };
  }): Promise<{ serverUrl: string; roomName: string; token: string }>;
}

export interface CallEventPublisher {
  publish(channel: string, event: Record<string, unknown>): Promise<void>;
}

const CallTokenRequest = z
  .object({
    threadId: z.uuid(),
    callId: z.uuid(),
  })
  .strict();

const CallEventRequest = z
  .object({
    eventId: z.uuid(),
    threadId: z.uuid(),
    callId: z.uuid(),
    event: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("invite"),
          mode: z.enum(["audio", "video"]),
        })
        .strict(),
      z.object({ kind: z.literal("decline") }).strict(),
      z.object({ kind: z.literal("hangup") }).strict(),
    ]),
  })
  .strict();

export async function registerCallRoutes(
  app: FastifyInstance,
  options: CallRoutesOptions,
): Promise<void> {
  app.post("/v1/calls/token", async (request, reply) => {
    const principal = await options.requestAuth.resolve(request);
    const input = CallTokenRequest.parse(request.body);
    const threadId = input.threadId as ThreadId;
    await requireHumanThread(options.store, threadId, principal!.id);
    if (!options.tokenIssuer) {
      return reply.status(503).send({
        code: "CALLS_UNAVAILABLE",
        message: "LiveKit calling is not configured.",
      });
    }
    return options.tokenIssuer.issue({
      callId: input.callId,
      threadId,
      principal: {
        id: principal!.id,
        displayName: principal!.displayName,
      },
    });
  });

  app.post("/v1/calls/events", async (request, reply) => {
    const principal = await options.requestAuth.resolve(request);
    const input = CallEventRequest.parse(request.body);
    const threadId = input.threadId as ThreadId;
    const thread = await requireHumanThread(
      options.store,
      threadId,
      principal!.id,
    );
    if (!options.eventPublisher) {
      return reply.status(503).send({
        code: "CALLS_UNAVAILABLE",
        message: "Call invitations are not configured.",
      });
    }
    const event = {
      schemaVersion: 1,
      type: "conversation.call.event",
      eventId: input.eventId,
      threadId,
      callId: input.callId,
      senderId: principal!.id,
      event: input.event,
      occurredAt: new Date().toISOString(),
    };
    await options.eventPublisher.publish(threadChannel(threadId), event);
    if (input.event.kind === "invite" || input.event.kind === "hangup") {
      await Promise.all(
        thread.thread.participantIds
          .filter(
            (participantId) =>
              participantId !== principal!.id &&
              !thread.thread.standInIds.includes(participantId),
          )
          .map((participantId) =>
            options.eventPublisher!.publish(userChannel(participantId), event),
          ),
      );
    }
    return reply.status(202).send({ accepted: true });
  });
}

export class LiveKitCallTokenIssuer implements CallTokenIssuer {
  constructor(
    private readonly serverUrl: string,
    private readonly apiKey: string,
    private readonly apiSecret: string,
  ) {}

  async issue(input: {
    callId: string;
    threadId: ThreadId;
    principal: { id: PrincipalId; displayName: string };
  }): Promise<{ serverUrl: string; roomName: string; token: string }> {
    const roomName = `intero-call-${input.callId}`;
    const token = new AccessToken(this.apiKey, this.apiSecret, {
      identity: input.principal.id,
      name: input.principal.displayName,
      metadata: JSON.stringify({ threadId: input.threadId }),
      ttl: "10m",
    });
    token.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
      roomAdmin: false,
    });
    return {
      serverUrl: this.serverUrl,
      roomName,
      token: await token.toJwt(),
    };
  }
}

export class CentrifugoCallEventPublisher implements CallEventPublisher {
  constructor(
    private readonly apiUrl: string,
    private readonly apiKey: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async publish(
    channel: string,
    event: Record<string, unknown>,
  ): Promise<void> {
    const response = await this.fetcher(new URL("/api/publish", this.apiUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "x-centrifugo-error-mode": "transport",
      },
      body: JSON.stringify({ channel, data: event }),
      signal: AbortSignal.timeout(5_000),
    });
    const body = (await response.json()) as { error?: { code?: number } };
    if (!response.ok || body.error) {
      throw new Error(
        `centrifugo_publish_${body.error?.code ?? response.status}`,
      );
    }
  }
}

async function requireHumanThread(
  store: PlatformStore,
  threadId: ThreadId,
  principalId: PrincipalId,
) {
  const thread = await store.getThread(threadId, principalId);
  if (
    !thread ||
    thread.thread.standInIds.includes(principalId) ||
    thread.thread.concludedAt
  ) {
    throw new PilotStoreError("THREAD_NOT_FOUND", 404, "Thread was not found.");
  }
  return thread;
}
