import {
  CaretDownIcon,
  CaretUpIcon,
  MagnifyingGlassIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { searchAuthorizedContent } from "../../api.js";
import { useI18n } from "../../i18n/index.js";

export function ThreadSearch({
  threadId,
  onClose,
  onSelectHit,
}: {
  threadId: string;
  onClose(): void;
  onSelectHit(input: { messageId: string; sequence: number }): void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const results = useQuery({
    queryKey: ["thread-message-search", threadId, query],
    queryFn: ({ signal }) =>
      searchAuthorizedContent(
        {
          query,
          types: ["message"],
          in: threadId,
        },
        signal,
      ),
    enabled: query.trim().length >= 2,
    staleTime: 5_000,
  });
  const hits = (results.data?.items ?? []).filter(
    (item) => item.messageId && item.sequence,
  );
  const active = hits[activeIndex];

  useEffect(() => {
    setActiveIndex(0);
  }, [query, threadId]);

  useEffect(() => {
    if (!active?.messageId || active.sequence === undefined) return;
    onSelectHit({ messageId: active.messageId, sequence: active.sequence });
  }, [active?.messageId, active?.sequence]);

  function move(delta: number) {
    if (hits.length === 0) return;
    setActiveIndex((current) => (current + delta + hits.length) % hits.length);
  }

  return (
    <div
      data-testid="thread-search"
      className="flex shrink-0 items-center gap-2 border-b border-line bg-panel2 px-[26px] py-2"
    >
      <MagnifyingGlassIcon size={14} className="text-faint" />
      <input
        autoFocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && event.shiftKey) {
            event.preventDefault();
            move(-1);
          } else if (event.key === "Enter") {
            event.preventDefault();
            move(1);
          } else if (event.key === "Escape") {
            onClose();
          }
        }}
        placeholder={t("chat.searchPlaceholder")}
        title={t("search.syntaxHint")}
        className="min-w-0 flex-1 border-0 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-faint"
      />
      <span className="text-[10.5px] text-faint">
        {query.trim().length < 2
          ? t("search.minChars")
          : results.isLoading
            ? t("search.searching")
            : hits.length === 0
              ? t("chat.searchNoHits")
              : t("chat.searchHits", {
                  current: activeIndex + 1,
                  total: hits.length,
                })}
      </span>
      <button
        type="button"
        aria-label={t("chat.searchPrevious")}
        disabled={hits.length === 0}
        onClick={() => move(-1)}
        className="grid h-7 w-7 place-items-center rounded-btn border border-line2 bg-transparent text-ink-muted hover:border-accent-strong hover:text-accent-strong disabled:opacity-40"
      >
        <CaretUpIcon size={13} />
      </button>
      <button
        type="button"
        aria-label={t("chat.searchNext")}
        disabled={hits.length === 0}
        onClick={() => move(1)}
        className="grid h-7 w-7 place-items-center rounded-btn border border-line2 bg-transparent text-ink-muted hover:border-accent-strong hover:text-accent-strong disabled:opacity-40"
      >
        <CaretDownIcon size={13} />
      </button>
      <button
        type="button"
        aria-label={t("general.close")}
        onClick={onClose}
        className="grid h-7 w-7 place-items-center rounded-btn border-0 bg-transparent text-faint hover:text-ink"
      >
        <XIcon size={13} />
      </button>
    </div>
  );
}
