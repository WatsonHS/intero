import {
  CheckCircleIcon,
  CheckIcon,
  CloudCheckIcon,
  CopyIcon,
  KeyIcon,
  LinkIcon,
  ShieldCheckIcon,
  UserIcon,
  UsersThreeIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import type { PilotCollaborationPosture, PrincipalId } from "@intero/domain";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { initials } from "../../design/utils.js";
import {
  configurePilotProvider,
  createPilotJoinLink,
  createPilotProject,
  joinPilotTeam,
  PILOT_API_URL,
  setupPilot,
} from "../../pilot/api.js";
import { usePilot } from "../../pilot/context.js";

const STEPS = [
  ["身份", "选择成员身份"],
  ["部署与团队", "连接部署并加入团队"],
  ["模型服务", "配置团队的 AI 服务"],
  ["项目", "创建或选择项目"],
] as const;

export function PilotTestSetupFlow({
  testMode = false,
  onDone,
}: {
  testMode?: boolean;
  onDone: () => void;
}) {
  const pilot = usePilot();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(1);
  const [organizationName, setOrganizationName] = useState("Intero Pilot");
  const [teamName, setTeamName] = useState("Pilot Team");
  const [deploymentBaseUrl, setDeploymentBaseUrl] = useState(PILOT_API_URL);
  const [providerEndpoint, setProviderEndpoint] = useState(
    "https://api.openai.com/v1",
  );
  const [providerKey, setProviderKey] = useState("");
  const [defaultModel, setDefaultModel] = useState("gpt-5.4");
  const [editingProvider, setEditingProvider] = useState(false);
  const [projectName, setProjectName] = useState("Pilot Project");
  const [joinValue, setJoinValue] = useState(() =>
    typeof window === "undefined"
      ? ""
      : (new URL(window.location.href).searchParams.get("join") ?? ""),
  );
  const [joinUrl, setJoinUrl] = useState("");

  const identity = pilot.bootstrap.data?.identities.find(
    (item) => item.id === pilot.identityId,
  );
  const organization = pilot.bootstrap.data?.organization;
  const isAdministrator =
    pilot.identityId === pilot.bootstrap.data?.administratorId;
  const teams = pilot.teams.data?.teams ?? [];
  const projects = pilot.projects.data?.projects ?? [];
  const selectedProject =
    projects.find((item) => item.id === pilot.selectedProjectId) ?? projects[0];
  const selectedTeam = teams[0];

  async function refreshPilot() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["pilot"] }),
      queryClient.invalidateQueries({ queryKey: ["threads"] }),
    ]);
  }

  const setup = useMutation({
    mutationFn: () =>
      setupPilot(pilot.identityId!, {
        organizationName,
        teamName,
        deploymentBaseUrl: pilot.bootstrap.data?.publicUrl ?? deploymentBaseUrl,
      }),
    onSuccess: refreshPilot,
  });
  const configureProvider = useMutation({
    mutationFn: () =>
      configurePilotProvider(pilot.identityId!, {
        endpoint: providerEndpoint,
        apiKey: providerKey,
        defaultModel,
      }),
    onSuccess: async () => {
      setProviderKey("");
      setEditingProvider(false);
      await refreshPilot();
    },
  });
  const join = useMutation({
    mutationFn: () => joinPilotTeam(pilot.identityId!, joinValue),
    onSuccess: refreshPilot,
  });
  const createLink = useMutation({
    mutationFn: () => createPilotJoinLink(pilot.identityId!, selectedTeam!.id),
    onSuccess: ({ joinUrl: nextJoinUrl }) => setJoinUrl(nextJoinUrl),
  });
  const createProject = useMutation({
    mutationFn: () =>
      createPilotProject(pilot.identityId!, {
        name: projectName,
        primaryTeamId: selectedTeam!.id,
        participatingTeamIds: [selectedTeam!.id],
        posture: "collaborative",
      }),
    onSuccess: async ({ project }) => {
      pilot.setSelectedProjectId(project.id);
      await refreshPilot();
    },
  });
  const canContinue =
    step === 1
      ? Boolean(identity)
      : step === 2
        ? teams.length > 0
        : step === 3
          ? Boolean(organization?.provider.configured)
          : step === 4
            ? Boolean(selectedProject)
            : true;

  const mutationError =
    setup.error ??
    configureProvider.error ??
    join.error ??
    createLink.error ??
    createProject.error;

  return (
    <div className="animate-view-enter grid h-full grid-cols-[300px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] bg-bg">
      <aside className="h-full overflow-auto border-r border-line bg-panel p-[34px_26px]">
        <span className="grid h-[30px] w-[30px] place-items-center rounded-[9px] bg-accent-strong text-[13px] font-bold text-on-accent">
          I
        </span>
        <h2 className="mt-[18px] text-[19px] font-[600] tracking-[-0.025em]">
          {testMode ? "Intero Admin Test Bootstrap" : "Intero Admin Bootstrap"}
        </h2>
        <p className="mt-2.5 text-[11.5px] leading-[1.7] text-ink-muted [text-wrap:pretty]">
          初始化组织、团队、模型服务与首个 Project。普通成员不会进入这个流程。
        </p>
        {testMode ? (
          <button
            type="button"
            data-testid="pilot-setup-exit"
            onClick={onDone}
            className="mt-4 h-8 rounded-btn border border-line2 bg-transparent px-3 text-[11.5px] text-ink-muted hover:border-accent-strong hover:text-ink"
          >
            退出测试流程
          </button>
        ) : null}

        <div className="mt-[26px] flex flex-col gap-0.5">
          {STEPS.map(([label, sub], index) => {
            const n = index + 1;
            const done = n < step;
            const current = n === step;
            return (
              <button
                key={label}
                type="button"
                onClick={() => setStep(n)}
                className={[
                  "grid w-full cursor-pointer grid-cols-[24px_minmax(0,1fr)] items-start gap-3 rounded-[10px] p-[11px_10px] text-left",
                  current ? "bg-sel" : "hover:bg-hover-wash",
                ].join(" ")}
              >
                <span
                  className={[
                    "grid h-6 w-6 place-items-center rounded-full border font-mono text-[10px]",
                    done
                      ? "border-accent-strong bg-accent-strong text-on-accent"
                      : current
                        ? "border-accent-strong text-accent-strong"
                        : "border-line2 text-faint",
                  ].join(" ")}
                >
                  {done ? "✓" : n}
                </span>
                <span className="grid min-w-0 gap-1">
                  <span
                    className={
                      current
                        ? "text-[12.5px] font-[650] text-ink"
                        : "text-[12.5px] text-ink-muted"
                    }
                  >
                    {label}
                  </span>
                  <span className="text-[10.5px] leading-[1.5] text-faint">
                    {sub}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-[26px] rounded-[11px] bg-raise p-[14px_15px]">
          <div className="flex items-center gap-2">
            <ShieldCheckIcon size={15} className="text-green" />
            <strong className="text-[11.5px] font-[620]">
              默认仅同步工作摘要
            </strong>
          </div>
          <p className="mt-2.5 text-[11px] leading-[1.65] text-ink-muted">
            Intero 不会自动上传 prompt、文件、diff、终端或工具输出。
          </p>
        </div>
      </aside>

      <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto]">
        <div className="min-h-0 overflow-auto p-[44px_44px_30px]">
          <div className="max-w-[680px]">
            <div className="font-mono text-[11px] tracking-[0.12em] text-accent-strong">
              STEP {step} · {STEPS[step - 1]?.[0]}
            </div>
            <h1 className="mt-3.5 text-[30px] font-[540] leading-[1.15] tracking-[-0.035em]">
              {stepTitle(step)}
            </h1>
            <p className="mt-3.5 text-[13.5px] leading-[1.8] text-ink-muted">
              {stepBody(step)}
            </p>

            {step === 1 ? (
              <div className="mt-7 grid gap-2.5" data-testid="pilot-identities">
                {pilot.bootstrap.data?.identities.map((item) => {
                  const selected = item.id === pilot.identityId;
                  return (
                    <button
                      type="button"
                      data-testid={`pilot-identity-${item.id}`}
                      key={item.id}
                      onClick={() =>
                        pilot.setIdentityId(item.id as PrincipalId)
                      }
                      className={[
                        "grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-[13px] rounded-card border p-[16px_18px] text-left",
                        selected
                          ? "border-accent-strong bg-accent-soft"
                          : "border-line bg-panel2 hover:border-line2",
                      ].join(" ")}
                    >
                      <span className="grid h-9 w-9 place-items-center rounded-full bg-raise text-[11px] font-[650]">
                        {initials(item.displayName)}
                      </span>
                      <span className="grid">
                        <strong className="text-[13px] font-[620]">
                          {item.displayName}
                        </strong>
                        <small className="mt-1 font-mono text-[10.5px] text-faint">
                          预设成员
                        </small>
                      </span>
                      {selected ? (
                        <CheckCircleIcon
                          size={17}
                          weight="fill"
                          className="text-green"
                        />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ) : null}

            {step === 2 ? (
              <div className="mt-7 grid gap-3">
                {!organization ? (
                  <section className="rounded-card border border-line bg-panel2 p-5">
                    <Field
                      label="组织名称"
                      value={organizationName}
                      onChange={setOrganizationName}
                      testId="pilot-organization-name"
                    />
                    <Field
                      label="初始团队名称"
                      value={teamName}
                      onChange={setTeamName}
                      testId="pilot-team-name"
                    />
                    {pilot.bootstrap.data?.deploymentEndpointManaged ? (
                      <ReadOnlyField
                        label="Intero 部署地址"
                        value={
                          pilot.bootstrap.data.publicUrl ??
                          "由服务端部署配置管理"
                        }
                      />
                    ) : (
                      <Field
                        label="Intero 部署地址"
                        value={deploymentBaseUrl}
                        onChange={setDeploymentBaseUrl}
                        testId="pilot-deployment-url"
                      />
                    )}
                    <button
                      type="button"
                      data-testid="pilot-setup-submit"
                      disabled={!identity || setup.isPending}
                      onClick={() => setup.mutate()}
                      className="mt-4 h-9 rounded-btn border-0 bg-accent-strong px-4 text-[12.5px] font-[620] text-on-accent disabled:opacity-50"
                    >
                      {setup.isPending ? "连接中…" : "连接并创建团队"}
                    </button>
                  </section>
                ) : teams.length === 0 ? (
                  <section className="rounded-card border border-line bg-panel2 p-5">
                    <div className="flex items-center gap-2 text-[12px] text-ink">
                      <LinkIcon size={16} className="text-accent-strong" />
                      粘贴管理员发来的团队加入链接
                    </div>
                    <Field
                      label="团队加入链接"
                      value={joinValue}
                      onChange={setJoinValue}
                      testId="pilot-join-link"
                    />
                    <button
                      type="button"
                      data-testid="pilot-join-submit"
                      disabled={!joinValue.trim() || join.isPending}
                      onClick={() => join.mutate()}
                      className="mt-4 h-9 rounded-btn border-0 bg-accent-strong px-4 text-[12.5px] font-[620] text-on-accent disabled:opacity-50"
                    >
                      {join.isPending ? "加入中…" : "加入团队"}
                    </button>
                  </section>
                ) : (
                  <>
                    <section className="grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-[13px] rounded-card border border-accent-strong bg-accent-soft p-[16px_18px]">
                      <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-accent-strong text-on-accent">
                        <UsersThreeIcon size={17} />
                      </span>
                      <span className="grid">
                        <strong className="text-[13px] font-[620]">
                          {selectedTeam?.name}
                        </strong>
                        <small className="mt-1 text-[11px] text-ink-muted">
                          {selectedTeam?.members.length ?? 0} 位成员 ·{" "}
                          {organization.name}
                        </small>
                      </span>
                      <span className="text-[11.5px] font-[620] text-accent-strong">
                        已加入
                      </span>
                    </section>
                    {isAdministrator ? (
                      <section className="rounded-card border border-line bg-panel2 p-5">
                        <div className="flex items-center gap-2">
                          <LinkIcon size={15} className="text-accent-strong" />
                          <strong className="text-[12.5px] font-[620]">
                            团队加入链接
                          </strong>
                        </div>
                        {joinUrl ? (
                          <div className="mt-3 flex gap-2">
                            <input
                              readOnly
                              data-testid="pilot-generated-join-link"
                              value={joinUrl}
                              className="h-9 min-w-0 flex-1 rounded-btn border border-line2 bg-raise px-3 font-mono text-[10.5px] text-ink"
                            />
                            <CopyButton value={joinUrl} />
                          </div>
                        ) : (
                          <button
                            type="button"
                            data-testid="pilot-create-join-link"
                            onClick={() => createLink.mutate()}
                            disabled={createLink.isPending}
                            className="mt-3 h-9 rounded-btn border border-line2 bg-transparent px-4 text-[12px] hover:border-accent-strong"
                          >
                            生成加入链接
                          </button>
                        )}
                      </section>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}

            {step === 3 ? (
              <div className="mt-7">
                {organization?.provider.configured && !editingProvider ? (
                  <div className="grid gap-3">
                    <StatusCard
                      icon={<CloudCheckIcon size={18} />}
                      title="AI 模型服务"
                      detail={`${organization.provider.endpoint} · ${organization.provider.defaultModel}`}
                      value="已配置"
                      tone="green"
                    />
                    {isAdministrator ? (
                      <button
                        type="button"
                        data-testid="pilot-provider-edit"
                        onClick={() => {
                          setProviderEndpoint(
                            organization.provider.endpoint ??
                              "https://api.openai.com/v1",
                          );
                          setDefaultModel(
                            organization.provider.defaultModel ?? "gpt-5.4",
                          );
                          setEditingProvider(true);
                        }}
                        className="justify-self-start h-8 rounded-btn border border-line2 bg-transparent px-3 text-[11.5px] text-ink-muted hover:border-accent-strong hover:text-ink"
                      >
                        修改配置
                      </button>
                    ) : null}
                  </div>
                ) : isAdministrator ? (
                  <section className="rounded-card border border-line bg-panel2 p-5">
                    <Field
                      label="服务地址"
                      value={providerEndpoint}
                      onChange={setProviderEndpoint}
                      testId="pilot-provider-endpoint"
                    />
                    <Field
                      label="API 密钥（仅服务端保存）"
                      value={providerKey}
                      onChange={setProviderKey}
                      type="password"
                      testId="pilot-provider-key"
                    />
                    <Field
                      label="默认模型"
                      value={defaultModel}
                      onChange={setDefaultModel}
                      testId="pilot-provider-model"
                    />
                    <p className="mt-3 flex items-center gap-2 text-[11px] text-faint">
                      <KeyIcon size={13} />
                      密钥只发送到 Intero 服务端，不会返回给浏览器或团队成员。
                    </p>
                    <button
                      type="button"
                      data-testid="pilot-provider-submit"
                      disabled={
                        !providerKey.trim() || configureProvider.isPending
                      }
                      onClick={() => configureProvider.mutate()}
                      className="mt-4 h-9 rounded-btn border-0 bg-accent-strong px-4 text-[12.5px] font-[620] text-on-accent disabled:opacity-50"
                    >
                      {configureProvider.isPending ? "保存中…" : "保存配置"}
                    </button>
                    {organization?.provider.configured ? (
                      <button
                        type="button"
                        onClick={() => setEditingProvider(false)}
                        className="ml-2 h-9 rounded-btn border border-line2 bg-transparent px-4 text-[12px] text-ink-muted"
                      >
                        取消
                      </button>
                    ) : null}
                  </section>
                ) : (
                  <StatusCard
                    icon={<XCircleIcon size={18} />}
                    title="AI 工作摘要暂不可用"
                    detail="请联系组织管理员配置 AI 模型服务。团队和私聊功能不受影响。"
                    value="未配置"
                    tone="amber"
                  />
                )}
              </div>
            ) : null}

            {step === 4 ? (
              <div className="mt-7 grid gap-3">
                {projects.length > 0 ? (
                  projects.map((project) => (
                    <button
                      type="button"
                      key={project.id}
                      data-testid={`pilot-project-${project.id}`}
                      onClick={() => pilot.setSelectedProjectId(project.id)}
                      className={[
                        "grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-[13px] rounded-card border p-[16px_18px] text-left",
                        project.id === selectedProject?.id
                          ? "border-accent-strong bg-accent-soft"
                          : "border-line bg-panel2",
                      ].join(" ")}
                    >
                      <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-raise font-mono text-[11px]">
                        {initials(project.name)}
                      </span>
                      <span className="grid">
                        <strong className="text-[13px] font-[620]">
                          {project.name}
                        </strong>
                        <small className="mt-1 text-[11px] text-ink-muted">
                          共享结构化工作摘要 · 不上传原始内容
                        </small>
                      </span>
                      <span className="rounded-pill bg-green-soft px-2.5 py-1 text-[10.5px] text-green">
                        {postureLabel(project.posture)}
                      </span>
                    </button>
                  ))
                ) : (
                  <section className="rounded-card border border-line bg-panel2 p-5">
                    <Field
                      label="项目名称"
                      value={projectName}
                      onChange={setProjectName}
                      testId="pilot-project-name"
                    />
                    <button
                      type="button"
                      data-testid="pilot-project-submit"
                      disabled={!selectedTeam || createProject.isPending}
                      onClick={() => createProject.mutate()}
                      className="mt-4 h-9 rounded-btn border-0 bg-accent-strong px-4 text-[12.5px] font-[620] text-on-accent disabled:opacity-50"
                    >
                      {createProject.isPending ? "创建中…" : "创建项目"}
                    </button>
                  </section>
                )}
              </div>
            ) : null}

            {mutationError ? (
              <p
                role="alert"
                data-testid="pilot-setup-error"
                className="mt-4 rounded-[11px] bg-danger-soft p-3 text-[12px] text-danger"
              >
                {mutationError.message}
              </p>
            ) : null}
          </div>
        </div>

        <footer className="flex items-center gap-3 border-t border-line bg-panel p-[18px_44px]">
          <button
            type="button"
            disabled={step === 1}
            onClick={() => setStep((current) => Math.max(1, current - 1))}
            className="h-9 rounded-btn border border-line2 bg-transparent px-[15px] text-[12.5px] disabled:opacity-40"
          >
            上一步
          </button>
          <span className="font-mono text-[11px] text-faint">
            {step} / {STEPS.length}
          </span>
          <span className="h-[3px] flex-1 overflow-hidden rounded-[2px] bg-raise">
            <span
              className="block h-[3px] bg-accent-strong"
              style={{ width: `${Math.round((step / STEPS.length) * 100)}%` }}
            />
          </span>
          <button
            type="button"
            data-testid="pilot-setup-next"
            disabled={!canContinue}
            onClick={() =>
              step === STEPS.length
                ? onDone()
                : setStep((current) => current + 1)
            }
            className="h-9 rounded-btn border-0 bg-accent-strong px-[17px] text-[12.5px] font-[620] text-on-accent disabled:opacity-40"
          >
            {step === STEPS.length ? "完成初始化" : "下一步"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  testId,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  testId?: string;
}) {
  return (
    <label className="mt-3 grid gap-2 first:mt-0">
      <span className="text-[10.5px] font-[620] tracking-[0.06em] text-faint">
        {label}
      </span>
      <input
        type={type}
        value={value}
        data-testid={testId}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-btn border border-line2 bg-transparent px-3 text-[12.5px] text-ink outline-none placeholder:text-faint focus:border-accent-strong"
      />
    </label>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-3 grid gap-2 first:mt-0">
      <span className="text-[10.5px] font-[620] tracking-[0.06em] text-faint">
        {label}
      </span>
      <span className="rounded-btn border border-line bg-raise px-3 py-2.5 font-mono text-[11.5px] text-ink-muted">
        {value}
      </span>
    </div>
  );
}

function StatusCard({
  icon,
  title,
  detail,
  value,
  tone,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  value: string;
  tone: "green" | "amber";
}) {
  return (
    <section className="grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-[13px] rounded-card border border-line bg-panel2 p-[16px_18px]">
      <span
        className={
          tone === "green"
            ? "grid h-9 w-9 place-items-center rounded-[10px] bg-raise text-green"
            : "grid h-9 w-9 place-items-center rounded-[10px] bg-raise text-amber"
        }
      >
        {icon}
      </span>
      <span className="grid">
        <strong className="text-[13px] font-[620]">{title}</strong>
        <small className="mt-1 text-[11px] text-ink-muted">{detail}</small>
      </span>
      <span
        className={
          tone === "green"
            ? "rounded-pill bg-green-soft px-2.5 py-1 text-[11px] font-[600] text-green"
            : "rounded-pill bg-amber-soft px-2.5 py-1 text-[11px] font-[600] text-amber"
        }
      >
        {value}
      </span>
    </section>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label="Copy join link"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
      }}
      className="grid h-9 w-9 place-items-center rounded-btn border border-line2 bg-transparent text-ink-muted"
    >
      {copied ? (
        <CheckIcon size={14} className="text-green" />
      ) : (
        <CopyIcon size={14} />
      )}
    </button>
  );
}

function stepTitle(step: number): string {
  return [
    "选择你的身份",
    "连接 Intero 并加入团队",
    "配置 AI 模型服务",
    "选择要协作的项目",
  ][step - 1]!;
}

function stepBody(step: number): string {
  return [
    "请选择一个成员身份进入 Intero。每个浏览器会分别记住选择，便于使用不同身份体验团队协作。",
    "管理员可以创建组织和初始团队；团队成员则使用管理员分享的加入链接进入。",
    "AI 模型用于生成团队可见的安全摘要和协调建议。API 密钥仅保存在 Intero 服务端。",
    "创建或选择首个 Project。Coding Agent 由成员稍后从 Team Pulse 或 Project 页面按需连接。",
  ][step - 1]!;
}

function postureLabel(posture: PilotCollaborationPosture): string {
  if (posture === "collaborative") return "团队协作";
  if (posture === "paused") return "已暂停";
  return "仅自己可见";
}
