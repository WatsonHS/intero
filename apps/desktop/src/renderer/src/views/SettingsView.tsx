import {
  CheckIcon,
  CircleHalfIcon,
  CloudCheckIcon,
  CloudSlashIcon,
  FolderOpenIcon,
  KeyIcon,
  MoonIcon,
  PathIcon,
  PlugsIcon,
  ShootingStarIcon,
  SunIcon,
  TimerIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  getCodingAgentIntegrations,
  getLocalRuntimeStatus,
  getTeamPulse,
  manageCodingAgentIntegration,
  previewCodingAgentIntegration,
  setModelEgress,
} from "../api.js";
import { ACCENTS, lum, useTheme } from "../design/theme.js";
import { staleAfterMinutes } from "../design/utils.js";
import { type Locale, type TranslationKey, useI18n } from "../i18n/index.js";
import {
  configurePilotProvider,
  createPilotAgentTicket,
  disconnectPilotAgent,
  getPilotOverview,
  updatePilotDeploymentEndpoint,
} from "../pilot/api.js";
import { usePilotOptional } from "../pilot/context.js";
import { OnboardingAdminSettings } from "./settings/OnboardingAdminSettings.js";

const EGRESS_CHOICES: Array<{
  value: ModelEgressMode;
  labelKey: TranslationKey;
  detailKey: TranslationKey;
}> = [
  {
    value: "managed_api",
    labelKey: "settings.egress.managed",
    detailKey: "settings.egress.managedDetail",
  },
  {
    value: "user_provided_api",
    labelKey: "settings.egress.user",
    detailKey: "settings.egress.userDetail",
  },
  {
    value: "disabled",
    labelKey: "settings.egress.disabled",
    detailKey: "settings.egress.disabledDetail",
  },
];

export function SettingsView({
  onOpenSetup,
  onOpenTestSetup,
}: {
  onOpenSetup: () => void;
  onOpenTestSetup?: () => void;
}) {
  const { locale, setLocale, t } = useI18n();
  const {
    accent,
    mode,
    preference,
    reduceMotion,
    setAccent,
    setPreference,
    setReduceMotion,
  } = useTheme();
  const queryClient = useQueryClient();
  const pilot = usePilotOptional();
  const [editingPilotProvider, setEditingPilotProvider] = useState(false);
  const [pilotProviderEndpoint, setPilotProviderEndpoint] = useState("");
  const [pilotProviderKey, setPilotProviderKey] = useState("");
  const [pilotProviderModel, setPilotProviderModel] = useState("");
  const [editingDeployment, setEditingDeployment] = useState(false);
  const [deploymentEndpoint, setDeploymentEndpoint] = useState("");
  const [agentPrompt, setAgentPrompt] = useState<{
    client: "codex" | "claude-code" | "opencode";
    prompt: string;
  }>();
  const pilotProject =
    pilot?.projects.data?.projects.find(
      (project) => project.id === pilot.selectedProjectId,
    ) ?? pilot?.projects.data?.projects[0];

  const local = useQuery({
    queryKey: ["local-runtime-status"],
    queryFn: getLocalRuntimeStatus,
    refetchInterval: 5_000,
  });
  const updateEgress = useMutation({
    mutationFn: setModelEgress,
    onSuccess: ({ modelEgress }) => {
      queryClient.setQueryData<LocalRuntimeStatus>(
        ["local-runtime-status"],
        (current) =>
          current?.available ? { ...current, modelEgress } : current,
      );
    },
  });
  const integrations = useQuery({
    queryKey: ["coding-agent-integrations"],
    queryFn: getCodingAgentIntegrations,
    refetchInterval: 10_000,
  });
  const manageIntegration = useMutation({
    mutationFn: async (input: {
      adapter: CodingAgentAdapter;
      action: CodingAgentIntegrationAction;
    }) => {
      const preview = await previewCodingAgentIntegration({
        ...input,
        locale,
      });
      if (!preview) return undefined;
      return manageCodingAgentIntegration({
        adapter: input.adapter,
        token: preview.token,
      });
    },
    onSuccess: (next) => {
      if (next) queryClient.setQueryData(["coding-agent-integrations"], next);
    },
  });
  const pulse = useQuery({
    queryKey: ["team-pulse"],
    queryFn: ({ signal }) => getTeamPulse(signal),
  });
  const pilotOverview = useQuery({
    queryKey: ["pilot", "overview", pilot?.identityId, pilotProject?.id],
    queryFn: ({ signal }) =>
      getPilotOverview(pilot!.identityId!, pilotProject!.id, signal),
    enabled: Boolean(pilot?.enabled && pilot.identityId && pilotProject),
    refetchInterval: 2_000,
  });
  const disconnectAgent = useMutation({
    mutationFn: (bindingId: string) =>
      disconnectPilotAgent(pilot!.identityId!, bindingId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["pilot", "overview"] });
    },
  });
  const configureProvider = useMutation({
    mutationFn: () =>
      configurePilotProvider(pilot!.identityId!, {
        endpoint: pilotProviderEndpoint,
        apiKey: pilotProviderKey,
        defaultModel: pilotProviderModel,
      }),
    onSuccess: async () => {
      setPilotProviderKey("");
      setEditingPilotProvider(false);
      await queryClient.invalidateQueries({ queryKey: ["pilot"] });
    },
  });
  const updateDeployment = useMutation({
    mutationFn: () => updatePilotDeploymentEndpoint(deploymentEndpoint),
    onSuccess: async () => {
      setEditingDeployment(false);
      await queryClient.invalidateQueries({ queryKey: ["pilot"] });
    },
  });
  const connectAgent = useMutation({
    mutationFn: (client: "codex" | "claude-code" | "opencode") =>
      createPilotAgentTicket(pilot!.identityId!, pilotProject!.id, client),
    onSuccess: (result, client) => {
      setAgentPrompt({ client, prompt: result.connectPrompt });
    },
  });

  const localState = local.data?.available ? local.data : undefined;
  const unavailableReason =
    local.data && !local.data.available ? local.data.reason : undefined;
  const connected = localState !== undefined;
  const egress = localState?.modelEgress;
  const currentAccent = ACCENTS.find((a) => a.hex === accent) ?? ACCENTS[0]!;
  const configuredCount =
    integrations.data?.filter((integration) => integration.configured).length ??
    0;
  const pilotOrganization = pilot?.bootstrap.data?.organization;
  const isPilotAdministrator =
    pilot?.bootstrap.data?.organizationRole === "admin";

  function openPilotProviderEditor() {
    setPilotProviderEndpoint(
      pilotOrganization?.provider.endpoint ?? "https://api.openai.com/v1",
    );
    setPilotProviderModel(
      pilotOrganization?.provider.defaultModel ?? "gpt-5.4",
    );
    setPilotProviderKey("");
    setEditingPilotProvider(true);
  }

  return (
    <div className="animate-view-enter h-full overflow-auto p-[34px_34px_70px]">
      <div className="max-w-[820px]">
        <p className="text-[11px] font-[650] tracking-[0.1em] text-accent-strong">
          {t("settings.eyebrow")}
        </p>
        <h1 className="mt-2.5 text-[28px] font-[540] tracking-[-0.035em]">
          {t("settings.title")}
        </h1>
        <p className="mt-3 max-w-[560px] text-[13px] leading-[1.75] text-ink-muted [text-wrap:pretty]">
          {t("settings.lede")}
        </p>

        {/* 外观 */}
        <div className="mt-7">
          <strong className="text-[14px] font-[620]">
            {t("settings.appearance")}
          </strong>
          <p className="mt-2 max-w-[520px] text-[12px] leading-[1.7] text-ink-muted">
            {t("settings.appearanceLede")}
          </p>
          <div className="mt-3.5 grid grid-cols-2 gap-3">
            <div className="rounded-[13px] border border-line bg-panel2 p-[16px_18px]">
              <div className="flex items-center gap-2.5">
                <span className="text-[12px] text-ink-muted">
                  {t("settings.accent")}
                </span>
                <span className="ml-auto font-mono text-[10.5px] text-faint">
                  {currentAccent.name} · {accent}
                </span>
              </div>
              <div className="mt-3.5 flex gap-2.5">
                {ACCENTS.map((option) => {
                  const selected = option.hex === accent;
                  const ink = lum(option.hex) > 0.62 ? "#1a1710" : "#fffaf2";
                  return (
                    <button
                      key={option.hex}
                      type="button"
                      title={option.name}
                      onClick={() => setAccent(option.hex)}
                      className={[
                        "grid h-8 w-8 cursor-pointer place-items-center rounded-full border-2",
                        selected ? "border-ink" : "border-transparent",
                      ].join(" ")}
                      style={{ background: option.hex }}
                    >
                      {selected ? (
                        <CheckIcon size={13} weight="fill" color={ink} />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="rounded-[13px] border border-line bg-panel2 p-[16px_18px]">
              <span className="text-[12px] text-ink-muted">
                {t("settings.theme")}
              </span>
              <div className="mt-3.5 grid grid-cols-3 gap-[9px]">
                {(
                  [
                    {
                      id: "system",
                      label: t("settings.system"),
                      icon: <CircleHalfIcon size={14} />,
                    },
                    {
                      id: "light",
                      label: t("settings.light"),
                      icon: <SunIcon size={14} />,
                    },
                    {
                      id: "dark",
                      label: t("settings.dark"),
                      icon: <MoonIcon size={14} />,
                    },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={preference === option.id}
                    onClick={() => setPreference(option.id)}
                    className={[
                      "flex h-[34px] cursor-pointer items-center justify-center gap-2 rounded-[9px] border px-3 text-[12px]",
                      preference === option.id
                        ? "border-accent-strong bg-accent-soft"
                        : "border-line2 hover:border-accent-strong",
                    ].join(" ")}
                  >
                    {option.icon}
                    {option.label}
                  </button>
                ))}
              </div>
              {preference === "system" ? (
                <p className="mt-2.5 text-[10.5px] text-faint">
                  {t("settings.systemNow", {
                    mode:
                      mode === "dark"
                        ? t("settings.dark")
                        : t("settings.light"),
                  })}
                </p>
              ) : null}
            </div>
          </div>
        </div>

        {/* 减少动态效果 */}
        <button
          type="button"
          onClick={() => setReduceMotion(!reduceMotion)}
          className="mt-3 grid w-full cursor-pointer grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-[13px] rounded-[13px] border border-line bg-panel2 p-[16px_18px] text-left hover:border-accent-strong"
        >
          <span className="grid h-[34px] w-[34px] place-items-center rounded-[10px] bg-raise text-ink-muted">
            <ShootingStarIcon size={16} />
          </span>
          <span className="grid">
            <strong className="text-[12.5px] font-[620]">
              {t("settings.motionTitle")}
            </strong>
            <small className="mt-1 text-[11px] leading-[1.6] text-ink-muted [text-wrap:pretty]">
              {t("settings.motionDetail")}
            </small>
          </span>
          <span
            className={[
              "inline-flex h-6 w-[42px] items-center rounded-pill p-[3px] transition-colors duration-200",
              reduceMotion
                ? "justify-end bg-accent-strong"
                : "justify-start bg-raise",
            ].join(" ")}
          >
            <span
              className={[
                "h-[18px] w-[18px] rounded-full",
                reduceMotion ? "bg-on-accent" : "bg-faint",
              ].join(" ")}
            />
          </span>
        </button>

        {/* 界面语言 */}
        <div className="mt-3 rounded-[13px] border border-line bg-panel2 p-[16px_18px]">
          <span className="text-[12px] text-ink-muted">
            {t("settings.language")}
          </span>
          <p className="mt-1.5 text-[11px] text-faint">
            {t("settings.languageDetail")}
          </p>
          <div className="mt-3.5 grid grid-cols-2 gap-[9px]">
            <LanguageOption
              value="zh-CN"
              current={locale}
              label={t("settings.chinese")}
              onSelect={setLocale}
            />
            <LanguageOption
              value="en-US"
              current={locale}
              label={t("settings.english")}
              onSelect={setLocale}
            />
          </div>
        </div>

        {/* Workspaces */}
        <div className="mt-8">
          <div className="flex items-center gap-2.5">
            <strong className="text-[14px] font-[620]">
              {t("settings.workspaces")}
            </strong>
            <span className="text-[11px] text-faint">
              {t("settings.workspacesHint")}
            </span>
          </div>
          <div className="mt-3.5 flex flex-col gap-2">
            {localState
              ? localState.workspaces.map((workspace) => (
                  <div
                    key={workspace.id}
                    className="grid grid-cols-[34px_minmax(0,1fr)_auto_auto] items-center gap-[13px] rounded-[13px] border border-line bg-panel2 p-[14px_16px]"
                  >
                    <span className="grid h-[34px] w-[34px] place-items-center rounded-[10px] bg-raise text-ink-muted">
                      <FolderOpenIcon size={16} />
                    </span>
                    <span className="grid min-w-0">
                      <strong className="truncate font-mono text-[12px] font-[500]">
                        {workspace.root}
                      </strong>
                      <small className="mt-1 text-[10.5px] text-faint">
                        {workspaceName(workspace.root)}
                      </small>
                    </span>
                    <span
                      className={[
                        "rounded-pill px-2.5 py-1 text-[10.5px] font-[620]",
                        workspace.revoked
                          ? "bg-raise text-faint"
                          : "bg-green-soft text-green",
                      ].join(" ")}
                    >
                      {workspace.revoked
                        ? t("settings.workspaceRevoked")
                        : t("settings.workspaceActive")}
                    </span>
                    <span className="text-[11px] text-ink-muted">
                      {t("settings.managedByDaemon")}
                    </span>
                  </div>
                ))
              : null}
            {localState && localState.workspaces.length === 0 ? (
              <p className="text-[12px] text-ink-muted">
                {t("settings.noWorkspaces")}
              </p>
            ) : null}
            {local.isPending ? (
              <p className="text-[12px] text-ink-muted">
                {t("general.loading")}
              </p>
            ) : null}
            {!local.isPending && !connected ? (
              <p className="text-[12px] text-danger">
                {unavailableReason === "desktop_required"
                  ? t("settings.desktopRequired")
                  : t("settings.daemonUnavailable")}
              </p>
            ) : null}
          </div>
        </div>

        {/* 本地运行时 */}
        <div className="mt-8">
          <strong className="text-[14px] font-[620]">
            {t("settings.localRuntime")}
          </strong>
          <div className="mt-3.5 flex flex-col gap-2">
            <div className="grid grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-[13px] rounded-[13px] border border-line bg-panel2 p-[15px_16px]">
              <span className="grid h-[34px] w-[34px] place-items-center rounded-[10px] bg-raise text-ink-muted">
                <CloudSlashIcon size={16} />
              </span>
              <span className="grid">
                <strong className="text-[12.5px] font-[620]">
                  {t("settings.egress")}
                </strong>
                <small className="mt-1 text-[11px] leading-[1.6] text-ink-muted [text-wrap:pretty]">
                  {t("settings.egressDetail")}
                </small>
              </span>
              <span className="inline-flex items-center gap-1 rounded-pill border border-line2 p-[3px]">
                {EGRESS_CHOICES.map((choice) => {
                  const selected = egress === choice.value;
                  return (
                    <button
                      key={choice.value}
                      type="button"
                      title={t(choice.detailKey)}
                      disabled={!connected || updateEgress.isPending}
                      onClick={() => updateEgress.mutate(choice.value)}
                      className={[
                        "cursor-pointer rounded-pill px-2.5 py-1 text-[10.5px] font-[620]",
                        "disabled:cursor-not-allowed disabled:opacity-55",
                        selected
                          ? choice.value === "disabled"
                            ? "bg-green-soft text-green"
                            : "bg-accent-soft text-accent-strong"
                          : "text-faint hover:text-ink",
                      ].join(" ")}
                    >
                      {t(choice.labelKey)}
                    </button>
                  );
                })}
              </span>
            </div>
            {updateEgress.isError ? (
              <p className="text-[11px] text-danger">
                {t("settings.egressFailed")}
              </p>
            ) : null}

            {localState?.health.encryptedStorage ? (
              <div className="grid grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-[13px] rounded-[13px] border border-line bg-panel2 p-[15px_16px]">
                <span className="grid h-[34px] w-[34px] place-items-center rounded-[10px] bg-raise text-ink-muted">
                  <KeyIcon size={16} />
                </span>
                <span className="grid">
                  <strong className="text-[12.5px] font-[620]">
                    {t("settings.storage")}
                  </strong>
                  <small className="mt-1 text-[11px] leading-[1.6] text-ink-muted [text-wrap:pretty]">
                    {t("settings.storageDetail")}
                  </small>
                </span>
                <span className="rounded-pill bg-green-soft px-2.5 py-1 text-[11px] font-[600] text-green">
                  {t("settings.storageReady")}
                </span>
              </div>
            ) : null}

            <div className="grid grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-[13px] rounded-[13px] border border-line bg-panel2 p-[15px_16px]">
              <span className="grid h-[34px] w-[34px] place-items-center rounded-[10px] bg-raise text-ink-muted">
                <PlugsIcon size={16} />
              </span>
              <span className="grid">
                <strong className="text-[12.5px] font-[620]">
                  {t("settings.adapters")}
                </strong>
                <small className="mt-1 text-[11px] leading-[1.6] text-ink-muted [text-wrap:pretty]">
                  {t("settings.adaptersDetail")}
                </small>
              </span>
              <span className="rounded-pill bg-green-soft px-2.5 py-1 text-[11px] font-[600] text-green">
                {t("settings.adaptersConnected", { count: configuredCount })}
              </span>
            </div>
            <p className="text-[11px] text-faint">
              {t("settings.integrationDisclosure")}
            </p>
            <div className="flex flex-col gap-2">
              {integrations.data?.map((integration) => (
                <IntegrationCard
                  key={integration.adapter}
                  integration={integration}
                  busy={
                    manageIntegration.isPending &&
                    manageIntegration.variables?.adapter === integration.adapter
                  }
                  onAction={(action) => {
                    manageIntegration.mutate({
                      adapter: integration.adapter,
                      action,
                    });
                  }}
                />
              ))}
              {integrations.isPending ? (
                <p className="text-[12px] text-ink-muted">
                  {t("general.loading")}
                </p>
              ) : null}
              {!integrations.isPending && integrations.data?.length === 0 ? (
                <p className="text-[12px] text-danger">
                  {t("settings.desktopRequired")}
                </p>
              ) : null}
              {manageIntegration.isError || integrations.isError ? (
                <p className="text-[12px] text-danger" role="alert">
                  {t("settings.integrationActionFailed")}
                </p>
              ) : null}
            </div>

            <div className="grid grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-[13px] rounded-[13px] border border-line bg-panel2 p-[15px_16px]">
              <span className="grid h-[34px] w-[34px] place-items-center rounded-[10px] bg-raise text-ink-muted">
                <TimerIcon size={16} />
              </span>
              <span className="grid">
                <strong className="text-[12.5px] font-[620]">
                  {t("settings.freshnessThreshold")}
                </strong>
                <small className="mt-1 text-[11px] leading-[1.6] text-ink-muted [text-wrap:pretty]">
                  {t("settings.freshnessDetail")}
                </small>
              </span>
              <span className="rounded-pill bg-raise px-2.5 py-1 text-[11px] font-[600] text-faint">
                {pulse.isPending
                  ? t("general.unavailable")
                  : t("settings.freshnessValue", {
                      minutes: staleAfterMinutes(pulse.data?.staleAfterSeconds),
                    })}
              </span>
            </div>
          </div>
        </div>

        {pilot?.enabled && pilot.identityId ? (
          <OnboardingAdminSettings />
        ) : null}

        {pilot?.enabled ? (
          <div className="mt-8" data-testid="pilot-cloud-settings">
            <strong className="text-[14px] font-[620]">Intero 云服务</strong>
            <p className="mt-2 max-w-[560px] text-[12px] leading-[1.7] text-ink-muted">
              查看当前部署、模型服务和 Agent 连接。模型服务密钥仅保存在 Intero
              服务端，不会返回给浏览器或团队成员。
            </p>
            <div className="mt-3.5 grid gap-3">
              <div className="rounded-[13px] border border-line bg-panel2 p-[15px_16px]">
                <div className="grid grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-[13px]">
                  <span className="grid h-[34px] w-[34px] place-items-center rounded-[10px] bg-raise text-green">
                    <CloudCheckIcon size={16} />
                  </span>
                  <span className="grid">
                    <strong className="text-[12.5px] font-[620]">
                      Intero 部署地址
                    </strong>
                    <small className="mt-1 truncate font-mono text-[11px] text-ink-muted">
                      {pilotOrganization?.deploymentBaseUrl ??
                        "尚未配置 Intero 部署"}
                    </small>
                  </span>
                  {isPilotAdministrator ? (
                    <button
                      type="button"
                      data-testid="deployment-endpoint-edit"
                      onClick={() => {
                        setDeploymentEndpoint(
                          pilotOrganization?.deploymentBaseUrl ?? "",
                        );
                        setEditingDeployment(true);
                      }}
                      className="h-8 rounded-btn border border-line2 bg-transparent px-3 text-[11.5px] hover:border-accent-strong"
                    >
                      修改并重新校验
                    </button>
                  ) : (
                    <span className="rounded-pill bg-raise px-2.5 py-1 text-[10.5px] text-faint">
                      继承组织配置
                    </span>
                  )}
                </div>
                {editingDeployment ? (
                  <div className="mt-4 flex gap-2 border-t border-line pt-4">
                    <input
                      type="url"
                      value={deploymentEndpoint}
                      onChange={(event) =>
                        setDeploymentEndpoint(event.target.value)
                      }
                      data-testid="deployment-endpoint-input"
                      className="h-9 min-w-0 flex-1 rounded-btn border border-line2 bg-raise px-3 font-mono text-[11.5px] outline-none focus:border-accent-strong"
                    />
                    <button
                      type="button"
                      disabled={
                        !deploymentEndpoint.trim() || updateDeployment.isPending
                      }
                      onClick={() => updateDeployment.mutate()}
                      className="h-9 rounded-btn border-0 bg-accent-strong px-4 text-[12px] font-[620] text-on-accent disabled:opacity-50"
                    >
                      {updateDeployment.isPending ? "校验中…" : "校验并保存"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingDeployment(false)}
                      className="h-9 rounded-btn border border-line2 bg-transparent px-3 text-[12px]"
                    >
                      取消
                    </button>
                  </div>
                ) : null}
                {updateDeployment.isError ? (
                  <p className="mt-3 text-[11px] text-danger" role="alert">
                    无法通过该地址访问 Intero 健康检查，配置未保存。
                  </p>
                ) : null}
              </div>

              <div
                className="rounded-[13px] border border-line bg-panel2 p-[15px_16px]"
                data-testid="pilot-provider-settings"
              >
                <div className="grid grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-[13px]">
                  <span
                    className={[
                      "grid h-[34px] w-[34px] place-items-center rounded-[10px] bg-raise",
                      pilotOrganization?.provider.configured
                        ? "text-green"
                        : "text-ink-muted",
                    ].join(" ")}
                  >
                    <KeyIcon size={16} />
                  </span>
                  <span className="grid min-w-0">
                    <strong className="text-[12.5px] font-[620]">
                      模型服务
                    </strong>
                    <small className="mt-1 truncate text-[11px] text-ink-muted">
                      {pilotOrganization?.provider.configured
                        ? `${pilotOrganization.provider.endpoint} · ${pilotOrganization.provider.defaultModel}`
                        : "尚未配置；替身和 Agent 工作摘要暂不可用"}
                    </small>
                  </span>
                  {isPilotAdministrator ? (
                    <button
                      type="button"
                      data-testid="pilot-provider-settings-edit"
                      onClick={openPilotProviderEditor}
                      className="h-8 rounded-btn border border-line2 bg-transparent px-3 text-[11.5px] text-ink hover:border-accent-strong"
                    >
                      {pilotOrganization?.provider.configured
                        ? "修改配置"
                        : "配置模型服务"}
                    </button>
                  ) : (
                    <span className="rounded-pill bg-raise px-2.5 py-1 text-[10.5px] text-faint">
                      {pilotOrganization?.provider.configured
                        ? "已配置"
                        : "未配置"}
                    </span>
                  )}
                </div>

                {editingPilotProvider ? (
                  <div
                    className="mt-4 grid gap-3 border-t border-line pt-4"
                    data-testid="pilot-provider-settings-form"
                  >
                    <label className="grid gap-1.5">
                      <span className="text-[11px] text-ink-muted">
                        服务地址
                      </span>
                      <input
                        type="url"
                        value={pilotProviderEndpoint}
                        onChange={(event) =>
                          setPilotProviderEndpoint(event.target.value)
                        }
                        data-testid="pilot-provider-settings-endpoint"
                        className="h-9 rounded-btn border border-line2 bg-raise px-3 font-mono text-[11.5px] text-ink outline-none focus:border-accent-strong"
                      />
                    </label>
                    <label className="grid gap-1.5">
                      <span className="text-[11px] text-ink-muted">
                        API 密钥
                      </span>
                      <input
                        type="password"
                        value={pilotProviderKey}
                        onChange={(event) =>
                          setPilotProviderKey(event.target.value)
                        }
                        placeholder="修改配置时需重新输入"
                        autoComplete="new-password"
                        data-testid="pilot-provider-settings-key"
                        className="h-9 rounded-btn border border-line2 bg-raise px-3 font-mono text-[11.5px] text-ink outline-none placeholder:text-faint focus:border-accent-strong"
                      />
                    </label>
                    <label className="grid gap-1.5">
                      <span className="text-[11px] text-ink-muted">
                        默认模型
                      </span>
                      <input
                        value={pilotProviderModel}
                        onChange={(event) =>
                          setPilotProviderModel(event.target.value)
                        }
                        data-testid="pilot-provider-settings-model"
                        className="h-9 rounded-btn border border-line2 bg-raise px-3 font-mono text-[11.5px] text-ink outline-none focus:border-accent-strong"
                      />
                    </label>
                    <p className="text-[10.5px] leading-[1.6] text-faint">
                      出于安全考虑，Intero
                      不会回显已有密钥；保存修改时需要重新输入。
                    </p>
                    {configureProvider.isError ? (
                      <p className="text-[11px] text-danger" role="alert">
                        保存失败，请检查服务地址、密钥和模型名称后重试。
                      </p>
                    ) : null}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        data-testid="pilot-provider-settings-submit"
                        disabled={
                          !pilotProviderEndpoint.trim() ||
                          !pilotProviderKey.trim() ||
                          !pilotProviderModel.trim() ||
                          configureProvider.isPending
                        }
                        onClick={() => configureProvider.mutate()}
                        className="h-9 rounded-btn border-0 bg-accent-strong px-4 text-[12px] font-[620] text-on-accent disabled:opacity-50"
                      >
                        {configureProvider.isPending
                          ? "保存中…"
                          : "保存模型服务配置"}
                      </button>
                      <button
                        type="button"
                        disabled={configureProvider.isPending}
                        onClick={() => {
                          setPilotProviderKey("");
                          setEditingPilotProvider(false);
                        }}
                        className="h-9 rounded-btn border border-line2 bg-transparent px-4 text-[12px] text-ink-muted hover:border-accent-strong"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              {(pilotOverview.data?.bindings ?? [])
                .filter((binding) => !binding.disconnectedAt)
                .map((binding) => (
                  <div
                    key={binding.id}
                    className="grid grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-[13px] rounded-[13px] border border-line bg-panel2 p-[15px_16px]"
                  >
                    <span className="grid h-[34px] w-[34px] place-items-center rounded-[10px] bg-raise text-green">
                      <PlugsIcon size={16} />
                    </span>
                    <span className="grid">
                      <strong className="text-[12.5px] font-[620]">
                        {binding.name}
                      </strong>
                      <small className="mt-1 text-[11px] text-ink-muted">
                        {binding.client} · {pilotProject?.name} ·{" "}
                        {binding.lastSeenAt ? "已收到工作动态" : "已连接"}
                      </small>
                    </span>
                    {binding.ownerId === pilot?.identityId ? (
                      <button
                        type="button"
                        data-testid={`pilot-agent-disconnect-${binding.client}`}
                        disabled={disconnectAgent.isPending}
                        onClick={() => disconnectAgent.mutate(binding.id)}
                        className="h-8 rounded-btn border border-line2 bg-transparent px-3 text-[11.5px] hover:border-danger hover:text-danger"
                      >
                        断开
                      </button>
                    ) : null}
                  </div>
                ))}
              {pilotProject ? (
                <div
                  className="rounded-[13px] border border-line bg-panel2 p-[15px_16px]"
                  data-testid="agent-connection-settings"
                >
                  <strong className="text-[12.5px] font-[620]">
                    连接 Coding Agent
                  </strong>
                  <p className="mt-1.5 text-[10.5px] leading-[1.6] text-ink-muted">
                    生成一次性项目连接提示。无需手动创建或管理 API Key。
                  </p>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {(
                      [
                        ["codex", "Codex"],
                        ["claude-code", "Claude Code"],
                        ["opencode", "OpenCode"],
                      ] as const
                    ).map(([client, label]) => {
                      const active = pilotOverview.data?.bindings.some(
                        (binding) =>
                          binding.client === client &&
                          binding.ownerId === pilot.identityId &&
                          !binding.disconnectedAt,
                      );
                      return (
                        <button
                          key={client}
                          type="button"
                          disabled={
                            active ||
                            connectAgent.isPending ||
                            !pilotOrganization?.provider.configured
                          }
                          data-testid={`connect-agent-${client}`}
                          onClick={() => connectAgent.mutate(client)}
                          className="h-9 rounded-btn border border-line2 bg-transparent px-3 text-[11px] hover:border-accent-strong disabled:opacity-50"
                        >
                          {active ? `${label} 已连接` : `连接 ${label}`}
                        </button>
                      );
                    })}
                  </div>
                  {agentPrompt ? (
                    <div className="mt-3 grid gap-2 border-t border-line pt-3">
                      <span className="text-[10.5px] text-ink-muted">
                        将以下提示粘贴到{" "}
                        {agentPrompt.client === "claude-code"
                          ? "Claude Code"
                          : agentPrompt.client === "opencode"
                            ? "OpenCode"
                            : "Codex"}
                        ：
                      </span>
                      <textarea
                        readOnly
                        rows={5}
                        value={agentPrompt.prompt}
                        data-testid="agent-connect-prompt"
                        className="resize-none rounded-[9px] border border-line bg-bg p-3 font-mono text-[10px] leading-[1.55] text-ink-muted outline-none"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          navigator.clipboard.writeText(agentPrompt.prompt)
                        }
                        className="justify-self-start h-8 rounded-btn border border-line2 bg-transparent px-3 text-[11px] hover:border-accent-strong"
                      >
                        复制连接提示
                      </button>
                    </div>
                  ) : null}
                  {connectAgent.isError ? (
                    <p className="mt-3 text-[11px] text-danger" role="alert">
                      无法生成连接提示。请先确认模型服务已配置。
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* 重新运行首次引导 */}
        <div className="mt-8 flex items-center gap-3 rounded-[13px] border border-dashed border-line2 p-[16px_18px]">
          <PathIcon size={17} className="text-accent-strong" />
          <span className="grid">
            <strong className="text-[12.5px] font-[620]">
              {t("settings.rerunSetup")}
            </strong>
            <small className="mt-1 text-[11px] text-ink-muted">
              {t("settings.rerunSetupDetail")}
            </small>
          </span>
          <button
            type="button"
            onClick={onOpenSetup}
            className="ml-auto h-8 cursor-pointer rounded-btn border border-line2 bg-transparent px-3.5 text-[12px] text-ink hover:border-accent-strong"
          >
            {t("general.open")}
          </button>
        </div>

        {onOpenTestSetup ? (
          <div
            className="mt-3 flex items-center gap-3 rounded-[13px] border border-dashed border-accent-soft bg-accent-soft p-[16px_18px]"
            data-testid="test-setup-entry"
          >
            <PathIcon size={17} className="text-accent-strong" />
            <span className="grid">
              <strong className="text-[12.5px] font-[620]">Test Setup</strong>
              <small className="mt-1 text-[11px] text-ink-muted">
                仅开发环境可见，用于验证云部署、团队、Provider、项目与 Agent
                连接。
              </small>
            </span>
            <button
              type="button"
              onClick={onOpenTestSetup}
              className="ml-auto h-8 cursor-pointer rounded-btn border border-accent-strong bg-transparent px-3.5 text-[12px] text-accent-strong"
            >
              打开测试流程
            </button>
          </div>
        ) : null}

        <p className="mt-[26px] max-w-[620px] rounded-[13px] bg-raise p-[16px_18px] text-[11.5px] leading-[1.75] text-faint [text-wrap:pretty]">
          {t("settings.footer")}
        </p>
      </div>
    </div>
  );
}

function IntegrationCard({
  integration,
  busy,
  onAction,
}: {
  integration: CodingAgentIntegrationStatus;
  busy: boolean;
  onAction: (action: CodingAgentIntegrationAction) => void;
}) {
  const { t } = useI18n();
  const configured = integration.configured;
  const action: CodingAgentIntegrationAction =
    integration.state === "needs_repair"
      ? "repair"
      : configured
        ? "uninstall"
        : "install";
  const adapterName =
    integration.adapter === "claude-code"
      ? "Claude Code"
      : integration.adapter === "opencode"
        ? "OpenCode"
        : "Codex";
  const stateKey: TranslationKey = `settings.integrationState.${integration.state}`;
  const actionKey: TranslationKey = `settings.integrationAction.${action}`;
  const stateClass =
    integration.state === "needs_repair"
      ? "bg-danger-soft text-danger"
      : configured
        ? "bg-green-soft text-green"
        : "bg-raise text-faint";

  return (
    <article className="grid grid-cols-[34px_minmax(0,1fr)_auto_auto] items-center gap-[13px] rounded-[13px] border border-line bg-panel2 p-[14px_16px]">
      <span className="grid h-[34px] w-[34px] place-items-center rounded-[10px] bg-raise text-[11px] font-[650] text-ink-muted">
        {adapterName.slice(0, 2).toUpperCase()}
      </span>
      <span className="grid min-w-0">
        <strong className="text-[12.5px] font-[620]">{adapterName}</strong>
        <small className="mt-1 text-[11px] text-ink-muted">
          {integration.detected
            ? integration.version
            : t("settings.notDetected")}
        </small>
      </span>
      <span
        className={`rounded-pill px-2.5 py-1 text-[10.5px] font-[620] ${stateClass}`}
      >
        {t(stateKey)}
      </span>
      <button
        type="button"
        disabled={busy || (!integration.supported && action !== "uninstall")}
        onClick={() => onAction(action)}
        className="h-8 cursor-pointer rounded-btn border border-line2 bg-transparent px-3.5 text-[12px] text-ink hover:border-accent-strong disabled:cursor-not-allowed disabled:opacity-55"
      >
        {busy ? t("settings.integrationWorking") : t(actionKey)}
      </button>
      {integration.state === "pending_trust" ? (
        <p className="col-span-4 text-[10.5px] text-faint">
          {t("settings.codexTrust")}
        </p>
      ) : null}
      {integration.warnings.map((warning) => (
        <p key={warning} className="col-span-4 text-[10.5px] text-faint">
          {warning === "codex_override_shadows_instructions"
            ? t("settings.codexOverrideWarning")
            : warning === "agent_runtime_unreachable"
              ? t("settings.agentRuntimeUnreachable")
              : warning}
        </p>
      ))}
    </article>
  );
}

function LanguageOption({
  value,
  current,
  label,
  onSelect,
}: {
  value: Locale;
  current: Locale;
  label: string;
  onSelect: (locale: Locale) => void;
}) {
  const active = value === current;
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      className={[
        "flex h-[34px] cursor-pointer items-center justify-center gap-2 rounded-[9px] border px-3 text-[12px]",
        active
          ? "border-accent-strong bg-accent-soft"
          : "border-line2 hover:border-accent-strong",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function workspaceName(root: string): string {
  return root.split(/[\\/]/).filter(Boolean).at(-1) ?? root;
}
