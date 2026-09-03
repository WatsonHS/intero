import { CircleNotchIcon } from "@phosphor-icons/react";
import type { ThreadMessageAttachment } from "@intero/domain";
import { useQuery } from "@tanstack/react-query";

import { getAttachmentDownload } from "../../api.js";
import { cn } from "../../design/primitives.js";

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
      {attachments.map((attachment) => (
        <MessageImage key={attachment.id} attachment={attachment} />
      ))}
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
