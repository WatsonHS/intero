import type { OrganizationId, PrincipalId } from "@intero/domain";
import { afterEach, describe, expect, it } from "vitest";

import type {
  ActionInboxChangedEvent,
  ActionInboxEventListener,
  ActionInboxEventSource,
} from "./action-inbox-events.js";
import { buildTestApp } from "./test-app.js";
import { InMemoryPlatformStore } from "./store.js";

class ManualActionInboxEvents implements ActionInboxEventSource {
  private readonly listeners = new Map<string, Set<ActionInboxEventListener>>();

  subscribe(
    principalId: PrincipalId,
    listener: ActionInboxEventListener,
  ): () => void {
    const listeners =
      this.listeners.get(principalId) ?? new Set<ActionInboxEventListener>();
    listeners.add(listener);
    this.listeners.set(principalId, listeners);
    return () => listeners.delete(listener);
  }

  emit(event: ActionInboxChangedEvent): void {
    for (const listener of this.listeners.get(event.principalId) ?? []) {
      listener(event);
    }
  }
}

describe("Action Inbox SSE route", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>> | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it("streams only a wake-up signal to the authenticated principal", async () => {
    const events = new ManualActionInboxEvents();
    const principalId = "019b5ac0-7600-7000-8000-000000000002" as PrincipalId;
    app = await buildTestApp({
      store: new InMemoryPlatformStore(),
      actionInboxEvents: events,
      logger: false,
    });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const abort = new AbortController();
    const response = await fetch(`${address}/v1/action-inbox/events`, {
      headers: {
        origin: "http://127.0.0.1:5173",
        "x-intero-dev-principal-id": principalId,
      },
      signal: abort.signal,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://127.0.0.1:5173",
    );
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    expect(await readUntil(reader, decoder, "event: ready")).toContain(
      "connectedAt",
    );

    events.emit({
      organizationId: "019b5ac0-7600-7000-8000-000000000001" as OrganizationId,
      principalId,
      reason: "action_inbox",
      occurredAt: "2026-07-28T05:00:00.000Z",
    });
    const changed = await readUntil(reader, decoder, "event: inbox-changed");
    expect(changed).toContain('"reason":"action_inbox"');
    expect(changed).not.toContain("title");
    expect(changed).not.toContain("detail");

    abort.abort();
    await reader.cancel().catch(() => undefined);
  });
});

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  expected: string,
): Promise<string> {
  let received = "";
  while (!received.includes(expected)) {
    const result = await reader.read();
    if (result.done) break;
    received += decoder.decode(result.value, { stream: true });
  }
  return received;
}
