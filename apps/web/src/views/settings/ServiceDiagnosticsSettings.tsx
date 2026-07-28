import {
  ArrowsClockwiseIcon,
  CheckCircleIcon,
  CloudCheckIcon,
  CodeIcon,
  DatabaseIcon,
  HardDrivesIcon,
  KeyIcon,
  PlugsConnectedIcon,
  PulseIcon,
  ShieldCheckIcon,
  WarningCircleIcon,
  WrenchIcon,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { getServiceReadiness } from "../../api.js";
import { getPilotOverview } from "../../pilot/api.js";
import { usePilot } from "../../pilot/context.js";
import { useConversationRealtime } from "../../realtime/context.js";
import { summarizeProjectAgentConnections } from "../agent/connection-state.js";

type DiagnosticState = "ready" | "degraded" | "unavailable";

interface DiagnosticItem {
  id: string;
  label: string;
  detail: string;
  errorCode?: string;
  state: DiagnosticState;
  icon: Icon;
  repair: "refresh" | "agent" | "provider" | "communications";
}

const LAST_SUCCESS_PREFIX = "intero.diagnostics.last-success.v1";

export function ServiceDiagnosticsSettings() {
  const pilot = usePilot();
  const navigate = useNavigate();
  const realtime = useConversationRealtime();
  const projects = pilot.projects.data?.projects ?? [];
  const readiness = useQuery({
    queryKey: ["service-readiness"],
    queryFn: ({ signal }) => getServiceReadiness(signal),
    retry: 1,
    refetchOnWindowFocus: true,
  });
  const overviews = useQueries({
    queries: projects.map((project) => ({
      queryKey: ["pilot", "overview", pilot.identityId, project.id],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        getPilotOverview(pilot.identityId!, project.id, signal),
      enabled: Boolean(pilot.identityId),
      staleTime: 30_000,
    })),
  });
  const dependencies = new Map(
    (readiness.data?.dependencies ?? []).map((item) => [item.name, item]),
  );
  const connectionSummary = summarizeProjectAgentConnections(
    overviews.flatMap((query) => query.data?.bindings ?? []),
    pilot.identityId,
  );
  const items = useMemo<DiagnosticItem[]>(() => {
    const dependency = (
      id: string,
      label: string,
      detail: string,
      icon: Icon,
    ): DiagnosticItem => {
      const result = dependencies.get(id);
      return {
        id,
        label,
        detail,
        icon,
        repair: "refresh",
        state:
          result?.status ?? (readiness.isError ? "unavailable" : "degraded"),
        ...(result?.detail ? { errorCode: result.detail } : {}),
      };
    };
    const agentState: DiagnosticState =
      connectionSummary.connected.length > 0
        ? "ready"
        : connectionSummary.outdated.length > 0 ||
            connectionSummary.lifecyclePending.length > 0 ||
            connectionSummary.pending.length > 0
          ? "degraded"
          : "unavailable";
    const realtimeState: DiagnosticState =
      realtime.status === "live"
        ? "ready"
        : realtime.status === "connecting" || realtime.status === "degraded"
          ? "degraded"
          : "unavailable";
    return [
      {
        id: "coding_agent",
        label: "Coding Agent",
        detail:
          agentState === "ready"
            ? `${connectionSummary.connected.length} 个项目连接完整可用`
            : agentState === "degraded"
              ? "连接存在，但仍有配置、MCP 或 Hook 步骤未完成"
              : "还没有完整验证的项目级 Agent 连接",
        state: agentState,
        icon: CodeIcon,
        repair: "agent",
        ...(agentState === "ready"
          ? {}
          : {
              errorCode:
                connectionSummary.outdated.length > 0
                  ? "agent_configuration_outdated"
                  : connectionSummary.lifecyclePending.length > 0
                    ? "agent_lifecycle_pending"
                    : "agent_connection_missing",
            }),
      },
      {
        id: "model_provider",
        label: "模型服务",
        detail: pilot.bootstrap.data?.organization?.provider.configured
          ? `${pilot.bootstrap.data.organization.provider.defaultModel} 已配置，密钥仅保存在服务端`
          : "替身和 Agent 摘要暂时无法调用模型",
        state: pilot.bootstrap.data?.organization?.provider.configured
          ? "ready"
          : "unavailable",
        icon: KeyIcon,
        repair: "provider",
        ...(pilot.bootstrap.data?.organization?.provider.configured
          ? {}
          : { errorCode: "model_provider_not_configured" }),
      },
      {
        id: "realtime",
        label: "实时服务",
        detail:
          realtime.status === "live"
            ? "消息实时送达，持久化游标负责校准"
            : realtime.status === "connecting"
              ? "正在建立连接；持久化消息仍然安全"
              : "当前依赖 HTTP 与窗口聚焦后的有界修复",
        state: realtimeState,
        icon: PlugsConnectedIcon,
        repair: "communications",
        ...(realtimeState === "ready"
          ? {}
          : { errorCode: `realtime_${realtime.status}` }),
      },
      {
        id: "api",
        label: "API",
        detail: readiness.data
          ? "健康检查可达，业务 API 可以返回隐私安全状态"
          : "浏览器无法完成 API 就绪检查",
        state: readiness.data
          ? "ready"
          : readiness.isError
            ? "unavailable"
            : "degraded",
        icon: CloudCheckIcon,
        repair: "refresh",
        ...(readiness.isError
          ? { errorCode: "api_readiness_unreachable" }
          : {}),
      },
      dependency(
        "stand_in_worker",
        "后台 Worker",
        "处理 checkpoint、替身摘要与自动协作任务",
        PulseIcon,
      ),
      dependency(
        "spicedb",
        "授权服务",
        "验证组织、项目、Thread 与附件的访问边界",
        ShieldCheckIcon,
      ),
      dependency(
        "pilot_postgres",
        "数据库",
        "持久化协作状态，并验证迁移账本已经追平",
        DatabaseIcon,
      ),
      dependency(
        "object_store",
        "对象存储",
        "保存受控附件；诊断不会读取或展示附件内容",
        HardDrivesIcon,
      ),
    ];
  }, [
    connectionSummary,
    dependencies,
    pilot.bootstrap.data?.organization?.provider.configured,
    pilot.bootstrap.data?.organization?.provider.defaultModel,
    readiness.data,
    readiness.isError,
    realtime.status,
  ]);
  const storagePrefix = `${LAST_SUCCESS_PREFIX}:${pilot.bootstrap.data?.organization?.id ?? "unknown"}`;
  const [lastSuccess, setLastSuccess] = useState<Record<string, string>>(() => {
    if (typeof window === "undefined") return {};
    try {
      return JSON.parse(
        window.localStorage.getItem(storagePrefix) ?? "{}",
      ) as Record<string, string>;
    } catch {
      return {};
    }
  });

  useEffect(() => {
    const validatedAt = new Date(
      readiness.dataUpdatedAt || Date.now(),
    ).toISOString();
    const next = { ...lastSuccess };
    let changed = false;
    for (const item of items) {
      if (item.state === "ready" && next[item.id] !== validatedAt) {
        next[item.id] = validatedAt;
        changed = true;
      }
    }
    if (!changed) return;
    setLastSuccess(next);
    window.localStorage.setItem(storagePrefix, JSON.stringify(next));
  }, [items, lastSuccess, readiness.dataUpdatedAt, storagePrefix]);

  const readyCount = items.filter((item) => item.state === "ready").length;
  const overall: DiagnosticState = items.some(
    (item) => item.state === "unavailable",
  )
    ? "unavailable"
    : items.some((item) => item.state === "degraded")
      ? "degraded"
      : "ready";

  function repair(item: DiagnosticItem) {
    if (item.repair === "agent") {
      void navigate({
        to: "/settings/$category",
        params: { category: "agent" },
      });
      return;
    }
    if (item.repair === "provider") {
      void navigate({ to: "/admin/$tab", params: { tab: "service" } });
      return;
    }
    if (item.repair === "communications") {
      void navigate({ to: "/communications" });
      return;
    }
    void readiness.refetch();
  }

  return (
    <section className="mt-7" data-testid="service-diagnostics">
      <div className="rounded-container border border-line bg-panel2 p-5">
        <header className="flex items-start gap-3">
          <span
            className={[
              "grid h-10 w-10 shrink-0 place-items-center rounded-[12px]",
              overall === "ready"
                ? "bg-green-soft text-green"
                : overall === "degraded"
                  ? "bg-amber-soft text-amber"
                  : "bg-danger-soft text-danger",
            ].join(" ")}
          >
            {overall === "ready" ? (
              <CheckCircleIcon size={20} weight="fill" />
            ) : (
              <WarningCircleIcon size={20} weight="fill" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <strong className="text-[14px] font-[630]">连接与服务诊断</strong>
            <p className="mt-1.5 max-w-[620px] text-[11.5px] leading-[1.65] text-ink-muted">
              汇总 Agent、模型、实时、Worker、授权、数据库和对象存储。
              只展示状态与安全错误码，不返回密钥、内容或终端日志。
            </p>
          </span>
          <button
            type="button"
            data-testid="diagnostics-refresh"
            disabled={readiness.isFetching}
            onClick={() => void readiness.refetch()}
            className="inline-flex h-9 items-center gap-2 rounded-btn border border-line2 px-3.5 text-[11px] hover:border-accent-strong disabled:opacity-50"
          >
            <ArrowsClockwiseIcon
              size={13}
              className={readiness.isFetching ? "animate-spin" : ""}
            />
            重新检测
          </button>
        </header>
        <div className="mt-4 flex items-center gap-2 rounded-card bg-raise px-3.5 py-2.5 text-[10.5px] text-ink-muted">
          <WrenchIcon size={13} className="text-accent-strong" />
          <span>
            {readyCount}/{items.length} 项正常
            {readiness.dataUpdatedAt
              ? ` · 本轮检测 ${new Date(readiness.dataUpdatedAt).toLocaleString()}`
              : " · 正在建立首轮诊断"}
          </span>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        {items.map((item) => {
          const ItemIcon = item.icon;
          const lastSuccessfulValidation = lastSuccess[item.id];
          return (
            <article
              key={item.id}
              data-testid={`diagnostic-${item.id}`}
              className="grid min-h-[166px] grid-rows-[auto_auto_1fr_auto] rounded-container border border-line bg-panel2 p-4"
            >
              <div className="flex items-center gap-2.5">
                <span className="grid h-8 w-8 place-items-center rounded-[9px] bg-raise text-accent-strong">
                  <ItemIcon size={15} />
                </span>
                <strong className="text-[12px] font-[630]">{item.label}</strong>
                <span
                  className={[
                    "ml-auto rounded-pill px-2.5 py-1 text-[9.5px] font-[650]",
                    item.state === "ready"
                      ? "bg-green-soft text-green"
                      : item.state === "degraded"
                        ? "bg-amber-soft text-amber"
                        : "bg-danger-soft text-danger",
                  ].join(" ")}
                >
                  {item.state === "ready"
                    ? "正常"
                    : item.state === "degraded"
                      ? "降级"
                      : "不可用"}
                </span>
              </div>
              <p className="mt-3 text-[10.5px] leading-[1.6] text-ink-muted">
                {item.detail}
              </p>
              <div className="mt-3 text-[9.5px] leading-[1.6] text-faint">
                <p>
                  最近成功：
                  {lastSuccessfulValidation
                    ? new Date(lastSuccessfulValidation).toLocaleString()
                    : "尚无"}
                </p>
                {item.errorCode ? (
                  <p className="mt-0.5 font-mono">错误码 · {item.errorCode}</p>
                ) : null}
              </div>
              {item.state !== "ready" ? (
                <button
                  type="button"
                  onClick={() => repair(item)}
                  className="mt-3 inline-flex h-8 w-fit items-center gap-1.5 rounded-btn border border-line2 px-3 text-[10px] hover:border-accent-strong"
                >
                  {item.repair === "refresh" ? "重新检测" : "前往修复"}
                  <ArrowsClockwiseIcon size={11} />
                </button>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
