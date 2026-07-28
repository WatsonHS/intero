import { describe, expect, it } from "vitest";

import { consumeServerSentEvents } from "./sse.js";

describe("SSE parser", () => {
  it("parses events split across arbitrary byte chunks", async () => {
    const encoder = new TextEncoder();
    const chunks = [
      "event: rea",
      'dy\r\ndata: {"connected":',
      "true}\r\n\r\n: heartbeat\n\n",
      "event: inbox-changed\n",
      'data: {"reason":"action_inbox"}\n\n',
    ];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    const events: Array<{ event: string; data: string }> = [];

    await consumeServerSentEvents(stream, (event) => events.push(event));

    expect(events).toEqual([
      { event: "ready", data: '{"connected":true}' },
      {
        event: "inbox-changed",
        data: '{"reason":"action_inbox"}',
      },
    ]);
  });

  it("joins multiple data lines and ignores retry directives", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            "retry: 3000\nevent: inbox-changed\ndata: first\ndata: second\n\n",
          ),
        );
        controller.close();
      },
    });
    const events: Array<{ event: string; data: string }> = [];

    await consumeServerSentEvents(stream, (event) => events.push(event));

    expect(events).toEqual([{ event: "inbox-changed", data: "first\nsecond" }]);
  });
});
