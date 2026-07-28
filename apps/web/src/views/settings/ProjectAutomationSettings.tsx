import {
  PauseCircleIcon,
  RobotIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react";
import type {
  ProjectAutomationPolicy,
  ProjectAutomationSignalKind,
} from "@intero/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { getProjectAutomation, updateProjectAutomation } from "../../api.js";
import { Checkbox } from "../../design/primitives.js";
import { useI18n } from "../../i18n/index.js";

const SIGNALS = [
  "blocker",
  "dependency_change",
  "spec_review_stale",
  "coordination_unresolved",
  "project_work_risk",
] as const satisfies readonly ProjectAutomationSignalKind[];

const COPY = {
  "zh-CN": {
    title: "替身自动协作",
    lede: "替身只识别已授权的结构化风险信号，并在项目内发起可审计、可撤回的协调。它不会修改成员权限、负责人或优先级，也不会执行外部操作。",
    enabled: "启用项目自动协作",
    enabledDetail:
      "检测到有意义的风险后，创建 Coordination 并定向提醒相关成员。",
    readOnly: "由组织管理员或主团队 Team Leader 管理",
    blockers: "阻塞",
    dependencies: "依赖变化",
    specs: "Spec 评审等待",
    coordination: "协调未解决",
    risks: "项目工作风险",
    specHours: "Spec 等待阈值（小时）",
    coordinationHours: "协调等待阈值（小时）",
    save: "保存范围",
    saving: "保存中…",
    quiet: "安静 1 小时",
    resume: "立即恢复",
    quietUntil: "已安静至",
    error: "保存失败，请稍后重试。",
    audit: "自动化结论仍需负责参与者确认；所有动作会保留来源和审计记录。",
  },
  "en-US": {
    title: "Stand-in automation",
    lede: "The Stand-in detects authorized structured risk signals and opens auditable, reversible Project coordination. It cannot change access, ownership, priority, or act externally.",
    enabled: "Enable Project automation",
    enabledDetail:
      "Open Coordination and target the relevant people when a meaningful risk is detected.",
    readOnly: "Managed by an organization admin or primary Team Leader",
    blockers: "Blockers",
    dependencies: "Dependency changes",
    specs: "Pending Spec review",
    coordination: "Unresolved coordination",
    risks: "Project work risk",
    specHours: "Spec wait threshold (hours)",
    coordinationHours: "Coordination wait threshold (hours)",
    save: "Save scope",
    saving: "Saving…",
    quiet: "Quiet for 1 hour",
    resume: "Resume now",
    quietUntil: "Quiet until",
    error: "Could not save. Try again.",
    audit:
      "Automation conclusions still require a responsible participant; every action retains source and audit history.",
  },
} as const;

export function ProjectAutomationSettings({
  projectId,
  projectName,
}: {
  projectId?: string | undefined;
  projectName?: string | undefined;
}) {
  const { locale } = useI18n();
  const copy = COPY[locale];
  const queryClient = useQueryClient();
  const automation = useQuery({
    queryKey: ["project-automation", projectId],
    queryFn: ({ signal }) => getProjectAutomation(projectId!, signal),
    enabled: Boolean(projectId),
    refetchOnWindowFocus: true,
  });
  const [draft, setDraft] = useState<ProjectAutomationPolicy>();

  useEffect(() => {
    if (automation.data?.policy) setDraft(automation.data.policy);
  }, [automation.data?.policy]);

  const save = useMutation({
    mutationFn: (policy: ProjectAutomationPolicy) =>
      updateProjectAutomation(policy.projectId, {
        enabled: policy.enabled,
        enabledSignals: policy.enabledSignals,
        staleSpecReviewHours: policy.staleSpecReviewHours,
        unresolvedCoordinationHours: policy.unresolvedCoordinationHours,
        ...(policy.quietUntil
          ? { quietUntil: policy.quietUntil }
          : { quietUntil: null }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["project-automation", projectId],
      });
    },
  });

  if (!projectId || !draft) return null;
  const canManage = automation.data?.canManage ?? false;
  const quiet = Boolean(
    draft.quietUntil && Date.parse(draft.quietUntil) > Date.now(),
  );

  function toggleSignal(kind: ProjectAutomationSignalKind) {
    if (!canManage) return;
    setDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        enabledSignals: current.enabledSignals.includes(kind)
          ? current.enabledSignals.filter((item) => item !== kind)
          : [...current.enabledSignals, kind],
      };
    });
  }

  return (
    <section className="mt-8" data-testid="project-automation-settings">
      <div className="flex items-center gap-2">
        <RobotIcon size={17} className="text-accent-strong" />
        <strong className="text-[14px] font-[620]">{copy.title}</strong>
        {projectName ? (
          <span className="font-mono text-[10px] text-faint">
            {projectName}
          </span>
        ) : null}
      </div>
      <p className="mt-2 max-w-[620px] text-[12px] leading-[1.7] text-ink-muted">
        {copy.lede}
      </p>

      <div className="mt-3.5 rounded-[13px] border border-line bg-panel2 p-[16px_18px]">
        <button
          type="button"
          disabled={!canManage}
          data-testid="project-automation-enabled"
          onClick={() =>
            setDraft((current) =>
              current ? { ...current, enabled: !current.enabled } : current,
            )
          }
          className="grid w-full grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-[13px] text-left disabled:cursor-default"
        >
          <span className="grid h-[34px] w-[34px] place-items-center rounded-[10px] bg-raise text-accent-strong">
            <ShieldCheckIcon size={16} />
          </span>
          <span className="grid">
            <strong className="text-[12.5px] font-[620]">{copy.enabled}</strong>
            <small className="mt-1 text-[11px] leading-[1.55] text-ink-muted">
              {canManage ? copy.enabledDetail : copy.readOnly}
            </small>
          </span>
          <span
            aria-hidden="true"
            className={[
              "inline-flex h-6 w-[42px] items-center rounded-pill p-[3px]",
              draft.enabled
                ? "justify-end bg-accent-strong"
                : "justify-start bg-raise",
            ].join(" ")}
          >
            <span
              className={[
                "h-[18px] w-[18px] rounded-full",
                draft.enabled ? "bg-on-accent" : "bg-faint",
              ].join(" ")}
            />
          </span>
        </button>

        <div className="mt-4 grid grid-cols-2 gap-2 border-t border-line pt-4 sm:grid-cols-3">
          {SIGNALS.map((kind) => (
            <Checkbox
              key={kind}
              disabled={!canManage}
              checked={draft.enabledSignals.includes(kind)}
              onChange={() => toggleSignal(kind)}
              label={signalLabel(copy, kind)}
              className="rounded-btn border border-line2 px-3 py-2"
            />
          ))}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <Threshold
            label={copy.specHours}
            value={draft.staleSpecReviewHours}
            disabled={!canManage}
            onChange={(value) =>
              setDraft({ ...draft, staleSpecReviewHours: value })
            }
          />
          <Threshold
            label={copy.coordinationHours}
            value={draft.unresolvedCoordinationHours}
            disabled={!canManage}
            onChange={(value) =>
              setDraft({ ...draft, unresolvedCoordinationHours: value })
            }
          />
        </div>

        {canManage ? (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="project-automation-save"
              disabled={save.isPending || draft.enabledSignals.length === 0}
              onClick={() => save.mutate(draft)}
              className="h-8 rounded-btn border-0 bg-accent-strong px-3.5 text-[11.5px] font-[620] text-on-accent disabled:opacity-45"
            >
              {save.isPending ? copy.saving : copy.save}
            </button>
            <button
              type="button"
              data-testid="project-automation-quiet"
              disabled={save.isPending}
              onClick={() =>
                save.mutate({
                  ...draft,
                  ...(quiet
                    ? { quietUntil: undefined }
                    : {
                        quietUntil: new Date(
                          Date.now() + 60 * 60 * 1_000,
                        ).toISOString(),
                      }),
                })
              }
              className="inline-flex h-8 items-center gap-1.5 rounded-btn border border-line2 bg-transparent px-3 text-[11.5px] text-ink-muted hover:border-accent-strong"
            >
              <PauseCircleIcon size={14} />
              {quiet ? copy.resume : copy.quiet}
            </button>
            {quiet && draft.quietUntil ? (
              <span className="font-mono text-[10px] text-faint">
                {copy.quietUntil}{" "}
                {new Date(draft.quietUntil).toLocaleTimeString(locale, {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            ) : null}
          </div>
        ) : null}
        {save.isError ? (
          <p className="mt-3 text-[11px] text-danger">{copy.error}</p>
        ) : null}
        <p className="mt-3 text-[10.5px] leading-[1.6] text-faint">
          {copy.audit}
        </p>
      </div>
    </section>
  );
}

function Threshold({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid gap-1.5 text-[10.5px] text-ink-muted">
      {label}
      <input
        type="number"
        min={1}
        max={720}
        disabled={disabled}
        value={value}
        onChange={(event) =>
          onChange(Math.max(1, Math.min(720, Number(event.target.value) || 1)))
        }
        className="h-8 rounded-btn border border-line2 bg-raise px-3 font-mono text-[11.5px] text-ink outline-none focus:border-accent-strong disabled:opacity-60"
      />
    </label>
  );
}

function signalLabel(
  copy: (typeof COPY)[keyof typeof COPY],
  kind: ProjectAutomationSignalKind,
) {
  if (kind === "blocker") return copy.blockers;
  if (kind === "dependency_change") return copy.dependencies;
  if (kind === "spec_review_stale") return copy.specs;
  if (kind === "coordination_unresolved") return copy.coordination;
  return copy.risks;
}
