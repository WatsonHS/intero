import {
  CheckCircleIcon,
  CheckIcon,
  CloudSlashIcon,
  FolderOpenIcon,
  KeyIcon,
  ShieldCheckIcon,
  TerminalWindowIcon,
  UserIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  getBootstrap,
  getCodingAgentIntegrations,
  getLocalRuntimeStatus,
  getTeamPulse,
  manageCodingAgentIntegration,
  previewCodingAgentIntegration,
} from "../api.js";
import { confidencePercent, initials } from "../design/utils.js";
import { useI18n } from "../i18n/index.js";

const SETUP_STEP_IDS = ["s1", "s2", "s3", "s4", "s5", "s6", "s7"] as const;

export function SetupView({ onDone }: { onDone: () => void }) {
  const { locale, t } = useI18n();
  const [step, setStep] = useState(1);
  const queryClient = useQueryClient();

  const bootstrap = useQuery({
    queryKey: ["bootstrap"],
    queryFn: ({ signal }) => getBootstrap(signal),
  });
  const local = useQuery({
    queryKey: ["local-runtime-status"],
    queryFn: getLocalRuntimeStatus,
    refetchInterval: 5_000,
  });
  const integrations = useQuery({
    queryKey: ["coding-agent-integrations"],
    queryFn: getCodingAgentIntegrations,
    refetchInterval: 10_000,
  });
  const pulse = useQuery({
    queryKey: ["team-pulse"],
    queryFn: ({ signal }) => getTeamPulse(signal),
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

  const currentStepId = SETUP_STEP_IDS[step - 1]!;
  const localState = local.data?.available ? local.data : undefined;
  const workspaces = localState?.workspaces.filter((w) => !w.revoked) ?? [];
  const currentPrincipal = bootstrap.data?.currentPrincipal;
  const organization = bootstrap.data?.organization;
  const egress = localState?.modelEgress;
  const firstWorkspace = workspaces[0];
  const firstProjection = pulse.data?.projections.find(
    (projection) => projection.ownerId === currentPrincipal?.id,
  );

  return (
    <div className="animate-view-enter grid h-full grid-cols-[300px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] bg-bg">
      <aside className="h-full overflow-auto border-r border-line bg-panel p-[34px_26px]">
        <span className="grid h-[30px] w-[30px] place-items-center rounded-[9px] bg-accent-strong text-[13px] font-bold text-on-accent">
          I
        </span>
        <h2 className="mt-[18px] text-[19px] font-[600] tracking-[-0.025em]">
          {t("setup.brandTitle")}
        </h2>
        <p className="mt-2.5 text-[11.5px] leading-[1.7] text-ink-muted [text-wrap:pretty]">
          {t("setup.brandLede")}
        </p>

        <div className="mt-[26px] flex flex-col gap-0.5">
          {SETUP_STEP_IDS.map((id, index) => {
            const n = index + 1;
            const done = n < step;
            const current = n === step;
            return (
              <button
                key={id}
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
                    className={[
                      "text-[12.5px]",
                      current
                        ? "font-[650] text-ink"
                        : done
                          ? "text-ink-muted"
                          : "text-faint",
                    ].join(" ")}
                  >
                    {t(`setup.${id}.label`)}
                  </span>
                  <span className="text-[10.5px] leading-[1.5] text-faint [text-wrap:pretty]">
                    {t(`setup.${id}.sub`)}
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
              {t("setup.minTitle")}
            </strong>
          </div>
          <p className="mt-2.5 text-[11px] leading-[1.65] text-ink-muted [text-wrap:pretty]">
            {t("setup.minBody")}
          </p>
        </div>
      </aside>

      <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto]">
        <div className="min-h-0 overflow-auto p-[44px_44px_30px]">
          <div className="max-w-[620px]">
            <div className="font-mono text-[11px] tracking-[0.12em] text-accent-strong">
              {t(`setup.${currentStepId}.eyebrow`)}
            </div>
            <h1 className="mt-3.5 text-[30px] font-[540] leading-[1.15] tracking-[-0.035em]">
              {t(`setup.${currentStepId}.title`)}
            </h1>
            <p className="mt-3.5 text-[13.5px] leading-[1.8] text-ink-muted [text-wrap:pretty]">
              {t(`setup.${currentStepId}.body`)}
            </p>

            {step === 1 ? (
              <div className="mt-7 rounded-card border border-line bg-panel2 p-5">
                <div className="text-[11px] text-faint">
                  {t("setup.s1.deviceIdentity")}
                </div>
                <div className="mt-2.5 flex h-[38px] items-center gap-[9px] rounded-[10px] border border-line2 px-[13px]">
                  <UserIcon size={15} className="text-faint" />
                  <span className="text-[12.5px] text-ink">
                    {bootstrap.isPending
                      ? t("general.loading")
                      : (currentPrincipal?.displayName ?? "—")}
                  </span>
                </div>
                <p className="mt-4 text-[11px] leading-[1.65] text-faint [text-wrap:pretty]">
                  {t("setup.s1.deviceHint")}
                </p>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="mt-7 grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-[13px] rounded-card border border-accent-strong bg-accent-soft p-[16px_18px]">
                <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-accent-strong text-[13px] font-bold text-on-accent">
                  {initials(organization?.name)}
                </span>
                <strong className="text-[13px] font-[620]">
                  {bootstrap.isPending
                    ? t("general.loading")
                    : (organization?.name ?? "—")}
                </strong>
                <span className="text-[11.5px] font-[620] text-accent-strong">
                  {t("setup.s2.selected")}
                </span>
              </div>
            ) : null}

            {step === 3 ? (
              <div className="mt-7">
                <div className="flex flex-col gap-2">
                  {workspaces.map((workspace) => (
                    <div
                      key={workspace.id}
                      className="grid grid-cols-[20px_34px_minmax(0,1fr)] items-center gap-[13px] rounded-[13px] border border-accent-strong bg-accent-soft p-[14px_16px]"
                    >
                      <span className="grid h-5 w-5 place-items-center rounded-[6px] bg-accent-strong text-on-accent">
                        <CheckIcon size={11} weight="fill" />
                      </span>
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
                    </div>
                  ))}
                  {workspaces.length === 0 ? (
                    <p className="rounded-[13px] border border-line bg-panel2 p-[14px_16px] text-[12px] text-ink-muted">
                      {t("setup.s3.none")}
                    </p>
                  ) : null}
                </div>
                <p className="mt-4 rounded-inset bg-raise p-[14px_16px] text-[11.5px] leading-[1.7] text-ink-muted [text-wrap:pretty]">
                  {t("setup.s3.hint")}
                </p>
              </div>
            ) : null}

            {step === 4 ? (
              <>
                <div className="mt-7 flex flex-col gap-2.5">
                  {(integrations.data ?? []).map((integration) => {
                    const adapterName =
                      integration.adapter === "claude-code"
                        ? "Claude Code"
                        : integration.adapter === "opencode"
                          ? "OpenCode"
                          : "Codex";
                    const canInstall =
                      integration.detected &&
                      integration.supported &&
                      !integration.configured;
                    const busy =
                      manageIntegration.isPending &&
                      manageIntegration.variables?.adapter ===
                        integration.adapter;
                    return (
                      <div
                        key={integration.adapter}
                        className="grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-[13px] rounded-card border border-line bg-panel2 p-[16px_18px]"
                      >
                        <span
                          className={[
                            "grid h-9 w-9 place-items-center rounded-[10px] bg-raise",
                            integration.configured
                              ? "text-green"
                              : "text-ink-muted",
                          ].join(" ")}
                        >
                          <TerminalWindowIcon size={17} />
                        </span>
                        <span className="grid min-w-0">
                          <strong className="text-[13px] font-[620]">
                            {adapterName}
                          </strong>
                          <small className="mt-1 text-[11px] leading-[1.55] text-ink-muted [text-wrap:pretty]">
                            {integration.detected
                              ? integration.version
                              : t("settings.notDetected")}
                          </small>
                        </span>
                        {integration.configured ? (
                          <span className="rounded-pill bg-green-soft px-2.5 py-1 text-[11px] font-[600] text-green">
                            {t("settings.integrationState.config_valid")}
                          </span>
                        ) : canInstall ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              manageIntegration.mutate({
                                adapter: integration.adapter,
                                action: "install",
                              })
                            }
                            className="h-8 cursor-pointer rounded-btn border-0 bg-accent-strong px-3.5 text-[12px] font-[620] text-on-accent disabled:cursor-not-allowed disabled:opacity-55"
                          >
                            {busy
                              ? t("settings.integrationWorking")
                              : t("settings.integrationAction.install")}
                          </button>
                        ) : (
                          <span className="rounded-pill bg-raise px-2.5 py-1 text-[11px] font-[600] text-faint">
                            {t(
                              `settings.integrationState.${integration.state}`,
                            )}
                          </span>
                        )}
                      </div>
                    );
                  })}
                  {integrations.isPending ? (
                    <p className="text-[12px] text-ink-muted">
                      {t("general.loading")}
                    </p>
                  ) : null}
                  {manageIntegration.isError ? (
                    <p className="text-[12px] text-danger" role="alert">
                      {t("settings.integrationActionFailed")}
                    </p>
                  ) : null}
                </div>
                <div className="mt-4 grid gap-2.5 rounded-inset bg-raise p-[16px_18px]">
                  <div className="flex items-center gap-2.5 text-[11.5px] text-ink">
                    <CheckCircleIcon
                      size={14}
                      weight="fill"
                      className="text-green"
                    />
                    {t("setup.s4.will1")}
                  </div>
                  <div className="flex items-center gap-2.5 text-[11.5px] text-ink">
                    <CheckCircleIcon
                      size={14}
                      weight="fill"
                      className="text-green"
                    />
                    {t("setup.s4.will2")}
                  </div>
                  <div className="flex items-center gap-2.5 text-[11.5px] text-ink-muted">
                    <XCircleIcon size={14} className="text-faint" />
                    {t("setup.s4.not1")}
                  </div>
                  <div className="flex items-center gap-2.5 text-[11.5px] text-ink-muted">
                    <XCircleIcon size={14} className="text-faint" />
                    {t("setup.s4.not2")}
                  </div>
                </div>
              </>
            ) : null}

            {step === 5 ? (
              <div className="mt-7 flex flex-col gap-2.5">
                <div className="grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-[13px] rounded-card border border-line bg-panel2 p-[16px_18px]">
                  <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-raise text-green">
                    <CloudSlashIcon size={17} />
                  </span>
                  <span className="grid">
                    <strong className="text-[13px] font-[620]">
                      {t("settings.egress")}
                    </strong>
                    <small className="mt-1 text-[11px] text-ink-muted">
                      {t("settings.egressDetail")}
                    </small>
                  </span>
                  {egress === "disabled" ? (
                    <span className="rounded-pill bg-green-soft px-2.5 py-1 text-[11px] font-[600] text-green">
                      {t("settings.egress.disabled")}
                    </span>
                  ) : egress ? (
                    <span className="rounded-pill bg-amber-soft px-2.5 py-1 text-[11px] font-[600] text-amber">
                      {t(
                        egress === "managed_api"
                          ? "settings.egress.managed"
                          : "settings.egress.user",
                      )}
                    </span>
                  ) : (
                    <span className="rounded-pill bg-raise px-2.5 py-1 text-[11px] font-[600] text-faint">
                      {t("general.unavailable")}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-[13px] rounded-card border border-line bg-panel2 p-[16px_18px]">
                  <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-raise text-green">
                    <KeyIcon size={17} />
                  </span>
                  <span className="grid">
                    <strong className="text-[13px] font-[620]">
                      {t("settings.storage")}
                    </strong>
                    <small className="mt-1 text-[11px] text-ink-muted">
                      {t("settings.storageDetail")}
                    </small>
                  </span>
                  {localState?.health.encryptedStorage ? (
                    <span className="rounded-pill bg-green-soft px-2.5 py-1 text-[11px] font-[600] text-green">
                      {t("settings.storageReady")}
                    </span>
                  ) : (
                    <span className="rounded-pill bg-raise px-2.5 py-1 text-[11px] font-[600] text-faint">
                      {t("general.unavailable")}
                    </span>
                  )}
                </div>
              </div>
            ) : null}

            {step === 6 ? (
              <>
                <div className="mt-7 rounded-card border border-line bg-panel2 p-[22px]">
                  <div className="flex items-center gap-[11px]">
                    <span className="h-[9px] w-[9px] animate-breathe rounded-full bg-green" />
                    <strong className="text-[13px] font-[620]">
                      {firstWorkspace
                        ? t("setup.s6.listening", {
                            path: firstWorkspace.root,
                          })
                        : t("setup.s6.notListening")}
                    </strong>
                    {firstWorkspace ? (
                      <span className="ml-auto font-mono text-[10.5px] text-faint">
                        {t("setup.s6.waiting")}
                      </span>
                    ) : null}
                  </div>
                </div>
                {firstProjection ? (
                  <div className="mt-3.5 flex items-center gap-3 rounded-card border border-green-soft bg-green-soft p-[16px_18px]">
                    <CheckCircleIcon
                      size={18}
                      weight="fill"
                      className="text-green"
                    />
                    <span className="grid">
                      <strong className="text-[12.5px] font-[620]">
                        {t("setup.s6.firstReceived")}
                      </strong>
                      <small className="mt-1 text-[11.5px] text-ink-muted">
                        {firstProjection.title} ·{" "}
                        <span className="font-mono">
                          {t("confidence.label", {
                            value: confidencePercent(
                              firstProjection.confidence,
                            ),
                          })}
                        </span>
                      </small>
                    </span>
                  </div>
                ) : null}
                <p className="mt-3.5 text-[11.5px] leading-[1.7] text-faint [text-wrap:pretty]">
                  {t("setup.s6.firstNote")}
                </p>
              </>
            ) : null}

            {step === 7 ? (
              <>
                <div className="mt-7 rounded-card border border-accent-soft bg-accent-soft p-[22px]">
                  <div className="grid grid-cols-[34px_minmax(0,1fr)] items-center gap-3">
                    <span className="grid h-[34px] w-[34px] place-items-center rounded-[10px_14px_10px_10px] bg-accent-strong text-[11px] font-bold text-on-accent">
                      IR
                    </span>
                    <span className="grid">
                      <strong className="text-[13px] font-[620]">
                        {t("setup.s7.repName", {
                          name: currentPrincipal?.displayName ?? "—",
                        })}
                      </strong>
                      <small className="mt-1 text-[11px] text-ink-muted">
                        {t("setup.s7.repSub")}
                      </small>
                    </span>
                  </div>
                  <p className="mt-4 text-[12.5px] leading-[1.75] text-ink [text-wrap:pretty]">
                    {t("setup.s7.quote")}
                  </p>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2.5">
                  <div className="rounded-[13px] border border-line bg-panel2 p-[16px_18px]">
                    <div className="flex items-center gap-2 text-[11.5px] font-[620] text-green">
                      <CheckCircleIcon size={14} weight="fill" />
                      {t("setup.s7.will")}
                    </div>
                    <div className="mt-3 grid gap-2">
                      <span className="text-[11.5px] leading-[1.6] text-ink-muted">
                        {t("setup.s7.will1")}
                      </span>
                      <span className="text-[11.5px] leading-[1.6] text-ink-muted">
                        {t("setup.s7.will2")}
                      </span>
                      <span className="text-[11.5px] leading-[1.6] text-ink-muted">
                        {t("setup.s7.will3")}
                      </span>
                      <span className="text-[11.5px] leading-[1.6] text-ink-muted">
                        {t("setup.s7.will4")}
                      </span>
                    </div>
                  </div>
                  <div className="rounded-[13px] border border-line bg-panel2 p-[16px_18px]">
                    <div className="flex items-center gap-2 text-[11.5px] font-[620] text-faint">
                      <XCircleIcon size={14} />
                      {t("setup.s7.wont")}
                    </div>
                    <div className="mt-3 grid gap-2">
                      <span className="text-[11.5px] leading-[1.6] text-ink-muted">
                        {t("setup.s7.wont1")}
                      </span>
                      <span className="text-[11.5px] leading-[1.6] text-ink-muted">
                        {t("setup.s7.wont2")}
                      </span>
                      <span className="text-[11.5px] leading-[1.6] text-ink-muted">
                        {t("setup.s7.wont3")}
                      </span>
                      <span className="text-[11.5px] leading-[1.6] text-ink-muted">
                        {t("setup.s7.wont4")}
                      </span>
                    </div>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-3 border-t border-line bg-panel p-[18px_44px]">
          <button
            type="button"
            disabled={step === 1}
            onClick={() => setStep((current) => Math.max(1, current - 1))}
            className={[
              "h-9 cursor-pointer rounded-btn border border-line2 bg-transparent px-[15px] text-[12.5px]",
              "hover:border-accent-strong disabled:pointer-events-none",
              step === 1 ? "text-faint" : "text-ink",
            ].join(" ")}
          >
            {t("setup.back")}
          </button>
          <span className="font-mono text-[11px] text-faint">
            {t("setup.stepOf", { step })}
          </span>
          <span className="h-[3px] flex-1 overflow-hidden rounded-[2px] bg-raise">
            <span
              className="block h-[3px] bg-accent-strong"
              style={{ width: `${Math.round((step / 7) * 100)}%` }}
            />
          </span>
          <button
            type="button"
            onClick={() =>
              step === 7 ? onDone() : setStep((current) => current + 1)
            }
            className="h-9 cursor-pointer rounded-btn border-0 bg-accent-strong px-[17px] text-[12.5px] font-[620] text-on-accent"
          >
            {step === 7 ? t("setup.enter") : t("setup.next")}
          </button>
        </div>
      </div>
    </div>
  );
}

function workspaceName(root: string): string {
  return root.split(/[\\/]/).filter(Boolean).at(-1) ?? root;
}
