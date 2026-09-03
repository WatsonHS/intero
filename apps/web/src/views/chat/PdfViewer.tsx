import { DownloadSimpleIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { useI18n } from "../../i18n/index.js";

export function PdfViewer({
  title,
  src,
  onClose,
}: {
  title: string;
  src: string;
  onClose(): void;
}) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const focusable = [
        ...root.querySelectorAll<HTMLElement>(
          'button, [href], iframe, [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((node) => !node.hasAttribute("disabled"));
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previousFocus.current?.focus();
    };
  }, [onClose]);

  return createPortal(
    <div className="animate-view-enter fixed inset-0 z-[70] grid place-items-center bg-black/55 p-4">
      <span className="absolute inset-0" onClick={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative grid h-[min(90vh,860px)] w-[min(920px,100%)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-[18px] border border-line2 bg-panel2 shadow-[0_40px_90px_rgba(0,0,0,0.5)]"
      >
        <div className="flex items-center gap-2 px-4 py-3">
          <strong className="min-w-0 truncate text-[14px] font-[620]">
            {title}
          </strong>
          <a
            href={src}
            download={title}
            className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-line2 px-3 text-[11.5px] text-ink-muted no-underline hover:border-accent-strong hover:text-accent-strong"
          >
            <DownloadSimpleIcon size={14} />
            {t("chat.downloadPdf")}
          </a>
          <button
            ref={closeRef}
            type="button"
            aria-label={t("chat.closePdf")}
            title={t("chat.closePdf")}
            onClick={onClose}
            className="grid h-8 w-8 cursor-pointer place-items-center rounded-[8px] border-0 bg-transparent text-faint hover:bg-hover-wash hover:text-ink"
          >
            <XIcon size={16} />
          </button>
        </div>
        <iframe
          title={title}
          src={src}
          className="h-full w-full border-0 bg-raise"
        />
      </div>
    </div>,
    document.body,
  );
}
