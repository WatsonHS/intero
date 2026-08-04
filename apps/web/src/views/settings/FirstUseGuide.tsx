import {
  ArrowRightIcon,
  CheckCircleIcon,
  CircleIcon,
  RocketLaunchIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useQueries } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { getProjectSpecs } from "../../api.js";
import { getPilotOverview } from "../../pilot/api.js";
import { usePilot } from "../../pilot/context.js";
import { deriveFirstUseProgress } from "./first-use-progress.js";

const DISMISSAL_PREFIX = "intero.first-use.dismissed.v1";

export function FirstUseGuide() {
  const pilot = usePilot();
  const navigate = useNavigate();
  const projects = pilot.projects.data?.projects ?? [];
  const overviews = useQueries({
    queries: projects.map((project) => ({
      queryKey: ["pilot", "overview", pilot.identityId, project.id],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        getPilotOverview(pilot.identityId!, project.id, signal),
      enabled: Boolean(pilot.identityId),
      staleTime: 30_000,
    })),
  });
  const specs = useQueries({
    queries: projects.map((project) => ({
      queryKey: ["project-specs", project.id],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        getProjectSpecs(project.id, signal),
      enabled:
        pilot.bootstrap.data?.adapters.projectWork === "postgres" &&
        Boolean(pilot.identityId),
      staleTime: 30_000,
    })),
  });
  const storageKey = `${DISMISSAL_PREFIX}:${pilot.bootstrap.data?.organization?.id ?? "unknown"}:${pilot.identityId ?? "unknown"}`;
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(storageKey) === "1";
  });
  useEffect(() => {
    setDismissed(window.localStorage.getItem(storageKey) === "1");
  }, [storageKey]);

  const progress = useMemo(
    () =>
      deriveFirstUseProgress({
        teams: pilot.teams.data?.teams ?? [],
        overviews: overviews.flatMap((query) =>
          query.data ? [query.data] : [],
        ),
        specs: specs.flatMap((query) => query.data?.items ?? []),
      }),
    [overviews, pilot.teams.data?.teams, specs],
  );
  const projectId = pilot.selectedProjectId ?? projects[0]?.id;
  const desktopAvailable =
    typeof window !== "undefined" && Boolean(window.interoDesktop);
  const steps = [
    {
      id: "invite",
      title: "邀请一位成员",
      detail: "让协作对象进入同一个 Team，建立真实共享范围。",
      done: progress.invitedMember,
      action: "管理成员",
      open: () => navigate({ to: "/admin/$tab", params: { tab: "members" } }),
    },
    {
      id: "agent",
      title: "Attach Coding Agent",
      detail: desktopAvailable
        ? "在 Desktop 选择仓库与 Project，确认托管目标，并完成原生 MCP 服务端验证。"
        : "选择 Project 并生成一次性连接任务，在 Coding Agent 所在主机完成原生 MCP 服务端验证。",
      done: progress.connectedAgent,
      action: "Attach Agent",
      open: () =>
        navigate({ to: "/settings/$category", params: { category: "agent" } }),
    },
    {
      id: "checkpoint",
      title: "收到第一个 checkpoint",
      detail: "Agent 上报结构化进展，私有状态先落库再生成共享摘要。",
      done: progress.receivedCheckpoint,
      action: "查看连接",
      open: () =>
        navigate({ to: "/settings/$category", params: { category: "agent" } }),
    },
    {
      id: "pulse",
      title: "在 Team Pulse 看到结果",
      detail: "确认团队看到的是可追溯摘要，而不是原始工作内容。",
      done: progress.teamPulseVisible,
      action: "打开 Team Pulse",
      open: () => navigate({ to: "/pulse" }),
    },
    {
      id: "spec",
      title: "完成一次 Spec Review",
      detail: "形成至少一个确认、批准或修改请求，闭合人机评审。",
      done: progress.completedSpecReview,
      action: "进入 Spec Review",
      open: () => {
        if (!projectId) return;
        void navigate({
          to: "/projects/$projectId/specs",
          params: { projectId },
        });
      },
    },
  ];

  if (dismissed || progress.completed === progress.total) {
    return (
      <section
        className="mt-7 rounded-[13px] border border-line bg-panel2 px-[16px] py-[13px]"
        data-testid="first-use-guide-collapsed"
      >
        <div className="flex items-center gap-3">
          <CheckCircleIcon size={16} className="text-green" weight="fill" />
          <span className="min-w-0 flex-1 text-[11.5px] text-ink-muted">
            {progress.completed === progress.total
              ? "首次使用路径已完成，Intero 已准备好进入日常协作。"
              : `首次使用清单已收起，进度 ${progress.completed}/${progress.total} 会继续从服务端状态更新。`}
          </span>
          {progress.completed < progress.total ? (
            <button
              type="button"
              onClick={() => {
                window.localStorage.removeItem(storageKey);
                setDismissed(false);
              }}
              className="h-8 rounded-btn border border-line2 px-3 text-[10.5px] hover:border-accent-strong"
            >
              继续设置
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section
      className="mt-7 rounded-container border border-accent-soft bg-panel2 p-5"
      data-testid="first-use-guide"
    >
      <header className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] bg-accent-soft text-accent-strong">
          <RocketLaunchIcon size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <strong className="text-[14px] font-[630]">首次价值路径</strong>
          <p className="mt-1.5 max-w-[610px] text-[11.5px] leading-[1.65] text-ink-muted">
            完成这五步，验证成员、Agent、Team Pulse 与 Spec Review
            已经形成一条可信闭环。完成状态来自真实服务端记录，可随时继续。
          </p>
        </span>
        <button
          type="button"
          aria-label="收起首次使用清单"
          onClick={() => {
            window.localStorage.setItem(storageKey, "1");
            setDismissed(true);
          }}
          className="grid h-8 w-8 place-items-center rounded-btn text-faint hover:bg-raise hover:text-ink"
        >
          <XIcon size={14} />
        </button>
      </header>

      <div className="mt-4 h-1.5 overflow-hidden rounded-pill bg-raise">
        <div
          className="h-full rounded-pill bg-accent-strong transition-[width]"
          style={{ width: `${(progress.completed / progress.total) * 100}%` }}
        />
      </div>
      <p className="mt-2 text-right font-mono text-[10px] text-faint">
        {progress.completed}/{progress.total} 已完成
      </p>

      <div className="mt-3 grid gap-2">
        {steps.map((step) => (
          <article
            key={step.id}
            className={[
              "grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-3 rounded-card border px-3.5 py-3",
              step.done
                ? "border-green-soft bg-green-soft/40"
                : "border-line bg-bg",
            ].join(" ")}
          >
            {step.done ? (
              <CheckCircleIcon size={18} className="text-green" weight="fill" />
            ) : (
              <CircleIcon size={18} className="text-faint" />
            )}
            <span className="min-w-0">
              <strong className="block text-[11.5px] font-[620]">
                {step.title}
              </strong>
              <small className="mt-0.5 block text-[10.5px] leading-[1.55] text-ink-muted">
                {step.detail}
              </small>
            </span>
            <button
              type="button"
              onClick={step.open}
              disabled={step.id === "spec" && !projectId}
              className="inline-flex h-8 items-center gap-1.5 rounded-btn border border-line2 px-3 text-[10.5px] hover:border-accent-strong disabled:opacity-45"
            >
              {step.done ? "查看" : step.action}
              <ArrowRightIcon size={11} />
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
