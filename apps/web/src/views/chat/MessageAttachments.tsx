import { CircleNotchIcon, FilePdfIcon } from "@phosphor-icons/react";
import type { ThreadMessageAttachment } from "@intero/domain";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { getAttachmentDownload } from "../../api.js";
import { cn } from "../../design/primitives.js";
import { useI18n } from "../../i18n/index.js";
import { PdfViewer } from "./PdfViewer.js";

export function MessageAttachments({
  attachments,
}: {
  attachments: ThreadMessageAttachment[];
}) {
  if (attachments.length === 0) return null;
  return (
    <div
      className={cn(
        "mt-2 grid w-[270px] max-w-full gap-2",
        attachments.length > 1 ? "grid-cols-2" : "grid-cols-1",
      )}
    >
      {attachments.map((attachment) =>
        attachment.contentType === "application/pdf" ? (
          <MessagePdf key={attachment.id} attachment={attachment} />
        ) : (
          <MessageImage key={attachment.id} attachment={attachment} />
        ),
      )}
    </div>
  );
}

function MessageImage({ attachment }: { attachment: ThreadMessageAttachment }) {
  const download = useQuery({
    queryKey: ["conversation-attachment", attachment.id],
    queryFn: ({ signal }) => getAttachmentDownload(attachment.id, signal),
    staleTime: 4 * 60_000,
  });
  if (!download.data?.downloadUrl) {
    return (
      <div className="grid min-h-[96px] place-items-center rounded-[10px] bg-raise text-[10.5px] text-ink-muted">
        {download.isError ? (
          attachment.fileName
        ) : (
          <CircleNotchIcon className="animate-spin" />
        )}
      </div>
    );
  }
  return (
    <a
      href={download.data.downloadUrl}
      target="_blank"
      rel="noreferrer noopener"
      className="group block min-w-0 overflow-hidden rounded-[10px] bg-raise"
      title={attachment.fileName}
    >
      <img
        src={download.data.downloadUrl}
        alt={attachment.fileName}
        loading="lazy"
        className="max-h-[360px] w-full object-contain transition-transform duration-200 group-hover:scale-[1.01]"
      />
    </a>
  );
}

function MessagePdf({ attachment }: { attachment: ThreadMessageAttachment }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const download = useQuery({
    queryKey: ["conversation-attachment", attachment.id],
    queryFn: ({ signal }) => getAttachmentDownload(attachment.id, signal),
    staleTime: 4 * 60_000,
  });
  const src = download.data?.downloadUrl;
  return (
    <>
      <button
        type="button"
        disabled={!src}
        onClick={() => {
          if (src) setOpen(true);
        }}
        title={attachment.fileName}
        aria-label={t("chat.openPdf")}
        className="flex min-h-[96px] w-full cursor-pointer items-center gap-3 rounded-[10px] border-0 bg-raise px-3 py-3 text-left hover:bg-hover-wash disabled:cursor-wait"
      >
        {src ? (
          <FilePdfIcon size={28} className="shrink-0 text-danger" />
        ) : (
          <CircleNotchIcon className="animate-spin text-ink-muted" />
        )}
        <span className="grid min-w-0">
          <strong className="truncate text-[12px] font-[620]">
            {attachment.fileName}
          </strong>
          <span className="text-[10.5px] text-faint">
            {t("chat.pdfPreview")}
          </span>
        </span>
      </button>
      {open && src ? (
        <PdfViewer
          title={attachment.fileName}
          src={src}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
