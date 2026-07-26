import {
  BellIcon,
  ChatCircleDotsIcon,
  FileTextIcon,
  GearSixIcon,
  GitBranchIcon,
  KanbanIcon,
  MagnifyingGlassIcon,
  MoonIcon,
  PulseIcon,
  SidebarSimpleIcon,
  SunIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { getActionInbox, getBootstrap } from "./api.js";
import { useTheme } from "./design/theme.js";
import { initials } from "./design/utils.js";
import { useI18n } from "./i18n/index.js";
import type { TranslationKey } from "./i18n/locales/zh-CN.js";
import { usePilotOptional } from "./pilot/context.js";
import {
  AcceptInvitationView,
  SignInView,
} from "./views/AccessView.js";
import { CommunicationsView } from "./views/CommunicationsView.js";
import { CoordinationView } from "./views/CoordinationView.js";
import { PersonView } from "./views/PersonView.js";
import { ProjectView } from "./views/ProjectView.js";
import { SettingsView } from "./views/SettingsView.js";
import { SetupView } from "./views/SetupView.js";
import { SpecReviewView } from "./views/SpecReviewView.js";
import { TeamPulseView } from "./views/TeamPulseView.js";
import { WorkItemView } from "./views/WorkItemView.js";

type View =
  | "pulse"
  | "person"
  | "chat"
  | "coord"
  | "spec"
  | "project"
  | "item"
  | "settings"
  | "setup";

type SetupMode = "canonical" | "pilot-test";

const NAV: Array<{
  id: Extract<
    View,
    "pulse" | "chat" | "coord" | "spec" | "project" | "settings"
  >;
  label: TranslationKey;
  icon: typeof PulseIcon;
}> = [
  { id: "pulse", label: "nav.pulse", icon: PulseIcon },
  { id: "chat", label: "nav.chat", icon: ChatCircleDotsIcon },
  { id: "coord", label: "nav.coord", icon: GitBranchIcon },
  { id: "spec", label: "nav.spec", icon: FileTextIcon },
  { id: "project", label: "nav.project", icon: KanbanIcon },
  { id: "settings", label: "nav.settings", icon: GearSixIcon },
];

const TITLES: Record<View, TranslationKey> = {
  pulse: "nav.pulse",
  person: "title.person",
  chat: "nav.chat",
  coord: "nav.coord",
  spec: "nav.spec",
  project: "nav.project",
  item: "nav.project",
  settings: "nav.settings",
  setup: "title.setup",
};

function navButtonClass(open: boolean, active: boolean): string {
  return [
    "relative grid h-9 cursor-pointer items-center gap-[11px] rounded-[11px] border-0 p-0",
    "transition-colors duration-[180ms]",
    open
      ? "w-full grid-cols-[18px_minmax(0,1fr)] justify-start px-[9px]"
      : "w-9 grid-cols-[18px] justify-center",
    active
      ? "bg-sel text-ink"
      : "bg-transparent text-faint hover:bg-hover-wash",
  ].join(" ");
}

export function App() {
  const { t } = useI18n();
  const { mode, setMode } = useTheme();
  const pilot = usePilotOptional();
  const [view, setView] = useState<View>("pulse");
  const [setupMode, setSetupMode] = useState<SetupMode>("canonical");
  const [navOpen, setNavOpen] = useState(false);
  const [personId, setPersonId] = useState<string>();
  const [itemId, setItemId] = useState<string>();
  const [invitationToken, setInvitationToken] = useState<string | undefined>(
    () =>
      typeof window === "undefined"
        ? undefined
        : (new URL(window.location.href).searchParams.get("token") ??
          undefined),
  );

  const bootstrap = useQuery({
    queryKey: ["bootstrap"],
    queryFn: ({ signal }) => getBootstrap(signal),
  });
  const inbox = useQuery({
    queryKey: ["action-inbox"],
    queryFn: ({ signal }) => getActionInbox(signal),
    refetchInterval: 30_000,
  });

  const pilotIdentity =
    pilot?.bootstrap.data?.currentPrincipal ??
    pilot?.bootstrap.data?.identities.find(
      (item) => item.id === pilot.identityId,
    );
  const identity = pilotIdentity ?? bootstrap.data?.currentPrincipal;
  const organization =
    pilot?.bootstrap.data?.organization ?? bootstrap.data?.organization;
  const isSetup = view === "setup";
  const isMacDesktop =
    typeof window !== "undefined" &&
    window.interoDesktop?.platform === "darwin";
  const activeNav =
    view === "person" ? "pulse" : view === "item" ? "project" : view;

  function openSetup(mode: SetupMode) {
    setSetupMode(mode);
    setView("setup");
  }

  function leaveInvitation(nextView: "pulse" | "settings", projectId?: string) {
    const url = new URL(window.location.href);
    url.searchParams.delete("token");
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
    setInvitationToken(undefined);
    if (projectId) pilot?.setSelectedProjectId(projectId);
    setView(nextView);
  }

  if (pilot?.enabled && invitationToken) {
    return (
      <AcceptInvitationView
        token={invitationToken}
        onEnterPulse={(projectId) => leaveInvitation("pulse", projectId)}
        onConnectAgent={(projectId) => leaveInvitation("settings", projectId)}
      />
    );
  }

  if (
    pilot?.enabled &&
    pilot.bootstrap.data?.authMode === "session" &&
    !pilot.bootstrap.data.currentPrincipal
  ) {
    return <SignInView />;
  }

  return (
    <div
      className={[
        "grid h-screen grid-rows-[38px_minmax(0,1fr)] bg-bg text-ink",
        "transition-[grid-template-columns,background-color,color] duration-300 ease-standard",
        isSetup
          ? "grid-cols-[0px_minmax(0,1fr)]"
          : navOpen
            ? "grid-cols-[212px_minmax(0,1fr)]"
            : "grid-cols-[62px_minmax(0,1fr)]",
      ].join(" ")}
    >
      <div className="col-span-full flex items-center gap-3.5 border-b border-line bg-panel px-3.5 [-webkit-app-region:drag]">
        {isMacDesktop ? (
          <span
            className="w-[54px]"
            data-testid="macos-titlebar-controls-spacer"
            aria-hidden="true"
          />
        ) : null}
        <span className="ml-2 flex items-center gap-[9px] text-[11.5px]">
          <span className="font-[620] text-ink-muted">Intero</span>
          <span className="text-faint" aria-hidden="true">
            —
          </span>
          <span className="text-ink">{t(TITLES[view])}</span>
        </span>
        <span className="ml-auto flex items-center gap-2 [-webkit-app-region:no-drag]">
          <span className="inline-flex h-6 items-center gap-[7px] rounded-[7px] bg-raise px-2.5 text-[11px] text-faint">
            <MagnifyingGlassIcon size={12} aria-hidden="true" />
            {t("app.search")}
            <kbd className="font-mono text-[9.5px]">⌘K</kbd>
          </span>
          <button
            type="button"
            className="relative grid h-6 w-6 cursor-pointer place-items-center rounded-[7px] border-0 bg-transparent p-0 text-ink-muted hover:bg-hover-wash"
            aria-label={t("app.notifications")}
            onClick={() => setView("pulse")}
          >
            <BellIcon size={14} />
            {(inbox.data?.items.length ?? 0) > 0 ? (
              <span
                className="absolute right-[3px] top-[3px] h-1.5 w-1.5 animate-badge-bounce rounded-full bg-danger"
                aria-hidden="true"
              />
            ) : null}
          </button>
        </span>
      </div>

      <nav
        className={[
          "flex flex-col gap-1 overflow-hidden border-r border-line bg-panel px-2.5 pb-4 pt-3.5",
          navOpen ? "items-stretch" : "items-center",
        ].join(" ")}
        aria-label="Intero"
      >
        {NAV.map((item, index) => {
          const Icon = item.icon;
          const active = activeNav === item.id;
          return (
            <button
              key={item.id}
              type="button"
              title={t(item.label)}
              className={navButtonClass(navOpen, active)}
              aria-current={active ? "page" : undefined}
              onClick={() => setView(item.id)}
            >
              <span className="grid place-items-center justify-self-center">
                <Icon size={18} />
              </span>
              {navOpen ? (
                <span
                  className="animate-message-enter whitespace-nowrap text-left text-[12.5px] font-[540]"
                  style={{ animationDelay: `${index * 30}ms` }}
                >
                  {t(item.label)}
                </span>
              ) : null}
            </button>
          );
        })}
        <span className="flex-1" />
        <button
          type="button"
          className={[
            "grid h-9 cursor-pointer items-center gap-[11px] rounded-[11px] border border-line2 bg-transparent p-0 text-ink-muted",
            "mb-2 transition-colors duration-[180ms] hover:border-accent-strong hover:text-accent-strong",
            navOpen
              ? "w-full grid-cols-[18px_minmax(0,1fr)] justify-start px-[9px]"
              : "w-9 grid-cols-[18px] justify-center",
          ].join(" ")}
          title={mode === "light" ? t("theme.toDark") : t("theme.toLight")}
          onClick={() => setMode(mode === "light" ? "dark" : "light")}
        >
          <span className="grid place-items-center justify-self-center">
            {mode === "light" ? <MoonIcon size={17} /> : <SunIcon size={17} />}
          </span>
          {navOpen ? (
            <span
              className="animate-message-enter whitespace-nowrap text-left text-[12px]"
              style={{ animationDelay: `${NAV.length * 30}ms` }}
            >
              {mode === "light" ? t("theme.toDark") : t("theme.toLight")}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          className={[
            "grid h-8 cursor-pointer items-center gap-[11px] rounded-[10px] border-0 bg-transparent p-0 text-faint",
            "mb-2.5 transition-colors duration-[180ms] hover:bg-hover-wash hover:text-ink",
            navOpen
              ? "w-full grid-cols-[18px_minmax(0,1fr)] justify-start px-[9px]"
              : "w-9 grid-cols-[18px] justify-center",
          ].join(" ")}
          title={navOpen ? t("nav.collapse") : t("nav.expand")}
          onClick={() => setNavOpen((current) => !current)}
        >
          <span className="grid place-items-center justify-self-center">
            <SidebarSimpleIcon size={16} />
          </span>
          {navOpen ? (
            <span
              className="animate-message-enter whitespace-nowrap text-left text-[11.5px]"
              style={{ animationDelay: `${(NAV.length + 1) * 30}ms` }}
            >
              {t("nav.collapse")}
            </span>
          ) : null}
        </button>
        <div
          className={[
            "grid items-center gap-[11px]",
            navOpen
              ? "w-full grid-cols-[18px_minmax(0,1fr)] justify-start px-[9px]"
              : "w-9 grid-cols-[18px] justify-center",
          ].join(" ")}
        >
          <span className="grid h-[30px] w-[30px] place-items-center justify-self-center rounded-full bg-accent-soft text-[10px] font-[650] text-accent-strong">
            {initials(identity?.displayName)}
          </span>
          {navOpen ? (
            <span
              className="min-w-0 animate-message-enter"
              style={{ animationDelay: `${(NAV.length + 2) * 30}ms` }}
            >
              <strong className="block whitespace-nowrap text-[11.5px] font-semibold">
                {identity?.displayName ?? "—"}
              </strong>
              <small className="mt-0.5 block whitespace-nowrap text-[9.5px] text-faint">
                {organization?.name ?? "—"}
              </small>
            </span>
          ) : null}
        </div>
      </nav>

      <main className="min-w-0 overflow-hidden">
        {view === "pulse" ? (
          <TeamPulseView
            onOpenPerson={(ownerId) => {
              setPersonId(ownerId);
              setView("person");
            }}
            onOpenAction={(sourceRef) =>
              setView(sourceRef.startsWith("spec:") ? "spec" : "coord")
            }
            onOpenSetup={() => openSetup("canonical")}
          />
        ) : null}
        {view === "person" && personId ? (
          <PersonView
            ownerId={personId}
            onBack={() => setView("pulse")}
            onOpenChat={() => setView("chat")}
          />
        ) : null}
        {view === "chat" ? <CommunicationsView /> : null}
        {view === "coord" ? <CoordinationView /> : null}
        {view === "spec" ? <SpecReviewView /> : null}
        {view === "project" ? (
          <ProjectView
            onOpenItem={(cardId) => {
              setItemId(cardId);
              setView("item");
            }}
          />
        ) : null}
        {view === "item" && itemId ? (
          <WorkItemView cardId={itemId} onBack={() => setView("project")} />
        ) : null}
        {view === "settings" ? (
          <SettingsView
            onOpenSetup={() => openSetup("canonical")}
            {...(pilot?.enabled
              ? pilot.bootstrap.data?.authMode === "development_identity"
                ? { onOpenTestSetup: () => openSetup("pilot-test") }
                : {}
              : {})}
          />
        ) : null}
        {view === "setup" ? (
          <SetupView mode={setupMode} onDone={() => setView("pulse")} />
        ) : null}
      </main>
    </div>
  );
}
