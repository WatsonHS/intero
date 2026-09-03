import type { ThreadMessage } from "@intero/domain";

import { isEmojiOnlyMessage } from "../../components/ChatMarkdown.js";

export function insertEmojiAtCursor(
  draft: string,
  cursor: number,
  emoji: string,
): { draft: string; cursor: number } {
  const insertionPoint = Math.max(0, Math.min(cursor, draft.length));
  return {
    draft: draft.slice(0, insertionPoint) + emoji + draft.slice(insertionPoint),
    cursor: insertionPoint + emoji.length,
  };
}

export function isBubblelessEmojiMessage(
  message: Pick<
    ThreadMessage,
    "attachments" | "body" | "replyToMessageId" | "serverReadable"
  >,
): boolean {
  return (
    message.serverReadable &&
    (message.attachments?.length ?? 0) === 0 &&
    !message.replyToMessageId &&
    isEmojiOnlyMessage(message.body)
  );
}

export function shouldSubmitComposerKey(input: {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
}): boolean {
  return input.key === "Enter" && !input.shiftKey && !input.isComposing;
}

export function replyMessageSummary(
  message: ThreadMessage | undefined,
  labels: {
    attachment: string;
    pdf: string;
    encrypted: string;
    unavailable: string;
  },
): string {
  if (!message) return labels.unavailable;
  if (!message.serverReadable) return labels.encrypted;
  const body = message.body.replaceAll(/\s+/gu, " ").trim();
  if (body) return body;
  if (!message.attachments?.length) return labels.unavailable;
  return message.attachments[0]?.contentType === "application/pdf"
    ? labels.pdf
    : labels.attachment;
}
