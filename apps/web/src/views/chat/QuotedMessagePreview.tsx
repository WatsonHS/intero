import type { ThreadMessage } from "@intero/domain";

import { useI18n } from "../../i18n/index.js";
import { replyMessageSummary } from "./format.js";

export function QuotedMessagePreview({
  message,
  principalNames,
  onNavigate,
}: {
  message: ThreadMessage | undefined;
  principalNames: Map<string, string>;
  onNavigate(messageId: string): void;
}) {
  const { t } = useI18n();
  const senderName = message
    ? (principalNames.get(message.senderId) ?? message.senderId.slice(0, 8))
    : t("chat.replyUnavailable");
  return (
    <button
      type="button"
      data-testid="quoted-message-preview"
      disabled={!message}
      onClick={() => {
        if (message) onNavigate(message.id);
      }}
      className="mb-2 grid w-full cursor-pointer gap-0.5 rounded-[8px] border-0 border-l-2 border-accent-strong bg-black/[0.04] px-2.5 py-2 text-left disabled:cursor-default dark:bg-white/[0.05]"
    >
      <strong className="truncate text-[10.5px] font-[620] text-accent-strong">
        {senderName}
      </strong>
      <span className="truncate text-[11px] leading-[1.45] text-ink-muted">
        {replyMessageSummary(message, {
          attachment: t("chat.replyAttachment"),
          pdf: t("chat.replyPdf"),
          encrypted: t("chat.encryptedMessage"),
          unavailable: t("chat.replyUnavailable"),
          deleted: t("chat.messageDeleted"),
        })}
      </span>
    </button>
  );
}
