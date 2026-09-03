import { useI18n } from "../../i18n/index.js";
import type { ConversationRealtimeStatus } from "../../realtime/coordinator.js";
import { REALTIME_STATUS } from "./constants.js";

export function RealtimeDeliveryStatus({
  status,
}: {
  status: ConversationRealtimeStatus;
}) {
  const { t } = useI18n();
  const presentation = REALTIME_STATUS[status];
  const tone =
    presentation.tone === "green"
      ? "bg-green-soft text-green"
      : presentation.tone === "amber"
        ? "bg-amber-soft text-amber"
        : presentation.tone === "danger"
          ? "bg-danger-soft text-danger"
          : "bg-raise text-faint";

  return (
    <span
      role="status"
      title={t(presentation.detail)}
      data-testid="conversation-realtime-status"
      data-status={status}
      className={`inline-flex items-center gap-1.5 rounded-pill px-2 py-1 text-[9.5px] font-[620] ${tone}`}
    >
      <i
        aria-hidden="true"
        className={[
          "h-1.5 w-1.5 rounded-full bg-current",
          status === "connecting" ? "animate-pulse" : "",
        ].join(" ")}
      />
      {t(presentation.label)}
    </span>
  );
}
