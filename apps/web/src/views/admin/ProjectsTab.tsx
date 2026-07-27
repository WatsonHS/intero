import { CaretDownIcon, PlusIcon } from "@phosphor-icons/react";
import type {
  PilotCollaborationPosture,
  PilotProject,
  PrincipalId,
} from "@intero/domain";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import {
  Checkbox,
  EmptySlot,
  Meta,
  Modal,
  ScopeMark,
  SegmentedControl,
  SelectMenu,
  StatusPill,
  TableHead,
  TextField,
  cn,
} from "../../design/primitives.js";
import { useI18n } from "../../i18n/index.js";
import type { TranslationKey } from "../../i18n/locales/zh-CN.js";
import {
  createPilotProject,
  updatePilotProject,
  type PilotTeamPayload,
} from "../../pilot/api.js";

const PROJECT_COLUMNS = "32px minmax(0,1.5fr) minmax(0,1fr) 96px 96px 48px";
const POSTURES: PilotCollaborationPosture[] = [
  "collaborative",
  "paused",
  "private",
];
const POSTURE_TONE = {
  collaborative: "green",
  paused: "amber",
  private: "faint",
} as const;

/**
 * 项目 — which projects exist, who owns them, and which teams take part.
 *
 * An organization admin governs every project here; a Team Lead sees the
 * projects their teams reach. Creating one is bound to a team the creator
 * belongs to, because the project owner has to be a member of its primary
 * team — re-scoping an existing project has no such limit.
 */
export function ProjectsTab({
  projects,
  teams,
  ownTeamIds,
  names,
  identityId,
  canManage,
  onChanged,
}: {
  projects: PilotProject[];
  /** Every team the viewer may attach a project to. */
  teams: PilotTeamPayload[];
  /** Teams the viewer is a member of — the only valid primary team on create. */
  ownTeamIds: string[];
  /** Display names by principal id, for the owner column. */
  names: Map<string, string>;
  identityId: PrincipalId;
  canManage: (project: PilotProject) => boolean;
  onChanged: () => Promise<void> | void;
}) {
  const { t } = useI18n();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PilotProject>();
  const teamName = (teamId: string) =>
    teams.find((team) => team.id === teamId)?.name ?? t("general.unavailable");

  return (
    <div className="mt-[26px]">
      <div className="flex items-center gap-3">
        <strong className="text-[14px] font-[620]">
          {t("admin.projects.title")}
        </strong>
        <Meta className="text-[10.5px]">
          {t("admin.projects.count", { count: projects.length })}
        </Meta>
        {ownTeamIds.length > 0 ? (
          <button
            type="button"
            onClick={() => setCreating(true)}
            data-testid="admin-create-project"
            className="ml-auto inline-flex h-8 cursor-pointer items-center gap-[7px] rounded-btn border-0 bg-accent-strong px-[13px] text-[12px] font-[560] text-on-accent"
          >
            <PlusIcon size={14} />
            {t("admin.projects.create")}
          </button>
        ) : null}
      </div>
      <p className="mt-2 max-w-[620px] text-[12px] leading-[1.7] text-ink-muted [text-wrap:pretty]">
        {t("admin.projects.lede")}
      </p>

      <div className="mt-[18px]">
        <TableHead
          template={PROJECT_COLUMNS}
          columns={[
            "",
            t("admin.projects.colProject"),
            t("admin.projects.colTeams"),
            t("admin.projects.colPosture"),
            t("admin.projects.colOwner"),
            "",
          ]}
        />
      </div>
      <div className="mt-1.5 flex flex-col gap-1.5">
        {projects.map((project) => (
          <div
            key={project.id}
            className="grid items-center gap-3 rounded-[13px] border border-line bg-panel2 px-4 py-3"
            style={{ gridTemplateColumns: PROJECT_COLUMNS }}
          >
            <ScopeMark id={project.id} label={project.name} size="lg" />
            <span className="grid min-w-0">
              <strong className="truncate text-[12.5px] font-[600]">
                {project.name}
              </strong>
              <small className="mt-[3px] truncate text-[10.5px] text-faint">
                {t("admin.projects.primaryOf", {
                  team: teamName(project.primaryTeamId),
                })}
              </small>
            </span>
            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
              {project.participatingTeamIds.slice(0, 3).map((teamId) => (
                <span
                  key={teamId}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-pill bg-raise px-2 py-[3px] text-[10.5px] text-ink-muted"
                >
                  <ScopeMark
                    id={teamId}
                    label={teamName(teamId)}
                    size="sm"
                    className="h-[14px] w-[14px] text-[7px]"
                  />
                  <span className="truncate">{teamName(teamId)}</span>
                </span>
              ))}
              {project.participatingTeamIds.length > 3 ? (
                <Meta className="text-[10px]">
                  {t("admin.projects.moreTeams", {
                    count: project.participatingTeamIds.length - 3,
                  })}
                </Meta>
              ) : null}
            </span>
            <StatusPill tone={POSTURE_TONE[project.posture]} size="sm">
              {t(`admin.projects.posture.${project.posture}` as TranslationKey)}
            </StatusPill>
            <Meta className="truncate text-[11px]">
              {names.get(project.ownerId) ?? t("admin.audit.system")}
            </Meta>
            {canManage(project) ? (
              <button
                type="button"
                onClick={() => setEditing(project)}
                className="cursor-pointer justify-self-end border-0 bg-transparent p-0 text-[11px] text-ink-muted hover:text-accent-strong"
              >
                {t("admin.projects.edit")}
              </button>
            ) : (
              <span />
            )}
          </div>
        ))}
        {projects.length === 0 ? (
          <EmptySlot>{t("admin.projects.empty")}</EmptySlot>
        ) : null}
      </div>

      {creating ? (
        <ProjectModal
          title={t("admin.projects.createTitle")}
          submitLabel={t("admin.projects.createSubmit")}
          teams={teams}
          primaryTeamChoices={teams.filter((team) =>
            ownTeamIds.includes(team.id),
          )}
          initial={{
            name: "",
            primaryTeamId: ownTeamIds[0]!,
            participatingTeamIds: [ownTeamIds[0]!],
            posture: "collaborative",
          }}
          onClose={() => setCreating(false)}
          onSubmit={(value) =>
            createPilotProject(identityId, {
              name: value.name,
              primaryTeamId: value.primaryTeamId,
              participatingTeamIds: value.participatingTeamIds,
              posture: value.posture,
            })
          }
          onDone={async () => {
            setCreating(false);
            await onChanged();
          }}
        />
      ) : null}

      {editing ? (
        <ProjectModal
          title={t("admin.projects.editTitle")}
          submitLabel={t("admin.projects.save")}
          teams={teams}
          primaryTeamChoices={teams}
          initial={{
            name: editing.name,
            primaryTeamId: editing.primaryTeamId,
            participatingTeamIds: editing.participatingTeamIds,
            posture: editing.posture,
          }}
          onClose={() => setEditing(undefined)}
          onSubmit={(value) =>
            updatePilotProject(identityId, editing.id, {
              name: value.name,
              primaryTeamId: value.primaryTeamId,
              participatingTeamIds: value.participatingTeamIds,
              posture: value.posture,
            })
          }
          onDone={async () => {
            setEditing(undefined);
            await onChanged();
          }}
        />
      ) : null}
    </div>
  );
}

interface ProjectDraft {
  name: string;
  primaryTeamId: string;
  participatingTeamIds: string[];
  posture: PilotCollaborationPosture;
}

/**
 * One form behind both create and edit. The primary team is always kept in the
 * participating set, which is the invariant the store enforces anyway — better
 * to make it impossible to express than to reject it after the fact.
 */
function ProjectModal({
  title,
  submitLabel,
  teams,
  primaryTeamChoices,
  initial,
  onClose,
  onSubmit,
  onDone,
}: {
  title: string;
  submitLabel: string;
  teams: PilotTeamPayload[];
  primaryTeamChoices: PilotTeamPayload[];
  initial: ProjectDraft;
  onClose: () => void;
  onSubmit: (value: ProjectDraft) => Promise<unknown>;
  onDone: () => Promise<void> | void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<ProjectDraft>(initial);
  const save = useMutation({
    mutationFn: () => onSubmit({ ...draft, name: draft.name.trim() }),
    onSuccess: onDone,
  });
  const primaryName =
    teams.find((team) => team.id === draft.primaryTeamId)?.name ??
    t("general.unavailable");

  function selectPrimary(teamId: string) {
    setDraft((current) => ({
      ...current,
      primaryTeamId: teamId,
      participatingTeamIds: current.participatingTeamIds.includes(teamId)
        ? current.participatingTeamIds
        : [...current.participatingTeamIds, teamId],
    }));
  }

  function toggleTeam(teamId: string, on: boolean) {
    setDraft((current) => ({
      ...current,
      participatingTeamIds: on
        ? [...current.participatingTeamIds, teamId]
        : current.participatingTeamIds.filter((id) => id !== teamId),
    }));
  }

  const errorCode = (save.error as { code?: string } | null)?.code;

  return (
    <Modal
      title={title}
      width={470}
      onClose={onClose}
      footer={
        <>
          <span className="flex-1 text-[11px] text-danger">
            {save.isError
              ? t(
                  errorCode === "PROJECT_OWNER_NOT_IN_TEAM"
                    ? "admin.projects.ownerNotInTeam"
                    : "admin.projects.failed",
                )
              : null}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="h-8 cursor-pointer rounded-btn border border-line2 bg-transparent px-3.5 text-[12px] text-ink-muted hover:border-accent-strong hover:text-ink"
          >
            {t("admin.form.cancel")}
          </button>
          <button
            type="button"
            disabled={!draft.name.trim() || save.isPending}
            onClick={() => save.mutate()}
            data-testid="admin-project-submit"
            className="h-8 cursor-pointer rounded-btn border-0 bg-accent-strong px-3.5 text-[12px] font-[620] text-on-accent disabled:cursor-not-allowed disabled:opacity-45"
          >
            {submitLabel}
          </button>
        </>
      }
    >
      <div className="grid gap-[22px] pt-1">
        <TextField
          label={t("admin.projects.nameLabel")}
          value={draft.name}
          onChange={(name) => setDraft((current) => ({ ...current, name }))}
          placeholder={t("admin.projects.namePlaceholder")}
          testId="admin-project-name-input"
        />

        <div className="grid gap-1.5">
          <span className="text-[10.5px] tracking-[0.08em] text-faint">
            {t("admin.projects.primaryTeam")}
          </span>
          <SelectMenu
            label={t("admin.projects.primaryTeam")}
            value={draft.primaryTeamId}
            onChange={selectPrimary}
            options={primaryTeamChoices.map((team) => ({
              id: team.id,
              label: team.name,
              leading: (
                <ScopeMark id={team.id} label={team.name} size="sm" filled />
              ),
            }))}
          >
            <span className="inline-flex h-8 w-full items-center gap-2 rounded-btn border border-line bg-panel px-2.5 text-[12px] text-ink hover:border-accent-strong">
              <ScopeMark
                id={draft.primaryTeamId}
                label={primaryName}
                size="sm"
                filled
              />
              <span className="truncate">{primaryName}</span>
              <CaretDownIcon size={9} className="ml-auto shrink-0 opacity-70" />
            </span>
          </SelectMenu>
          <span className="text-[11px] leading-[1.6] text-faint [text-wrap:pretty]">
            {t("admin.projects.primaryTeamHint")}
          </span>
        </div>

        <div className="grid gap-2">
          <span className="text-[10.5px] tracking-[0.08em] text-faint">
            {t("admin.projects.participating")}
          </span>
          <div className="flex flex-col gap-1.5">
            {teams.map((team) => {
              const primary = team.id === draft.primaryTeamId;
              return (
                <div
                  key={team.id}
                  className={cn(
                    "flex items-center gap-2.5 rounded-inset border px-3 py-2",
                    draft.participatingTeamIds.includes(team.id)
                      ? "border-accent-strong bg-sel"
                      : "border-line bg-panel2",
                  )}
                >
                  <Checkbox
                    checked={draft.participatingTeamIds.includes(team.id)}
                    disabled={primary}
                    onChange={(on) => toggleTeam(team.id, on)}
                    label={team.name}
                  />
                  {primary ? (
                    <StatusPill tone="accent" size="sm" className="ml-auto">
                      {t("admin.projects.isPrimary")}
                    </StatusPill>
                  ) : null}
                </div>
              );
            })}
          </div>
          <span className="text-[11px] leading-[1.6] text-faint [text-wrap:pretty]">
            {t("admin.projects.participatingHint")}
          </span>
        </div>

        <div className="grid gap-2">
          <span className="text-[10.5px] tracking-[0.08em] text-faint">
            {t("admin.projects.posture")}
          </span>
          <SegmentedControl
            className="w-fit"
            value={draft.posture}
            onChange={(posture) =>
              setDraft((current) => ({ ...current, posture }))
            }
            items={POSTURES.map((posture) => ({
              id: posture,
              label: t(`admin.projects.posture.${posture}` as TranslationKey),
            }))}
          />
          <span className="text-[11px] leading-[1.6] text-faint [text-wrap:pretty]">
            {t(`scope.posture.${draft.posture}` as TranslationKey)}
          </span>
        </div>
      </div>
    </Modal>
  );
}
