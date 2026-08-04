import {
  CheckIcon,
  CircleHalfIcon,
  CodeIcon,
  FolderSimpleIcon,
  PulseIcon,
  MoonIcon,
  ShootingStarIcon,
  SunIcon,
  UserCircleIcon,
} from "@phosphor-icons/react";
import type { PilotAgentClient } from "@intero/domain";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { ACCENTS, lum, useTheme } from "../design/theme.js";
import { type Locale, useI18n } from "../i18n/index.js";
import { updatePilotProfile } from "../pilot/api.js";
import { usePilotOptional } from "../pilot/context.js";
import { AgentConnectionsSettings } from "./AgentConnectionsSettings.js";
import { OnboardingAdminSettings } from "./settings/OnboardingAdminSettings.js";
import { NotificationSettings } from "./settings/NotificationSettings.js";
import { AccountSecuritySettings } from "./settings/AccountSecuritySettings.js";
import { ProjectAutomationSettings } from "./settings/ProjectAutomationSettings.js";
import {
  GitAwarenessSettings,
  type GitClient,
} from "./settings/GitAwarenessSettings.js";
import { FirstUseGuide } from "./settings/FirstUseGuide.js";
import { ServiceDiagnosticsSettings } from "./settings/ServiceDiagnosticsSettings.js";

// Team members, deployment and model service moved to 团队管理 — they are
// governance settings for a whole team or organization, not personal ones.
export type SettingsCategory = "personal" | "project" | "agent" | "services";

const SETTINGS_CATEGORIES = [
  {
    id: "personal",
    label: "Personal",
    detail: "个人资料与偏好",
    icon: UserCircleIcon,
  },
  {
    id: "project",
    label: "Project",
    detail: "项目有效设置",
    icon: FolderSimpleIcon,
  },
  {
    id: "agent",
    label: "Coding Agent",
    detail: "项目连接管理",
    icon: CodeIcon,
  },
  {
    id: "services",
    label: "Diagnostics",
    detail: "连接与服务诊断",
    icon: PulseIcon,
  },
] as const satisfies ReadonlyArray<{
  id: SettingsCategory;
  label: string;
  detail: string;
  icon: typeof UserCircleIcon;
}>;

export function shouldShowDesktopGitAwareness(
  desktopBridge: Window["interoDesktop"] | undefined,
): boolean {
  return Boolean(desktopBridge);
}

function supportsDesktopGitAwareness(
  client: PilotAgentClient,
): client is GitClient {
  return client !== "grok-build" && client !== "cursor";
}

export function SettingsView({
  initialCategory = "personal",
  onCategoryChange,
}: {
  initialCategory?: SettingsCategory;
  onCategoryChange?: (category: SettingsCategory) => void;
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
  const [activeCategory, setActiveCategory] =
    useState<SettingsCategory>(initialCategory);
  const [connectedAgentClients, setConnectedAgentClients] = useState<
    PilotAgentClient[]
  >([]);
  const pilotProject = pilot?.projects.data?.projects.find(
    (project) => project.id === pilot.selectedProjectId,
  );
  const developmentIdentityId =
    pilot?.bootstrap.data?.authMode === "development_identity"
      ? pilot.identityId
      : undefined;

  const updatePreferredLanguage = useMutation({
    mutationFn: (preferredLanguage: Locale) =>
      updatePilotProfile({ preferredLanguage }, developmentIdentityId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["pilot", "profile"] });
      await queryClient.invalidateQueries({ queryKey: ["pilot", "bootstrap"] });
    },
  });

  const currentAccent = ACCENTS.find((a) => a.hex === accent) ?? ACCENTS[0]!;
  const pilotOrganization = pilot?.bootstrap.data?.organization;
  const activeCategoryMeta =
    SETTINGS_CATEGORIES.find((category) => category.id === activeCategory) ??
    SETTINGS_CATEGORIES[0]!;
  const categoryLede: Record<SettingsCategory, string> = {
    personal: "管理你的个人资料、界面偏好、账号安全和站内通知。",
    project: "查看当前项目的有效治理配置，并管理受控的替身自动协作。",
    agent: "按 Project 管理 Coding Agent 的连接、验证状态和本地仓库配置。",
    services:
      "集中检查 Agent、模型、实时、Worker、授权、数据库和对象存储，并获得安全的恢复入口。",
  };

  useEffect(() => {
    setActiveCategory(initialCategory);
  }, [initialCategory]);

  function selectCategory(category: SettingsCategory) {
    setActiveCategory(category);
    onCategoryChange?.(category);
  }

  function selectLanguage(next: Locale) {
    setLocale(next);
    if (pilot?.enabled && pilot.identityId) {
      updatePreferredLanguage.mutate(next);
    }
  }

  return (
    <div className="animate-view-enter grid h-full grid-cols-[210px_minmax(0,1fr)] overflow-hidden">
      <aside
        className="overflow-auto border-r border-line bg-panel px-3 py-5"
        aria-label="设置类别"
      >
        <p className="px-3 text-[10px] font-[650] tracking-[0.11em] text-accent-strong">
          SETTINGS
        </p>
        <nav className="mt-4 grid gap-1" aria-label="设置类别">
          {SETTINGS_CATEGORIES.map((category) => {
            const Icon = category.icon;
            const active = activeCategory === category.id;
            return (
              <button
                key={category.id}
                type="button"
                data-testid={`settings-category-${category.id}`}
                aria-current={active ? "page" : undefined}
                onClick={() => selectCategory(category.id)}
                className={[
                  "grid min-h-[52px] grid-cols-[28px_minmax(0,1fr)] items-center gap-2 rounded-[11px] border-0 px-2.5 text-left",
                  "focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent-strong",
                  active
                    ? "bg-sel text-ink"
                    : "bg-transparent text-ink-muted hover:bg-hover-wash hover:text-ink",
                ].join(" ")}
              >
                <span className="grid h-7 w-7 place-items-center rounded-[8px] bg-raise">
                  <Icon size={14} />
                </span>
                <span className="min-w-0">
                  <strong className="block truncate text-[11.5px] font-[620]">
                    {category.label}
                  </strong>
                  <small className="mt-0.5 block truncate text-[9.5px] text-faint">
                    {category.detail}
                  </small>
                </span>
              </button>
            );
          })}
        </nav>
      </aside>
      <div className="overflow-auto p-[34px_34px_70px]">
        <div className="max-w-[820px]">
          <p className="text-[11px] font-[650] tracking-[0.1em] text-accent-strong">
            SETTINGS · {activeCategoryMeta.label.toUpperCase()}
          </p>
          <h1 className="mt-2.5 text-[28px] font-[540] tracking-[-0.035em]">
            {activeCategoryMeta.label}
          </h1>
          <p className="mt-3 max-w-[560px] text-[13px] leading-[1.75] text-ink-muted [text-wrap:pretty]">
            {categoryLede[activeCategory]}
          </p>

          {activeCategory === "personal" ? (
            <>
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
                        const ink =
                          lum(option.hex) > 0.62 ? "#1a1710" : "#fffaf2";
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
                    onSelect={selectLanguage}
                  />
                  <LanguageOption
                    value="en-US"
                    current={locale}
                    label={t("settings.english")}
                    onSelect={selectLanguage}
                  />
                </div>
              </div>

              {pilot?.enabled && pilot.identityId ? (
                <>
                  <FirstUseGuide />
                  <OnboardingAdminSettings section="personal" />
                  <AccountSecuritySettings />
                  <NotificationSettings />
                </>
              ) : null}
            </>
          ) : null}

          {activeCategory === "project" &&
          pilot?.enabled &&
          pilot.identityId ? (
            <>
              <OnboardingAdminSettings section="project" />
              <ProjectAutomationSettings
                projectId={pilotProject?.id}
                projectName={pilotProject?.name}
              />
            </>
          ) : null}

          {pilot?.enabled && activeCategory === "agent" ? (
            <div data-testid="pilot-cloud-settings">
              <AgentConnectionsSettings
                initialProjectId={pilotProject?.id}
                onConnectedClientsChange={setConnectedAgentClients}
              />
            </div>
          ) : null}

          {pilot?.enabled &&
          pilot.identityId &&
          activeCategory === "services" ? (
            <ServiceDiagnosticsSettings />
          ) : null}

          {activeCategory === "agent" &&
          typeof window !== "undefined" &&
          shouldShowDesktopGitAwareness(window.interoDesktop) ? (
            <GitAwarenessSettings
              {...(pilotProject?.name
                ? { projectName: pilotProject.name }
                : {})}
              connectedClients={connectedAgentClients.filter(
                supportsDesktopGitAwareness,
              )}
              onBindAgent={() =>
                document
                  .getElementById("agent-connections")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
            />
          ) : null}

          <p className="mt-[26px] max-w-[620px] rounded-[13px] bg-raise p-[16px_18px] text-[11.5px] leading-[1.75] text-faint [text-wrap:pretty]">
            {t("settings.footer")}
          </p>
        </div>
      </div>
    </div>
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
