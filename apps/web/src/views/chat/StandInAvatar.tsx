import { CircleNotchIcon, RobotIcon } from "@phosphor-icons/react";

import { initials, tintFor } from "../../design/utils.js";

export function StandInAvatar({
  ownerId,
  ownerName,
  busy = false,
}: {
  ownerId: string;
  ownerName: string;
  busy?: boolean;
}) {
  return (
    <span className="relative block h-[30px] w-[30px] shrink-0">
      <span
        className="grid h-[30px] w-[30px] place-items-center rounded-[9px_13px_9px_9px] text-[10px] font-[650] text-on-tint"
        style={{ background: tintFor(ownerId) }}
        title={ownerName}
      >
        {busy ? (
          <CircleNotchIcon size={15} className="animate-spin" />
        ) : (
          initials(ownerName)
        )}
      </span>
      <span className="absolute -bottom-0.5 -right-0.5 grid h-[13px] w-[13px] place-items-center rounded-full border-2 border-panel bg-accent-soft text-accent-strong">
        <RobotIcon size={8} weight="fill" aria-hidden="true" />
      </span>
    </span>
  );
}
