import { GlobeSimpleIcon, XIcon } from "@phosphor-icons/react";
import type { LinkPreview, ThreadMessage } from "@intero/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getLinkPreviews, hideThreadMessagePreview } from "../../api.js";
import { cn } from "../../design/primitives.js";
import { useI18n } from "../../i18n/index.js";
import { replaceCachedThreadMessage, type ThreadListCache } from "./helpers.js";

export function MessageLinkPreviews({
  message,
  canHide,
}: {
  message: ThreadMessage;
  canHide: boolean;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const urls = message.previewsHidden ? [] : (message.previewUrls ?? []);
  const previews = useQuery({
    queryKey: ["link-previews", message.id, message.revision ?? 1, urls],
    queryFn: ({ signal }) => getLinkPreviews(urls, signal),
    enabled: urls.length > 0,
    staleTime: 5_000,
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      return items.some((item) => item.status === "ok") ? false : 2_000;
    },
  });
  const hide = useMutation({
    mutationFn: () =>
      hideThreadMessagePreview({
        threadId: message.threadId,
        messageId: message.id,
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData<ThreadListCache>(["threads"], (cached) =>
        replaceCachedThreadMessage(cached, updated),
      );
    },
  });
  const items = (previews.data?.items ?? []).filter(
    (item) => item.status === "ok",
  );
  if (items.length === 0) return null;
  return (
    <div className="mt-2 grid gap-2">
      {items.map((item) => (
        <LinkPreviewCard
          key={item.url}
          preview={item}
          canHide={canHide}
          hiding={hide.isPending}
          onHide={() => hide.mutate()}
          hideLabel={t("chat.hideLinkPreview")}
          imageLabel={t("chat.linkPreviewImage")}
          previewLabel={t("chat.linkPreview")}
        />
      ))}
    </div>
  );
}

function LinkPreviewCard({
  preview,
  canHide,
  hiding,
  onHide,
  hideLabel,
  imageLabel,
  previewLabel,
}: {
  preview: LinkPreview;
  canHide: boolean;
  hiding: boolean;
  onHide(): void;
  hideLabel: string;
  imageLabel: string;
  previewLabel: string;
}) {
  const host = safeHostname(preview.url);
  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noreferrer noopener"
      data-testid="link-preview"
      aria-label={preview.title ?? previewLabel}
      className="relative block overflow-hidden rounded-[10px] border border-line2 bg-raise text-left no-underline"
    >
      {preview.image?.startsWith("https:") ? (
        <img
          src={preview.image}
          alt={imageLabel}
          referrerPolicy="no-referrer"
          className="max-h-[140px] w-full object-cover"
        />
      ) : null}
      <span className="grid gap-1 p-[10px_12px]">
        <span className="flex items-center gap-1.5 text-[10.5px] text-faint">
          <GlobeSimpleIcon size={12} />
          {preview.siteName ?? host}
        </span>
        {preview.title ? (
          <strong className="line-clamp-2 text-[12.5px] font-[620] text-ink">
            {preview.title}
          </strong>
        ) : null}
        {preview.description ? (
          <span className="line-clamp-2 text-[11px] leading-[1.5] text-ink-muted">
            {preview.description}
          </span>
        ) : null}
      </span>
      {canHide ? (
        <button
          type="button"
          data-testid="hide-link-preview"
          aria-label={hideLabel}
          title={hideLabel}
          disabled={hiding}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onHide();
          }}
          className={cn(
            "absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full border-0 bg-black/55 text-white",
            "hover:bg-black/75 disabled:opacity-50",
          )}
        >
          <XIcon size={11} />
        </button>
      ) : null}
    </a>
  );
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
