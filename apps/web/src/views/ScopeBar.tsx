import {
  CaretDownIcon,
  CaretRightIcon,
  CheckIcon,
  PlusIcon,
} from "@phosphor-icons/react";
import { useRef, useState } from "react";

import {
  Meta,
  Popover,
  ScopeMark,
  StatusPill,
  cn,
} from "../design/primitives.js";
import { tintFor } from "../design/utils.js";
import { useI18n } from "../i18n/index.js";
import type { TranslationKey } from "../i18n/locales/zh-CN.js";
import { projectInTeam, usePilotOptional } from "../pilot/context.js";

interface ScopeEntry {
  id: string;
  name: string;
  /** Monospace second line — the identifying facts, never prose. */
  meta: string;
  /** Plain-language third line describing your standing in this scope. */
  note: string;
  /** Count of inbox items waiting on you inside this scope. */
  pending: number;
}

/**
 * Titlebar breadcrumb: organization › team › project — view.
 *
 * The team and project chips are the app's scope switchers. Project only
 * appears for the views that are actually project-scoped (Spec Review, 项目),
 * because switching a project has no meaning on the org-wide surfaces.
 */
export function ScopeBar({
  viewTitle,
  projectScoped,
  pendingByProject,
  onCreateProject,
  onSelectProject,
  onSelectTeam,
}: {
  viewTitle: string;
  projectScoped: boolean;
  pendingByProject: Map<string, number>;
  /** Omitted when this deployment has no project-creation path to offer. */
  onCreateProject?: (() => void) | undefined;
  onSelectProject?: ((projectId: string) => void) | undefined;
  onSelectTeam?: ((teamId: string) => void) | undefined;
}) {
  const { t } = useI18n();
  const pilot = usePilotOptional();
  const teamRef = useRef<HTMLButtonElement>(null);
  const projectRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState<"team" | "project">();
  const [anchor, setAnchor] = useState<DOMRect>();

  const teams = pilot?.teams.data?.teams ?? [];
  const projects = pilot?.projects.data?.projects ?? [];
  const teamId = pilot?.selectedTeamId;
  const projectId = pilot?.selectedProjectId;
  const team = teams.find((candidate) => candidate.id === teamId);
  const project = projects.find((candidate) => candidate.id === projectId);

  function pendingForTeam(id: string): number {
    return projects
      .filter((candidate) => projectInTeam(candidate, id))
      .reduce(
        (total, candidate) => total + (pendingByProject.get(candidate.id) ?? 0),
        0,
      );
  }

  // The dot on the team chip means "somewhere you are not looking needs you".
  const pendingElsewhere = teams.some(
    (candidate) => candidate.id !== teamId && pendingForTeam(candidate.id) > 0,
  );

  const teamEntries: ScopeEntry[] = teams.map((candidate) => {
    const you = candidate.members.find(
      (member) => member.id === pilot?.identityId,
    );
    const leader = candidate.members.find(
      (member) => member.teamRole === "leader",
    );
    return {
      id: candidate.id,
      name: candidate.name,
      meta: t("scope.teamMeta", {
        people: candidate.members.length,
        projects: projects.filter((entry) => projectInTeam(entry, candidate.id))
          .length,
      }),
      note:
        you?.teamRole === "leader"
          ? t("scope.youLeadTeam")
          : leader
            ? t("scope.teamLedBy", { name: leader.displayName })
            : t("scope.teamNoLeader"),
      pending: pendingForTeam(candidate.id),
    };
  });

  const projectEntries: ScopeEntry[] = projects
    .filter((candidate) => !teamId || projectInTeam(candidate, teamId))
    .map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      meta: t("scope.projectMeta", {
        teams: candidate.participatingTeamIds.length,
      }),
      note: t(`scope.posture.${candidate.posture}` as TranslationKey),
      pending: pendingByProject.get(candidate.id) ?? 0,
    }));

  function toggle(which: "team" | "project") {
    if (open === which) {
      setOpen(undefined);
      return;
    }
    const element = which === "team" ? teamRef.current : projectRef.current;
    setAnchor(element?.getBoundingClientRect());
    setOpen(which);
  }

  const showProject = projectScoped && Boolean(project);

  return (
    <span className="flex min-w-0 items-center gap-[3px] [-webkit-app-region:no-drag]">
      <span
        data-testid="app-brand"
        className="whitespace-nowrap px-[3px] text-[11.5px] font-[570] text-ink-muted"
      >
        Intero
      </span>

      {team ? (
        <>
          <CaretRightIcon size={10} className="text-faint" aria-hidden="true" />
          <button
            ref={teamRef}
            type="button"
            title={t("scope.switchTeam")}
            aria-haspopup="dialog"
            aria-expanded={open === "team"}
            onClick={() => toggle("team")}
            className={cn(
              "relative inline-flex h-6 cursor-pointer items-center gap-[5px] whitespace-nowrap rounded-[7px] border-0 px-2 text-[11.5px] font-[570]",
              open === "team"
                ? "bg-sel text-ink"
                : "bg-transparent text-ink hover:bg-hover-wash",
            )}
          >
            {team.name}
            {pendingElsewhere ? (
              <span
                title={t("scope.elsewhereWaiting")}
                className="h-1.5 w-1.5 rounded-full bg-danger"
              />
            ) : null}
            <CaretDownIcon size={9} className="opacity-65" aria-hidden="true" />
          </button>
        </>
      ) : null}

      {showProject && project ? (
        <>
          <CaretRightIcon size={10} className="text-faint" aria-hidden="true" />
          <button
            ref={projectRef}
            type="button"
            title={t("scope.switchProject")}
            aria-haspopup="dialog"
            aria-expanded={open === "project"}
            onClick={() => toggle("project")}
            className={cn(
              "inline-flex h-6 cursor-pointer items-center gap-[5px] whitespace-nowrap rounded-[7px] border-0 px-2 text-[11.5px] font-[570] text-ink",
              open === "project"
                ? "bg-sel"
                : "bg-transparent hover:bg-hover-wash",
            )}
          >
            <span
              className="h-[7px] w-[7px] rounded-[2px]"
              style={{ background: tintFor(project.id) }}
              aria-hidden="true"
            />
            {project.name}
            <CaretDownIcon size={9} className="opacity-65" aria-hidden="true" />
          </button>
        </>
      ) : null}

      <span className="mx-[5px] text-[11.5px] text-faint" aria-hidden="true">
        —
      </span>
      <span className="min-w-0 truncate text-[11.5px] text-ink-muted">
        {viewTitle}
      </span>

      {open ? (
        <Popover anchor={anchor} onClose={() => setOpen(undefined)}>
          <ScopeList
            title={t(open === "team" ? "scope.teams" : "scope.projects")}
            hint={t("scope.switchHint")}
            entries={open === "team" ? teamEntries : projectEntries}
            activeId={open === "team" ? teamId : projectId}
            onPick={(id) => {
              if (open === "team") {
                pilot?.setSelectedTeamId(id);
                onSelectTeam?.(id);
              } else {
                pilot?.setSelectedProjectId(id);
                onSelectProject?.(id);
              }
              setOpen(undefined);
            }}
            {...(open === "project" && onCreateProject
              ? {
                  addLabel: t("scope.newProject"),
                  onAdd: () => {
                    setOpen(undefined);
                    onCreateProject();
                  },
                }
              : {})}
          />
        </Popover>
      ) : null}
    </span>
  );
}

function ScopeList({
  title,
  hint,
  entries,
  activeId,
  addLabel,
  onAdd,
  onPick,
}: {
  title: string;
  hint: string;
  entries: ScopeEntry[];
  activeId: string | undefined;
  addLabel?: string;
  onAdd?: () => void;
  onPick: (id: string) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <div className="flex items-center justify-between px-2 pb-[9px] pt-1">
        <Meta className="text-[9.5px] tracking-[0.12em]">{title}</Meta>
        <Meta className="text-[9.5px]">{hint}</Meta>
      </div>
      <div className="grid gap-[3px]">
        {entries.map((entry) => {
          const active = entry.id === activeId;
          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => onPick(entry.id)}
              className={cn(
                "grid cursor-pointer grid-cols-[28px_minmax(0,1fr)_auto] items-start gap-2.5 rounded-[11px] border-0 px-[9px] py-2.5 text-left text-ink transition-colors duration-150",
                active ? "bg-sel" : "bg-transparent hover:bg-hover-wash",
              )}
            >
              <ScopeMark id={entry.id} label={entry.name} />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5">
                  <strong className="truncate text-[12.5px] font-[600]">
                    {entry.name}
                  </strong>
                  {active ? (
                    <CheckIcon size={12} className="text-accent-strong" />
                  ) : null}
                </span>
                <Meta className="mt-[3px] block truncate text-[9.5px]">
                  {entry.meta}
                </Meta>
                <small className="mt-[5px] block text-[10.5px] leading-[1.5] text-ink-muted [text-wrap:pretty]">
                  {entry.note}
                </small>
              </span>
              {entry.pending > 0 ? (
                <StatusPill tone="accent" size="sm">
                  {t("scope.pending", { count: entry.pending })}
                </StatusPill>
              ) : (
                <Meta className="text-[9.5px]">{t("scope.clear")}</Meta>
              )}
            </button>
          );
        })}
        {entries.length === 0 ? (
          <div className="px-[9px] py-3 text-[11px] text-faint">
            {t("scope.none")}
          </div>
        ) : null}
      </div>
      {onAdd && addLabel ? (
        <div className="mt-2 border-t border-line px-[9px] pb-1 pt-[9px]">
          <button
            type="button"
            onClick={onAdd}
            className="flex w-full cursor-pointer items-center gap-[7px] border-0 bg-transparent py-[3px] text-[11px] text-ink-muted hover:text-accent-strong"
          >
            <PlusIcon size={12} />
            {addLabel}
          </button>
        </div>
      ) : null}
    </>
  );
}
