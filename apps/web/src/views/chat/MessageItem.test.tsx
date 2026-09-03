import type { PrincipalId, ThreadMessage } from "@intero/domain";
import { uuidv7 } from "@intero/domain";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "../../i18n/index.js";
import type { ThreadPayload } from "../../api.js";
import { MessageItem } from "./MessageItem.js";

const ALEX = "019b5ac0-7600-7000-8000-000000000002" as PrincipalId;
const PRIYA = "019b5ac0-7600-7000-8000-000000000004" as PrincipalId;

function payload(message: ThreadMessage): ThreadPayload {
  return {
    thread: {
      id: message.threadId,
      kind: "room",
      title: "Room",
      participantIds: [ALEX, PRIYA],
      standInIds: [],
      accessMode: "agent_readable",
      priorHistoryGranted: false,
      sequence: message.sequence,
      createdAt: message.createdAt,
    },
    messages: [message],
    unreadCount: 0,
    mentionCount: 0,
    lastReadSequence: 0,
    principals: [],
    actions: [],
  };
}

describe("MessageItem deleted placeholder", () => {
  it("renders a deleted placeholder instead of the original body", () => {
    const message: ThreadMessage = {
      id: uuidv7() as ThreadMessage["id"],
      threadId: uuidv7() as ThreadMessage["threadId"],
      senderId: ALEX,
      sequence: 1,
      kind: "message",
      body: "",
      createdAt: "2026-09-03T12:00:00.000Z",
      serverReadable: true,
      deletedAt: "2026-09-03T12:01:00.000Z",
    };
    const html = renderToStaticMarkup(
      <I18nProvider>
        <MessageItem
          message={message}
          current={payload(message)}
          currentSenderId={PRIYA}
          currentIsPilot={false}
          currentIsPilotStandIn={false}
          currentIsCanonicalGroup={false}
          principalNames={new Map([[ALEX, "Alex"]])}
          principals={[]}
          standInOwnerIds={new Map()}
          mentionCandidates={[]}
          expanded={new Set()}
          reactionPickerMessageId={undefined}
          reactionPending={false}
          reactionPendingMessageId={undefined}
          pilotStandInExchanges={[]}
          onToggleExpanded={() => undefined}
          onToggleReaction={() => undefined}
          onToggleReactionPicker={() => undefined}
          onCloseReactionPicker={() => undefined}
          onReply={() => undefined}
          onNavigateToMessage={() => undefined}
          onOpenProfile={() => undefined}
        />
      </I18nProvider>,
    );
    expect(html).toContain('data-testid="message-deleted"');
    expect(html).toContain("此消息已删除");
    expect(html).not.toContain("Original secret");
  });
});
