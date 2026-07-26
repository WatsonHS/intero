import { CaretDownIcon } from "@phosphor-icons/react";

import { ScopeMark, SelectMenu } from "../../design/primitives.js";
import { useI18n } from "../../i18n/index.js";
import type { PilotTeamPayload } from "../../pilot/api.js";

/**
 * Names the team a surface is acting on, and lets it be changed in place.
 *
 * This is deliberately not the shell's scope: choosing whose roster to edit
 * should not move Team Pulse, chat and the project surfaces underneath the
 * reader. With a single team there is nothing to choose, so it renders as a
 * plain label rather than a menu that goes nowhere.
 */
export function TeamPicker({
  teams,
  value,
  onChange,
}: {
  teams: PilotTeamPayload[];
  value: PilotTeamPayload | undefined;
  onChange: (teamId: string) => void;
}) {
  const { t } = useI18n();
  if (!value) return null;
  const face = (
    <>
      <ScopeMark id={value.id} label={value.name} size="sm" filled />
      <strong className="truncate text-[12.5px] font-[620]">
        {value.name}
      </strong>
    </>
  );

  if (teams.length < 2) {
    return (
      <span className="inline-flex min-w-0 items-center gap-2">{face}</span>
    );
  }
  return (
    <SelectMenu
      label={t("admin.members.teamPicker")}
      value={value.id}
      onChange={onChange}
      options={teams.map((team) => ({
        id: team.id,
        label: team.name,
        leading: <ScopeMark id={team.id} label={team.name} size="sm" filled />,
      }))}
    >
      <span
        className="inline-flex h-8 min-w-0 items-center gap-2 rounded-btn border border-line bg-panel2 pl-1.5 pr-2.5 text-ink hover:border-accent-strong"
        data-testid="admin-members-team-picker"
      >
        {face}
        <CaretDownIcon size={9} className="shrink-0 opacity-70" />
      </span>
    </SelectMenu>
  );
}
