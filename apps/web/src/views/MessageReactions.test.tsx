import {
  MessageId,
  PrincipalId,
  ThreadId,
  type ThreadMessage,
} from "@intero/domain";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../i18n/index.js";
import { MessageReactionBar } from "./CommunicationsView.js";

describe("message reaction controls", () => {
  it("renders persisted counts, viewer selection, and the add control", () => {
    const viewerId = PrincipalId.parse("019f9ba4-3108-7000-8000-000000000001");
    const peerId = PrincipalId.parse("019f9ba4-3108-7000-8000-000000000002");
    const message = {
      id: MessageId.parse(crypto.randomUUID()),
      threadId: ThreadId.parse(crypto.randomUUID()),
      senderId: peerId,
      sequence: 1,
      kind: "message",
      body: "Ready.",
      createdAt: new Date().toISOString(),
      serverReadable: true,
      reactions: [
        { emoji: "👍", principalIds: [viewerId, peerId] },
        { emoji: "🎉", principalIds: [peerId] },
      ],
    } satisfies ThreadMessage;

    const output = renderToStaticMarkup(
      <I18nProvider>
        <MessageReactionBar
          message={message}
          currentPrincipalId={viewerId}
          principalNames={
            new Map([
              [viewerId, "Alex"],
              [peerId, "Priya"],
            ])
          }
          canReact
          canReply
          pickerOpen={false}
          pending={false}
          align="left"
          onToggle={vi.fn()}
          onTogglePicker={vi.fn()}
          onClosePicker={vi.fn()}
          onReply={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(output).toContain('aria-pressed="true"');
    expect(output).toContain('aria-pressed="false"');
    expect(output).toContain('data-fluent-emoji="👍"');
    expect(output).toContain('data-reaction-trigger="true"');
    expect(output).toContain('data-message-reply-trigger="true"');
    expect(output).toContain("opacity-0");
    expect(output).toContain("group-hover/message:opacity-100");
    expect(output).toContain(">2</span>");
    expect(output).toContain("添加表情反应");
    expect(output).toContain("引用回复");
    expect(output).toContain("Alex、Priya");
  });
});
