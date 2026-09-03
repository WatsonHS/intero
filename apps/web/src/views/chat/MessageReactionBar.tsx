import { ArrowBendUpLeftIcon, SmileyStickerIcon } from "@phosphor-icons/react";
import type { PrincipalId, ThreadMessage } from "@intero/domain";
import { useEffect } from "react";

import { FluentEmoji } from "../../components/FluentEmoji.js";
import { cn } from "../../design/primitives.js";
import { useI18n } from "../../i18n/index.js";
import { QUICK_REACTIONS } from "./constants.js";

export function MessageReactionBar({
  message,
  currentPrincipalId,
  principalNames,
  canReact,
  canReply,
  pickerOpen,
  pending,
  align,
  onToggle,
  onTogglePicker,
  onClosePicker,
  onReply,
}: {
  message: ThreadMessage;
  currentPrincipalId: PrincipalId | undefined;
  principalNames: Map<string, string>;
  canReact: boolean;
  canReply: boolean;
  pickerOpen: boolean;
  pending: boolean;
  align: "left" | "right";
  onToggle(emoji: string): void;
  onTogglePicker(): void;
  onClosePicker(): void;
  onReply(): void;
}) {
  const { t } = useI18n();
  const reactions = message.reactions ?? [];
  if (reactions.length === 0 && !canReact && !canReply) return null;

  return (
    <div
      data-testid={`message-reactions-${message.id}`}
      className={cn(
        "mt-1.5 flex min-h-6 flex-wrap items-center gap-1",
        align === "right" ? "justify-end" : "justify-start",
      )}
    >
      {reactions.map((reaction) => {
        const selected = Boolean(
          currentPrincipalId &&
          reaction.principalIds.includes(currentPrincipalId),
        );
        const names = reaction.principalIds.map(
          (principalId) =>
            principalNames.get(principalId) ?? principalId.slice(0, 8),
        );
        return (
          <button
            key={reaction.emoji}
            type="button"
            aria-label={t("chat.reactionSummary", {
              emoji: reaction.emoji,
              count: reaction.principalIds.length,
            })}
            aria-pressed={selected}
            title={names.join("、")}
            disabled={!canReact || pending}
            onClick={() => onToggle(reaction.emoji)}
            className={cn(
              "inline-flex h-6 cursor-pointer items-center gap-1 rounded-pill border px-2 text-[11px] transition-colors disabled:cursor-default disabled:opacity-70",
              selected
                ? "border-accent-strong bg-accent-soft text-accent-strong"
                : "border-line2 bg-panel2 text-ink-muted hover:border-accent-strong",
            )}
          >
            <FluentEmoji
              emoji={reaction.emoji}
              decorative
              className="text-[15px]"
            />
            <span className="font-mono text-[9.5px]">
              {reaction.principalIds.length}
            </span>
          </button>
        );
      })}
      {canReply ? (
        <button
          type="button"
          data-message-reply-trigger="true"
          aria-label={t("chat.reply")}
          title={t("chat.reply")}
          onClick={onReply}
          className="pointer-events-none grid h-6 w-6 cursor-pointer place-items-center rounded-full border border-line2 bg-transparent text-ink-muted opacity-0 transition-all duration-150 hover:border-accent-strong hover:text-accent-strong group-hover/message:pointer-events-auto group-hover/message:opacity-100 group-focus-within/message:pointer-events-auto group-focus-within/message:opacity-100"
        >
          <ArrowBendUpLeftIcon size={13} />
        </button>
      ) : null}
      {canReact ? (
        <div
          data-reaction-trigger="true"
          data-reaction-picker-container="true"
          className={cn(
            "relative pointer-events-none opacity-0 transition-opacity duration-150 group-hover/message:pointer-events-auto group-hover/message:opacity-100 group-focus-within/message:pointer-events-auto group-focus-within/message:opacity-100",
            pickerOpen ? "pointer-events-auto opacity-100" : undefined,
          )}
        >
          <button
            type="button"
            aria-label={t("chat.addReaction")}
            title={t("chat.addReaction")}
            aria-haspopup="menu"
            aria-expanded={pickerOpen}
            disabled={pending}
            onClick={onTogglePicker}
            className={cn(
              "grid h-6 w-6 cursor-pointer place-items-center rounded-full border text-ink-muted transition-colors disabled:cursor-wait disabled:opacity-50",
              pickerOpen
                ? "border-accent-strong bg-accent-soft text-accent-strong"
                : "border-line2 bg-transparent hover:border-accent-strong hover:text-accent-strong",
            )}
          >
            <SmileyStickerIcon size={13} />
          </button>
          {pickerOpen ? (
            <QuickReactionPicker
              align={align}
              onClose={onClosePicker}
              onSelect={onToggle}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function QuickReactionPicker({
  align,
  onClose,
  onSelect,
}: {
  align: "left" | "right";
  onClose(): void;
  onSelect(emoji: string): void;
}) {
  const { t } = useI18n();
  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (
        target instanceof Element &&
        !target.closest('[data-reaction-picker-container="true"]')
      ) {
        onClose();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [onClose]);

  return (
    <div
      role="menu"
      aria-label={t("chat.addReaction")}
      data-testid="message-reaction-picker"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose();
      }}
      className={cn(
        "absolute bottom-[30px] z-30 flex items-center gap-0.5 rounded-pill border border-line bg-panel p-1 shadow-[0_12px_34px_rgba(0,0,0,0.2)]",
        align === "right" ? "right-0" : "left-0",
      )}
    >
      {QUICK_REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          role="menuitem"
          aria-label={t("chat.reactWith", { emoji })}
          title={t("chat.reactWith", { emoji })}
          onClick={() => onSelect(emoji)}
          className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-[19px] hover:bg-raise focus-visible:bg-raise focus-visible:outline-2 focus-visible:outline-accent-strong"
        >
          <FluentEmoji emoji={emoji} decorative className="text-[21px]" />
        </button>
      ))}
    </div>
  );
}
