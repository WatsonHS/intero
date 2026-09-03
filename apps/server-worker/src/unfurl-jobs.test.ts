import type { LinkPreview, ThreadMessage } from "@intero/domain";
import { MessageId, OrganizationId, ThreadId, uuidv7 } from "@intero/domain";
import { describe, expect, it, vi } from "vitest";

import { UnfurlJobHandler, fetchUnfurlHtml } from "./unfurl-jobs.js";
import { UnfurlBlockedError } from "./unfurl-guard.js";

const organizationId = OrganizationId.parse(
  "019b5ac0-7600-7000-8000-000000000001",
);
const threadId = ThreadId.parse(uuidv7());
const messageId = MessageId.parse(uuidv7());

describe("fetchUnfurlHtml", () => {
  it("re-checks each redirect hop and refuses a private target", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const href = String(input);
      if (href === "https://public.example/start") {
        return new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1/secret" },
        });
      }
      throw new Error(`unexpected fetch ${href}`);
    });
    await expect(
      fetchUnfurlHtml("https://public.example/start", {
        fetch: fetchImpl as unknown as typeof fetch,
        lookup: async () => [{ address: "93.184.216.34", family: 4 }],
        denyHosts: new Set(),
      }),
    ).rejects.toBeInstanceOf(UnfurlBlockedError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("follows at most three redirects", async () => {
    let hops = 0;
    const fetchImpl = vi.fn(async () => {
      hops += 1;
      return new Response(null, {
        status: 302,
        headers: { location: `https://public.example/hop-${hops}` },
      });
    });
    await expect(
      fetchUnfurlHtml("https://public.example/start", {
        fetch: fetchImpl as unknown as typeof fetch,
        lookup: async () => [{ address: "93.184.216.34", family: 4 }],
        denyHosts: new Set(),
      }),
    ).rejects.toThrow("redirect_limit");
    expect(hops).toBe(4);
  });
});

describe("UnfurlJobHandler", () => {
  it("caches public metadata and attaches preview URLs", async () => {
    const putLinkPreview = vi.fn(async (preview: LinkPreview) => preview);
    const attachMessagePreviewUrls = vi.fn(async () => ({}) as ThreadMessage);
    const handler = new UnfurlJobHandler({
      conversations: {
        getThread: async () =>
          ({ thread: { id: threadId, accessMode: "agent_readable" } }) as never,
        getStoredThreadMessage: async () =>
          ({
            id: messageId,
            threadId,
            serverReadable: true,
            body: "See https://example.com/docs",
            previewUrls: ["https://example.com/docs"],
          }) as ThreadMessage,
        getLinkPreviews: async () => [],
        putLinkPreview,
        attachMessagePreviewUrls,
      },
      fetch: (async () =>
        new Response(
          `<html><head><title>Docs</title><meta property="og:title" content="Example docs"></head></html>`,
          { status: 200, headers: { "content-type": "text/html" } },
        )) as typeof fetch,
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      denyHosts: new Set(),
      now: () => new Date("2026-09-03T00:00:00.000Z"),
    });

    await handler.handle({
      schemaVersion: 1,
      organizationId,
      threadId,
      messageId,
    });

    expect(putLinkPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://example.com/docs",
        status: "ok",
        title: "Example docs",
      }),
    );
    expect(attachMessagePreviewUrls).toHaveBeenCalledWith(threadId, messageId, [
      "https://example.com/docs",
    ]);
  });

  it("skips human-only threads and ciphertext", async () => {
    const putLinkPreview = vi.fn();
    const handler = new UnfurlJobHandler({
      conversations: {
        getThread: async () =>
          ({
            thread: { id: threadId, accessMode: "human_only_e2ee" },
          }) as never,
        getStoredThreadMessage: async () =>
          ({ serverReadable: false }) as ThreadMessage,
        getLinkPreviews: async () => [],
        putLinkPreview,
        attachMessagePreviewUrls: vi.fn(),
      },
    });
    await handler.handle({
      schemaVersion: 1,
      organizationId,
      threadId,
      messageId,
    });
    expect(putLinkPreview).not.toHaveBeenCalled();
  });
});
