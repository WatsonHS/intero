import {
  CheckIcon,
  DesktopTowerIcon,
  EyeSlashIcon,
  GlobeHemisphereWestIcon,
  HardDrivesIcon,
  KeyIcon,
  PlugsConnectedIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getCodingAgentIntegrations,
  getLocalRuntimeStatus,
  manageCodingAgentIntegration,
  previewCodingAgentIntegration,
  setModelEgress,
} from "../api.js";
import { type Locale, type TranslationKey, useI18n } from "../i18n/index.js";

export function SettingsView() {
  const { locale, setLocale, t } = useI18n();
  const queryClient = useQueryClient();
  const local = useQuery({
    queryKey: ["local-runtime-status"],
    queryFn: getLocalRuntimeStatus,
    refetchInterval: 5_000,
  });
  const updatePolicy = useMutation({
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
  const localState = local.data?.available ? local.data : undefined;
  const unavailableReason =
    local.data && !local.data.available ? local.data.reason : undefined;
  const connected = localState !== undefined;
  const egress = localState?.modelEgress;

  return (
    <div className="settings-view">
      <header className="view-header">
        <div>
          <p className="eyebrow">{t("settings.eyebrow")}</p>
          <h1>{t("settings.title")}</h1>
          <p className="view-header__lede">{t("settings.lede")}</p>
        </div>
      </header>

      <section className="settings-section">
        <div className="settings-section__intro">
          <HardDrivesIcon size={22} />
          <div>
            <h2>{t("settings.workspaces")}</h2>
            <p>{t("settings.workspacesDetail")}</p>
          </div>
        </div>
        <div className="settings-content">
          {localState && localState.workspaces.length === 0 ? (
            <p className="quiet-copy">{t("settings.noWorkspaces")}</p>
          ) : null}
          {localState
            ? localState.workspaces.map((workspace) => (
                <div className="workspace-setting" key={workspace.id}>
                  <span className="workspace-setting__mark">
                    {workspaceName(workspace.root).slice(0, 2).toUpperCase()}
                  </span>
                  <span>
                    <strong>{workspaceName(workspace.root)}</strong>
                    <small>{workspace.root}</small>
                  </span>
                  <span
                    className={
                      workspace.revoked ? "setting-revoked" : "setting-ok"
                    }
                  >
                    {workspace.revoked ? null : <CheckIcon size={13} />}
                    {workspace.revoked
                      ? t("settings.revoked")
                      : t("settings.active")}
                  </span>
                  <button type="button" disabled>
                    {t("settings.managedByDaemon")}
                  </button>
                </div>
              ))
            : null}
          {local.isPending ? (
            <p className="quiet-copy">{t("general.loading")}</p>
          ) : null}
          {!local.isPending && !connected ? (
            <p className="inline-error">
              {unavailableReason === "desktop_required"
                ? t("settings.desktopRequired")
                : t("settings.daemonUnavailable")}
            </p>
          ) : null}
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section__intro">
          <PlugsConnectedIcon size={22} />
          <div>
            <h2>{t("settings.codingAgents")}</h2>
            <p>{t("settings.codingAgentsDetail")}</p>
          </div>
        </div>
        <div className="settings-content integration-list">
          <p className="integration-disclosure">
            {t("settings.integrationDisclosure")}
          </p>
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
            <p className="quiet-copy">{t("general.loading")}</p>
          ) : null}
          {!integrations.isPending && integrations.data?.length === 0 ? (
            <p className="inline-error">{t("settings.desktopRequired")}</p>
          ) : null}
          {manageIntegration.isError || integrations.isError ? (
            <p className="composer-error" role="alert">
              {t("settings.integrationActionFailed")}
            </p>
          ) : null}
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section__intro">
          <EyeSlashIcon size={22} />
          <div>
            <h2>{t("settings.modelEgress")}</h2>
            <p>{t("settings.modelEgressDetail")}</p>
          </div>
        </div>
        <div className="settings-content">
          <div className="choice-grid">
            <EgressChoice
              value="managed_api"
              checked={egress === "managed_api"}
              disabled={!connected || updatePolicy.isPending}
              title={t("settings.managedApi")}
              detail={t("settings.managedApiDetail")}
              onSelect={updatePolicy.mutate}
            />
            <EgressChoice
              value="user_provided_api"
              checked={egress === "user_provided_api"}
              disabled={!connected || updatePolicy.isPending}
              title={t("settings.userProvider")}
              detail={t("settings.userProviderDetail")}
              onSelect={updatePolicy.mutate}
            />
            <EgressChoice
              value="disabled"
              checked={egress === "disabled"}
              disabled={!connected || updatePolicy.isPending}
              title={t("settings.disabled")}
              detail={t("settings.disabledDetail")}
              onSelect={updatePolicy.mutate}
            />
          </div>
          {updatePolicy.isError ? (
            <p className="composer-error" role="alert">
              {t("settings.policyUpdateFailed")}
            </p>
          ) : null}
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section__intro">
          <GlobeHemisphereWestIcon size={22} />
          <div>
            <h2>{t("settings.language")}</h2>
            <p>{t("settings.languageDetail")}</p>
          </div>
        </div>
        <div className="choice-grid choice-grid--language">
          <LanguageChoice
            locale="zh-CN"
            current={locale}
            label={t("settings.chinese")}
            onSelect={setLocale}
          />
          <LanguageChoice
            locale="en-US"
            current={locale}
            label={t("settings.english")}
            onSelect={setLocale}
          />
        </div>
      </section>

      <section className="settings-section settings-section--split">
        <div className="settings-section__intro">
          <DesktopTowerIcon size={22} />
          <div>
            <h2>{t("settings.localRuntime")}</h2>
            <p>
              {localState
                ? `interod ${localState.health.version} · protocol ${localState.health.protocolVersion}`
                : t("general.unavailable")}
            </p>
          </div>
        </div>
        <div className="runtime-detail">
          <span
            className={
              connected ? "runtime-dot" : "runtime-dot runtime-dot--stale"
            }
          />
          <span>
            <strong>
              {local.isPending
                ? t("general.loading")
                : connected
                  ? t("settings.connected")
                  : t("general.unavailable")}
            </strong>
            <small>{t("settings.localTransport")}</small>
          </span>
        </div>
        {localState?.health.encryptedStorage ? (
          <div className="runtime-detail">
            <KeyIcon size={18} />
            <span>
              <strong>{t("settings.encryptedStorage")}</strong>
              <small>{t("settings.encryptedStorageDetail")}</small>
            </span>
          </div>
        ) : null}
      </section>
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

  return (
    <article className="integration-card">
      <span className="integration-card__mark">
        {adapterName.slice(0, 2).toUpperCase()}
      </span>
      <span className="integration-card__identity">
        <strong>{adapterName}</strong>
        <small>
          {integration.detected
            ? integration.version
            : t("settings.notDetected")}
        </small>
      </span>
      <span
        className={
          integration.state === "needs_repair"
            ? "setting-revoked"
            : configured
              ? "setting-ok"
              : "integration-state"
        }
      >
        {configured ? <CheckIcon size={13} /> : null}
        {t(stateKey)}
      </span>
      <button
        type="button"
        disabled={busy || (!integration.supported && action !== "uninstall")}
        onClick={() => onAction(action)}
      >
        {busy ? t("settings.integrationWorking") : t(actionKey)}
      </button>
      {integration.state === "pending_trust" ? (
        <p>{t("settings.codexTrust")}</p>
      ) : null}
      {integration.warnings.map((warning) => (
        <p key={warning}>
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

function EgressChoice({
  value,
  checked,
  disabled,
  title,
  detail,
  onSelect,
}: {
  value: ModelEgressMode;
  checked: boolean;
  disabled: boolean;
  title: string;
  detail: string;
  onSelect: (value: ModelEgressMode) => void;
}) {
  return (
    <label>
      <input
        type="radio"
        name="egress"
        checked={checked}
        disabled={disabled}
        onChange={() => onSelect(value)}
      />
      <span>
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
    </label>
  );
}

function LanguageChoice({
  locale,
  current,
  label,
  onSelect,
}: {
  locale: Locale;
  current: Locale;
  label: string;
  onSelect: (locale: Locale) => void;
}) {
  return (
    <label>
      <input
        type="radio"
        name="locale"
        checked={locale === current}
        onChange={() => onSelect(locale)}
      />
      <span>
        <strong>{label}</strong>
      </span>
    </label>
  );
}

function workspaceName(root: string): string {
  return root.split(/[\\/]/).filter(Boolean).at(-1) ?? root;
}
