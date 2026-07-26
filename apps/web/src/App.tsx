import {
  BellIcon,
  ChatCircleDotsIcon,
  FileTextIcon,
  GearSixIcon,
  GitBranchIcon,
  KanbanIcon,
  MagnifyingGlassIcon,
  PulseIcon,
  ShieldCheckIcon,
  SidebarSimpleIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { getActionInbox, getBootstrap } from "./api.js";
import { useI18n } from "./i18n/index.js";
import type { TranslationKey } from "./i18n/locales/zh-CN.js";
import {
  developmentIdentityToolEnabled,
  resolveAuthenticationSurface,
} from "./pilot/auth-state.js";
import { useGovernance, usePilotOptional } from "./pilot/context.js";
import {
  AcceptInvitationView,
  AuthenticationLoadingView,
  DevelopmentIdentityToolView,
  SignInView,
} from "./views/AccessView.js";
import { AdminView } from "./views/AdminView.js";
import { AttentionView } from "./views/AttentionView.js";
import { CommunicationsView } from "./views/CommunicationsView.js";
import { CoordinationView } from "./views/CoordinationView.js";
import { PersonView } from "./views/PersonView.js";
import { ProjectView } from "./views/ProjectView.js";
import { SettingsView, type SettingsCategory } from "./views/SettingsView.js";
import { ProfileMenu } from "./views/ProfileMenu.js";
import { ScopeBar } from "./views/ScopeBar.js";
import { SearchView } from "./views/SearchView.js";
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
  | "inbox"
  | "search"
  | "admin"
  | "settings"
  | "setup";

type SetupMode = "canonical" | "pilot-test";

// The primary group is the places work lives. Settings configures the app
// rather than holding any work, so it sits below the spacer with the other
// app-level controls instead of inside this list.
//
// `scoped` marks the views that read the selected project — only those show
// the project chip in the titlebar breadcrumb. `lead` marks the views that
// only exist for a team leader or an organization admin.
const NAV: Array<{
  id: Extract<View, "pulse" | "chat" | "coord" | "spec" | "project" | "admin">;
  label: TranslationKey;
  icon: typeof PulseIcon;
  scoped?: boolean;
  lead?: boolean;
}> = [
  { id: "pulse", label: "nav.pulse", icon: PulseIcon },
  { id: "chat", label: "nav.chat", icon: ChatCircleDotsIcon },
  { id: "coord", label: "nav.coord", icon: GitBranchIcon },
  { id: "spec", label: "nav.spec", icon: FileTextIcon, scoped: true },
  { id: "project", label: "nav.project", icon: KanbanIcon, scoped: true },
  { id: "admin", label: "nav.admin", icon: ShieldCheckIcon, lead: true },
];

const SCOPED_VIEWS = new Set<View>(["spec", "project", "item"]);

const TITLES: Record<View, TranslationKey> = {
  pulse: "nav.pulse",
  person: "title.person",
  chat: "nav.chat",
  coord: "nav.coord",
  spec: "nav.spec",
  project: "nav.project",
  item: "nav.project",
  inbox: "app.notifications",
  search: "app.search",
  admin: "nav.admin",
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
  const pilot = usePilotOptional();
  const [view, setView] = useState<View>("pulse");
  const [settingsCategory, setSettingsCategory] =
    useState<SettingsCategory>("personal");
  const [setupMode, setSetupMode] = useState<SetupMode>("canonical");
  const [navOpen, setNavOpen] = useState(false);
  const [personId, setPersonId] = useState<string>();
  const [itemId, setItemId] = useState<string>();
  const [coordinationThreadId, setCoordinationThreadId] = useState<string>();
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
    refetchInterval: 5_000,
    refetchOnWindowFocus: true,
    enabled: !pilot?.enabled || Boolean(pilot.effectiveIdentity),
  });

  const identity = pilot?.enabled
    ? pilot.effectiveIdentity
    : bootstrap.data?.currentPrincipal;
  const organization =
    pilot?.bootstrap.data?.organization ?? bootstrap.data?.organization;
  const isSetup = view === "setup";
  const isMacDesktop =
    typeof window !== "undefined" &&
    window.interoDesktop?.platform === "darwin";
  const activeNav =
    view === "person" ? "pulse" : view === "item" ? "project" : view;

  // Governance surfaces are for the people who can actually change something:
  // an organization admin, or the leader of any team you belong to.
  const { canGovern } = useGovernance();
  const navItems = NAV.filter((item) => !item.lead || canGovern);

  // The breadcrumb badges each scope with the work actually waiting on you
  // there, so switching scope is an informed choice rather than a guess.
  const pendingByProject = new Map<string, number>();
  for (const item of inbox.data?.items ?? []) {
    if (!item.projectId || item.resolvedAt || item.dismissedAt) continue;
    pendingByProject.set(
      item.projectId,
      (pendingByProject.get(item.projectId) ?? 0) + 1,
    );
  }

  function openSetup(mode: SetupMode) {
    setSetupMode(mode);
    setView("setup");
  }

  function openAction(sourceRef: string) {
    if (sourceRef.startsWith("spec:")) {
      setView("spec");
      return;
    }
    if (sourceRef.startsWith("coordination:")) {
      setCoordinationThreadId(sourceRef.slice("coordination:".length));
      setView("coord");
      return;
    }
    setView("pulse");
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

  const authenticationSurface = resolveAuthenticationSurface({
    pilotEnabled: Boolean(pilot?.enabled),
    bootstrapPending: Boolean(pilot?.bootstrap.isPending),
    authMode: pilot?.bootstrap.data?.authMode,
    effectiveIdentityId: pilot?.identityId,
    authenticationRequired: Boolean(pilot?.authenticationRequired),
  });
  if (authenticationSurface === "loading") {
    return <AuthenticationLoadingView />;
  }
  const showDevelopmentIdentityTool =
    pilot?.bootstrap.data?.authMode === "development_identity" &&
    developmentIdentityToolEnabled({
      developmentBuild: import.meta.env.DEV,
      locationHref:
        typeof window === "undefined"
          ? "http://localhost/"
          : window.location.href,
      authenticationRequired: Boolean(pilot.authenticationRequired),
    });
  if (showDevelopmentIdentityTool && pilot) {
    return (
      <DevelopmentIdentityToolView
        identities={pilot.bootstrap.data?.identities ?? []}
        onSelect={pilot.setIdentityId}
      />
    );
  }
  if (authenticationSurface === "login") {
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
        <ScopeBar
          viewTitle={t(TITLES[view])}
          projectScoped={SCOPED_VIEWS.has(view)}
          pendingByProject={pendingByProject}
          {...(pilot?.bootstrap.data?.authMode === "development_identity"
            ? { onCreateProject: () => openSetup("pilot-test") }
            : {})}
        />
        <span className="ml-auto flex items-center gap-2 [-webkit-app-region:no-drag]">
          <button
            type="button"
            onClick={() => setView("search")}
            className="inline-flex h-6 items-center gap-[7px] rounded-[7px] border-0 bg-raise px-2.5 text-[11px] text-faint hover:bg-hover-wash hover:text-ink"
          >
            <MagnifyingGlassIcon size={12} aria-hidden="true" />
            {t("app.search")}
            <kbd className="font-mono text-[9.5px]">⌘K</kbd>
          </button>
          <button
            type="button"
            className="relative grid h-6 w-6 cursor-pointer place-items-center rounded-[7px] border-0 bg-transparent p-0 text-ink-muted hover:bg-hover-wash"
            aria-label={t("app.notifications")}
            onClick={() => setView("inbox")}
          >
            <BellIcon size={14} />
            {(inbox.data?.unreadCount ?? 0) > 0 ? (
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
        {navItems.map((item, index) => {
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
        {/* Settings is a destination, so it keeps nav styling and the active
            state — it is only separated from the work surfaces above. */}
        <button
          type="button"
          title={t("nav.settings")}
          className={navButtonClass(navOpen, activeNav === "settings")}
          aria-current={activeNav === "settings" ? "page" : undefined}
          onClick={() => setView("settings")}
        >
          <span className="grid place-items-center justify-self-center">
            <GearSixIcon size={18} />
          </span>
          {navOpen ? (
            <span
              className="animate-message-enter whitespace-nowrap text-left text-[12.5px] font-[540]"
              style={{ animationDelay: `${navItems.length * 30}ms` }}
            >
              {t("nav.settings")}
            </span>
          ) : null}
        </button>
        <span className="my-2 h-px w-full shrink-0 bg-line" />
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
              style={{ animationDelay: `${(navItems.length + 1) * 30}ms` }}
            >
              {t("nav.collapse")}
            </span>
          ) : null}
        </button>
        <ProfileMenu
          compact={!navOpen}
          {...(identity?.displayName
            ? { fallbackName: identity.displayName }
            : {})}
          {...(organization?.name
            ? { organizationName: organization.name }
            : {})}
          onOpenPersonal={() => {
            setSettingsCategory("personal");
            setView("settings");
          }}
        />
      </nav>

      <main className="min-w-0 overflow-hidden">
        {view === "pulse" ? (
          <TeamPulseView
            onOpenPerson={(ownerId) => {
              setPersonId(ownerId);
              setView("person");
            }}
            onOpenAction={openAction}
            onOpenSetup={() => openSetup("canonical")}
            onOpenSpecs={() => setView("spec")}
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
        {view === "coord" ? (
          <CoordinationView
            initialThreadId={coordinationThreadId}
            onOpenThread={() => setView("chat")}
          />
        ) : null}
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
            initialCategory={settingsCategory}
            onCategoryChange={setSettingsCategory}
            onOpenSetup={() => openSetup("canonical")}
            {...(pilot?.enabled
              ? pilot.bootstrap.data?.authMode === "development_identity"
                ? { onOpenTestSetup: () => openSetup("pilot-test") }
                : {}
              : {})}
          />
        ) : null}
        {/* AdminView owns its own permission state: gating here would blank the
            surface for a frame every time the teams query refetches. */}
        {view === "admin" ? (
          <AdminView onOpenSpecs={() => setView("spec")} />
        ) : null}
        {view === "inbox" ? <AttentionView onOpenAction={openAction} /> : null}
        {view === "search" ? (
          <SearchView
            onOpenResult={(result) => {
              if (result.sourceRef.startsWith("work-item:")) {
                setItemId(result.sourceRef.slice("work-item:".length));
                setView("item");
              } else if (result.sourceRef.startsWith("spec")) {
                setView("spec");
              } else if (result.sourceRef.startsWith("coordination:")) {
                setView("coord");
              } else {
                setView("pulse");
              }
            }}
          />
        ) : null}
        {view === "setup" ? (
          <SetupView mode={setupMode} onDone={() => setView("pulse")} />
        ) : null}
      </main>
    </div>
  );
}
