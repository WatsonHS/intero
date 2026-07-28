import { CircleNotchIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { FluentEmoji, hasFluentEmoji } from "../../components/FluentEmoji.js";
import { cn } from "../../design/primitives.js";
import { useI18n } from "../../i18n/index.js";
import type { TranslationKey } from "../../i18n/locales/zh-CN.js";

interface EmojiRecord {
  group?: number;
  hexcode: string;
  label: string;
  shortcodes?: string[];
  tags?: string[];
  unicode: string;
}

const EMOJI_GROUPS: Array<{
  group: number;
  icon: string;
  label: TranslationKey;
}> = [
  { group: 0, icon: "😀", label: "chat.emojiGroupSmileys" },
  { group: 1, icon: "👋", label: "chat.emojiGroupPeople" },
  { group: 3, icon: "🐻", label: "chat.emojiGroupNature" },
  { group: 4, icon: "🍎", label: "chat.emojiGroupFood" },
  { group: 5, icon: "🚗", label: "chat.emojiGroupTravel" },
  { group: 6, icon: "⚽", label: "chat.emojiGroupActivities" },
  { group: 7, icon: "💡", label: "chat.emojiGroupObjects" },
  { group: 8, icon: "🔣", label: "chat.emojiGroupSymbols" },
  { group: 9, icon: "🏳️", label: "chat.emojiGroupFlags" },
];

export function EmojiPicker({
  onClose,
  onSelect,
}: {
  onClose(): void;
  onSelect(emoji: string): void;
}) {
  const { locale, t } = useI18n();
  const [emojis, setEmojis] = useState<EmojiRecord[]>([]);
  const [activeGroup, setActiveGroup] = useState(0);
  const [query, setQuery] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setEmojis([]);
    setLoadFailed(false);
    void loadEmojiData(locale)
      .then((data) => {
        if (!cancelled) {
          setEmojis(
            data.filter(
              (emoji) => emoji.group != null && hasFluentEmoji(emoji.unicode),
            ),
          );
        }
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (
        target instanceof Element &&
        !target.closest('[data-emoji-picker-container="true"]')
      ) {
        onClose();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [onClose]);

  const normalizedQuery = query.trim().toLocaleLowerCase(locale);
  const visibleEmojis = useMemo(() => {
    if (!normalizedQuery) {
      return emojis.filter((emoji) => emoji.group === activeGroup);
    }
    return emojis
      .filter((emoji) => {
        const searchable = [
          emoji.label,
          ...(emoji.tags ?? []),
          ...(emoji.shortcodes ?? []),
        ]
          .join(" ")
          .toLocaleLowerCase(locale);
        return searchable.includes(normalizedQuery);
      })
      .slice(0, 400);
  }, [activeGroup, emojis, locale, normalizedQuery]);

  function handlePanelKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    onClose();
  }

  function keepComposerSelection(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
  }

  return (
    <div
      role="dialog"
      aria-label={t("chat.emoji")}
      data-testid="communications-emoji-picker"
      onKeyDown={handlePanelKeyDown}
      className="absolute bottom-[32px] left-0 z-30 flex h-[370px] w-[min(360px,calc(100vw-52px))] flex-col overflow-hidden rounded-card border border-line bg-panel shadow-[0_18px_52px_rgba(0,0,0,0.24)]"
    >
      <div className="border-b border-line2 p-2.5">
        <label className="flex h-8 items-center gap-2 rounded-[9px] bg-raise px-2.5 text-ink-muted">
          <MagnifyingGlassIcon size={13} aria-hidden="true" />
          <span className="sr-only">{t("chat.emojiSearch")}</span>
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={t("chat.emojiSearch")}
            className="min-w-0 flex-1 border-0 bg-transparent text-[11.5px] text-ink outline-none placeholder:text-faint"
          />
        </label>
      </div>

      <div
        role="tablist"
        aria-label={t("chat.emojiGroups")}
        className="grid grid-cols-9 border-b border-line2 px-1.5"
      >
        {EMOJI_GROUPS.map((group) => (
          <button
            key={group.group}
            type="button"
            role="tab"
            title={t(group.label)}
            aria-label={t(group.label)}
            aria-selected={!normalizedQuery && activeGroup === group.group}
            onClick={() => {
              setQuery("");
              setActiveGroup(group.group);
            }}
            className={cn(
              "relative grid h-9 cursor-pointer place-items-center border-0 bg-transparent text-[16px] after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:rounded-full",
              !normalizedQuery && activeGroup === group.group
                ? "bg-raise after:bg-accent-strong"
                : "after:bg-transparent hover:bg-raise",
            )}
          >
            <FluentEmoji
              emoji={group.icon}
              decorative
              className="text-[18px]"
            />
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {emojis.length === 0 && !loadFailed ? (
          <div className="grid h-full place-items-center text-faint">
            <span className="inline-flex items-center gap-2 text-[11px]">
              <CircleNotchIcon size={14} className="animate-spin" />
              {t("chat.emojiLoading")}
            </span>
          </div>
        ) : loadFailed ? (
          <div
            role="alert"
            className="grid h-full place-items-center px-6 text-center text-[11px] text-danger"
          >
            {t("chat.emojiLoadFailed")}
          </div>
        ) : visibleEmojis.length === 0 ? (
          <div className="grid h-full place-items-center text-[11px] text-faint">
            {t("chat.emojiNoResults")}
          </div>
        ) : (
          <div className="grid grid-cols-8 gap-0.5">
            {visibleEmojis.map((emoji) => (
              <button
                key={emoji.hexcode}
                type="button"
                title={emoji.label}
                aria-label={emoji.label}
                onPointerDown={keepComposerSelection}
                onClick={() => onSelect(emoji.unicode)}
                className="grid aspect-square cursor-pointer place-items-center rounded-[8px] border-0 bg-transparent text-[22px] hover:bg-raise focus-visible:bg-raise focus-visible:outline-2 focus-visible:outline-accent-strong"
              >
                <FluentEmoji
                  emoji={emoji.unicode}
                  decorative
                  className="text-[25px]"
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

async function loadEmojiData(locale: "zh-CN" | "en-US") {
  const data =
    locale === "zh-CN"
      ? await import("emojibase-data/zh/compact.json")
      : await import("emojibase-data/en/compact.json");
  return data.default as EmojiRecord[];
}
