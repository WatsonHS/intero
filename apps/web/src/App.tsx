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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Outlet,
  useMatchRoute,
  useNavigate,
  useRouterState,
  useSearch,
} from "@tanstack/react-router";
import {
  Suspense,
  createContext,
  lazy,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  selectNewBrowserNotifiableItems,
  showActionInboxBrowserNotification,
  type ActionInboxSnapshot,
} from "./action-inbox-browser-notifications.js";
import {
  getActionInbox,
  getBootstrap,
  streamActionInboxEvents,
} from "./api.js";
import { useI18n } from "./i18n/index.js";
import type { TranslationKey } from "./i18n/locales/zh-CN.js";
import {
  developmentIdentityToolEnabled,
  resolveAuthenticationSurface,
} from "./pilot/auth-state.js";
import {
  projectInTeam,
  useGovernance,
  usePilotOptional,
} from "./pilot/context.js";
import { resolvePilotEntryGate } from "./pilot/entry-gate.js";
import {
  AcceptInvitationView,
  AuthenticationLoadingView,
  DevelopmentIdentityToolView,
  NoTeamAccessView,
  SignInView,
} from "./views/AccessView.js";
import type { AdminTab } from "./views/AdminView.js";
import type { SettingsCategory } from "./views/SettingsView.js";
import { ProfileMenu } from "./views/ProfileMenu.js";
import { ScopeBar } from "./views/ScopeBar.js";
import { SetupView } from "./views/SetupView.js";
import { RouteErrorBoundary } from "./views/RouteErrorBoundary.js";
import {
  invalidateWorkspaceEvent,
  repairWorkspaceAfterReconnect,
} from "./workspace-events.js";

const AdminView = lazy(async () => ({
  default: (await import("./views/AdminView.js")).AdminView,
}));
const AttentionView = lazy(async () => ({
  default: (await import("./views/AttentionView.js")).AttentionView,
}));
const CommunicationsView = lazy(async () => ({
  default: (await import("./views/CommunicationsView.js")).CommunicationsView,
}));
const CoordinationView = lazy(async () => ({
  default: (await import("./views/CoordinationView.js")).CoordinationView,
}));
const PersonView = lazy(async () => ({
  default: (await import("./views/PersonView.js")).PersonView,
}));
const ProjectView = lazy(async () => ({
  default: (await import("./views/ProjectView.js")).ProjectView,
}));
const SearchView = lazy(async () => ({
  default: (await import("./views/SearchView.js")).SearchView,
}));
const SettingsView = lazy(async () => ({
  default: (await import("./views/SettingsView.js")).SettingsView,
}));
const SpecReviewView = lazy(async () => ({
  default: (await import("./views/SpecReviewView.js")).SpecReviewView,
}));
const TeamPulseView = lazy(async () => ({
  default: (await import("./views/TeamPulseView.js")).TeamPulseView,
}));
const WorkItemView = lazy(async () => ({
  default: (await import("./views/WorkItemView.js")).WorkItemView,
}));

export type AppView =
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
  | "not_found";

// The primary group is the places work lives. Settings configures the app
// rather than holding any work, so it sits below the spacer with the other
// app-level controls instead of inside this list.
//
// `scoped` marks the views that read the selected project — only those show
// the project chip in the titlebar breadcrumb. `lead` marks the views that
// only exist for a team leader or an organization admin.
const NAV: Array<{
  id: Extract<
    AppView,
    "pulse" | "chat" | "coord" | "spec" | "project" | "admin"
  >;
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

const SCOPED_VIEWS = new Set<AppView>(["spec", "project", "item"]);

const TITLES: Record<AppView, TranslationKey> = {
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
  not_found: "nav.pulse",
};

const SETTINGS_CATEGORIES = new Set<SettingsCategory>([
  "personal",
  "project",
  "agent",
  "services",
]);

const ADMIN_TABS = new Set<AdminTab>([
  "members",
  "teams",
  "projects",
  "policy",
  "org",
  "service",
  "audit",
]);

export function resolveAppView(pathname: string): AppView {
  if (pathname === "/" || pathname === "/pulse") return "pulse";
  if (pathname.startsWith("/people/")) return "person";
  if (pathname === "/communications" || pathname.startsWith("/communications/"))
    return "chat";
  if (pathname === "/coordination" || pathname.startsWith("/coordination/"))
    return "coord";
  if (/^\/projects\/[^/]+\/specs$/.test(pathname)) return "spec";
  if (/^\/projects\/[^/]+\/items\/[^/]+$/.test(pathname)) return "item";
  if (/^\/projects\/[^/]+\/work$/.test(pathname)) return "project";
  if (pathname === "/attention") return "inbox";
  if (pathname === "/search") return "search";
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return "admin";
  if (pathname === "/settings" || pathname.startsWith("/settings/"))
    return "settings";
  return "not_found";
}

function settingsCategory(value: string | undefined): SettingsCategory {
  return SETTINGS_CATEGORIES.has(value as SettingsCategory)
    ? (value as SettingsCategory)
    : "personal";
}

function adminTab(value: string | undefined): AdminTab {
  return ADMIN_TABS.has(value as AdminTab) ? (value as AdminTab) : "members";
}

interface RoutedNavigation {
  openAction: (sourceRef: string) => void;
  openAgentConnections: (projectId?: string) => void;
  openProjectSurface: (surface: "work" | "specs", projectId?: string) => void;
  openPulse: (options?: { replace?: boolean }) => void;
  selectedProjectId: string | undefined;
}

const RoutedNavigationContext = createContext<RoutedNavigation | undefined>(
  undefined,
);

function useRoutedNavigation(): RoutedNavigation {
  const value = useContext(RoutedNavigationContext);
  if (!value) {
    throw new Error("Routed workspace is outside the application shell.");
  }
  return value;
}

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
  return <InteroApp />;
}

function InteroApp() {
  const { t } = useI18n();
  const pilot = usePilotOptional();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const matchRoute = useMatchRoute();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const routeSearch = useSearch({ strict: false }) as {
    token?: string;
    standInOwnerId?: string;
    itemId?: string;
  };
  const view = resolveAppView(pathname);
  const projectMatch = matchRoute({ to: "/projects/$projectId/work" });
  const itemMatch = matchRoute({
    to: "/projects/$projectId/items/$itemId",
  });
  const specMatch = matchRoute({ to: "/projects/$projectId/specs" });
  const invitationMatch = matchRoute({ to: "/accept-invitation" });
  const [bootstrapActive, setBootstrapActive] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const notifiedActionInboxIds = useRef(new Set<string>());

  const bootstrap = useQuery({
    queryKey: ["bootstrap"],
    queryFn: ({ signal }) => getBootstrap(signal),
  });
  const inbox = useQuery({
    queryKey: ["action-inbox"],
    queryFn: ({ signal }) => getActionInbox(signal),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    enabled: !pilot?.enabled || Boolean(pilot.effectiveIdentity),
  });
  const inboxEventsEnabled =
    !pilot?.enabled || Boolean(pilot.effectiveIdentity);

  useEffect(() => {
    if (!inboxEventsEnabled) return;
    const abort = new AbortController();
    let retryDelay = 1_000;
    let openedOnce = false;

    const connect = async () => {
      while (!abort.signal.aborted) {
        let openedAt: number | undefined;
        try {
          await streamActionInboxEvents(
            (event) => {
              void invalidateWorkspaceEvent(queryClient, event);
              if (
                event.reason !== "action_inbox" &&
                event.reason !== "notification_preferences"
              ) {
                return;
              }
              const previous = queryClient.getQueryData<ActionInboxSnapshot>([
                "action-inbox",
              ]);
              void queryClient
                .fetchQuery({
                  queryKey: ["action-inbox"],
                  queryFn: ({ signal }) => getActionInbox(signal),
                })
                .then((current) => {
                  if (
                    event.reason !== "action_inbox" ||
                    typeof document === "undefined" ||
                    document.visibilityState !== "hidden"
                  ) {
                    return;
                  }
                  for (const item of selectNewBrowserNotifiableItems({
                    previous,
                    current,
                    occurredAt: event.occurredAt,
                  })) {
                    if (notifiedActionInboxIds.current.has(item.id)) continue;
                    const shown = showActionInboxBrowserNotification(
                      item,
                      () => {
                        window.focus();
                        void navigate({
                          to: "/attention",
                          search: { itemId: item.id },
                        });
                      },
                    );
                    if (shown) notifiedActionInboxIds.current.add(item.id);
                  }
                  if (notifiedActionInboxIds.current.size > 500) {
                    notifiedActionInboxIds.current = new Set(
                      [...notifiedActionInboxIds.current].slice(-250),
                    );
                  }
                })
                .catch(() => undefined);
            },
            {
              signal: abort.signal,
              onOpen: () => {
                openedAt = Date.now();
                if (openedOnce) {
                  void repairWorkspaceAfterReconnect(queryClient);
                }
                openedOnce = true;
              },
            },
          );
        } catch {
          if (abort.signal.aborted) return;
        }
        if (openedAt && Date.now() - openedAt >= 30_000) retryDelay = 1_000;
        await waitForRetry(retryDelay, abort.signal);
        retryDelay = Math.min(retryDelay * 2, 30_000);
      }
    };

    void connect();
    return () => abort.abort();
  }, [inboxEventsEnabled, navigate, pilot?.identityId, queryClient]);

  const identity = pilot?.enabled
    ? pilot.effectiveIdentity
    : bootstrap.data?.currentPrincipal;
  const organization =
    pilot?.bootstrap.data?.organization ?? bootstrap.data?.organization;
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

  const selectedProjectId =
    pilot?.selectedProjectId ?? pilot?.projects.data?.projects[0]?.id;

  function openPulse(options?: { replace?: boolean }) {
    void navigate({
      to: "/pulse",
      ...(options?.replace !== undefined ? { replace: options.replace } : {}),
    });
  }

  function openProjectSurface(
    surface: "work" | "specs",
    projectId = selectedProjectId,
  ) {
    if (!projectId) {
      openPulse();
      return;
    }
    pilot?.setSelectedProjectId(projectId);
    if (surface === "specs") {
      void navigate({
        to: "/projects/$projectId/specs",
        params: { projectId },
      });
    } else {
      void navigate({
        to: "/projects/$projectId/work",
        params: { projectId },
      });
    }
  }

  function openAgentConnections(projectId?: string) {
    if (projectId) pilot?.setSelectedProjectId(projectId);
    void navigate({
      to: "/settings/$category",
      params: { category: "agent" },
    });
  }

  function openAction(sourceRef: string) {
    if (sourceRef.startsWith("spec:")) {
      openProjectSurface("specs");
      return;
    }
    if (sourceRef.startsWith("coordination:")) {
      void navigate({
        to: "/coordination/$threadId",
        params: { threadId: sourceRef.slice("coordination:".length) },
      });
      return;
    }
    openPulse();
  }

  function leaveInvitation(projectId?: string) {
    if (projectId) pilot?.setSelectedProjectId(projectId);
    openPulse({ replace: true });
  }

  function moveProjectScope(projectId: string) {
    pilot?.setSelectedProjectId(projectId);
    if (view === "spec") {
      openProjectSurface("specs", projectId);
      return;
    }
    openProjectSurface("work", projectId);
  }

  function moveTeamScope(teamId: string) {
    pilot?.setSelectedTeamId(teamId);
    if (!SCOPED_VIEWS.has(view)) return;
    const projects = pilot?.projects.data?.projects ?? [];
    const current = projects.find(
      (project) =>
        project.id === selectedProjectId && projectInTeam(project, teamId),
    );
    const next =
      current ?? projects.find((project) => projectInTeam(project, teamId));
    if (next) moveProjectScope(next.id);
  }

  useEffect(() => {
    if (
      pilot?.enabled &&
      pilot.bootstrap.isSuccess &&
      !pilot.bootstrap.data?.organization
    ) {
      setBootstrapActive(true);
    }
  }, [
    pilot?.bootstrap.data?.organization,
    pilot?.bootstrap.isSuccess,
    pilot?.enabled,
  ]);

  const routedProjectId =
    (specMatch && specMatch.projectId) ||
    (projectMatch && projectMatch.projectId) ||
    (itemMatch && itemMatch.projectId) ||
    undefined;
  useEffect(() => {
    if (!pilot?.enabled || !routedProjectId) return;
    const project = pilot.projects.data?.projects.find(
      (candidate) => candidate.id === routedProjectId,
    );
    if (!project) {
      if (pilot.projects.isSuccess) openPulse({ replace: true });
      return;
    }
    if (
      !pilot.selectedTeamId ||
      !projectInTeam(project, pilot.selectedTeamId)
    ) {
      pilot.setSelectedTeamId(project.primaryTeamId);
    }
    if (pilot.selectedProjectId !== routedProjectId) {
      pilot.setSelectedProjectId(routedProjectId);
    }
  }, [
    pilot?.enabled,
    pilot?.projects.data,
    pilot?.projects.isSuccess,
    pilot?.selectedProjectId,
    pilot?.selectedTeamId,
    routedProjectId,
  ]);

  if (invitationMatch) {
    return (
      <AcceptInvitationView
        token={routeSearch.token ?? ""}
        onEnterPulse={leaveInvitation}
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
  const entryGate = resolvePilotEntryGate({
    pilotEnabled: Boolean(pilot?.enabled),
    bootstrapActive,
    bootstrapLoaded: Boolean(pilot?.bootstrap.isSuccess),
    organizationConfigured: Boolean(pilot?.bootstrap.data?.organization),
    teamsLoaded: Boolean(pilot?.teams.isSuccess),
    teamCount: pilot?.teams.data?.teams.length ?? 0,
    canGovern,
  });
  if (entryGate === "admin_bootstrap" && pilot?.enabled) {
    return (
      <SetupView
        mode="canonical"
        onDone={() => {
          setBootstrapActive(false);
          openPulse({ replace: true });
        }}
      />
    );
  }
  if (entryGate === "no_team" && pilot?.enabled) {
    return <NoTeamAccessView onSignOut={pilot.signOutCurrentIdentity} />;
  }

  return (
    <div
      className={[
        "grid h-screen grid-rows-[38px_minmax(0,1fr)] bg-bg text-ink",
        "transition-[grid-template-columns,background-color,color] duration-300 ease-standard",
        navOpen
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
          onSelectProject={moveProjectScope}
          onSelectTeam={moveTeamScope}
        />
        <span className="ml-auto flex items-center gap-2 [-webkit-app-region:no-drag]">
          <button
            type="button"
            onClick={() => void navigate({ to: "/search" })}
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
            onClick={() => void navigate({ to: "/attention" })}
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
              onClick={() => {
                if (item.id === "pulse") openPulse();
                else if (item.id === "chat")
                  void navigate({ to: "/communications" });
                else if (item.id === "coord")
                  void navigate({ to: "/coordination" });
                else if (item.id === "spec") openProjectSurface("specs");
                else if (item.id === "project") openProjectSurface("work");
                else
                  void navigate({
                    to: "/admin/$tab",
                    params: { tab: "members" },
                  });
              }}
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
          onClick={() =>
            void navigate({
              to: "/settings/$category",
              params: { category: "personal" },
            })
          }
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
            void navigate({
              to: "/settings/$category",
              params: { category: "personal" },
            });
          }}
        />
      </nav>

      <main className="min-w-0 overflow-hidden">
        <RoutedNavigationContext.Provider
          value={{
            openAction,
            openAgentConnections,
            openProjectSurface,
            openPulse,
            selectedProjectId,
          }}
        >
          <RouteErrorBoundary key={pathname}>
            <Suspense fallback={<RouteLoadingView />}>
              <Outlet />
            </Suspense>
          </RouteErrorBoundary>
        </RoutedNavigationContext.Provider>
      </main>
    </div>
  );
}

function RouteLoadingView() {
  return (
    <div
      className="grid h-full place-items-center bg-bg"
      data-testid="route-loading"
      aria-live="polite"
    >
      <span className="inline-flex items-center gap-2 text-[11.5px] text-faint">
        <i
          aria-hidden="true"
          className="h-2 w-2 animate-pulse rounded-full bg-accent-strong"
        />
        正在打开…
      </span>
    </div>
  );
}

function waitForRetry(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function RoutedWorkspace() {
  const navigate = useNavigate();
  const matchRoute = useMatchRoute();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const routeSearch = useSearch({ strict: false }) as {
    standInOwnerId?: string;
    itemId?: string;
  };
  const {
    openAction,
    openAgentConnections,
    openProjectSurface,
    openPulse,
    selectedProjectId,
  } = useRoutedNavigation();
  const view = resolveAppView(pathname);
  const personMatch = matchRoute({ to: "/people/$personId" });
  const communicationMatch = matchRoute({
    to: "/communications/$threadId",
  });
  const coordinationMatch = matchRoute({
    to: "/coordination/$threadId",
  });
  const projectMatch = matchRoute({ to: "/projects/$projectId/work" });
  const itemMatch = matchRoute({
    to: "/projects/$projectId/items/$itemId",
  });
  const settingsMatch = matchRoute({ to: "/settings/$category" });
  const adminMatch = matchRoute({ to: "/admin/$tab" });

  if (view === "pulse") {
    return (
      <TeamPulseView
        onOpenPerson={(personId) =>
          void navigate({
            to: "/people/$personId",
            params: { personId },
          })
        }
        onOpenAction={openAction}
        onOpenAgentConnections={openAgentConnections}
        onOpenSpecs={() => openProjectSurface("specs")}
      />
    );
  }

  if (view === "person" && personMatch) {
    return (
      <PersonView
        ownerId={personMatch.personId}
        onBack={openPulse}
        onOpenChat={(threadId) =>
          void navigate({
            to: "/communications/$threadId",
            params: { threadId },
          })
        }
        onOpenStandIn={(standInOwnerId) =>
          void navigate({
            to: "/communications",
            search: { standInOwnerId },
          })
        }
      />
    );
  }

  if (view === "chat") {
    return (
      <CommunicationsView
        {...(selectedProjectId ? { selectedProjectId } : {})}
        {...(communicationMatch
          ? { initialThreadId: communicationMatch.threadId }
          : {})}
        {...(routeSearch.standInOwnerId
          ? { initialStandInOwnerId: routeSearch.standInOwnerId }
          : {})}
        onOpenThread={(threadId) =>
          void navigate({
            to: "/communications/$threadId",
            params: { threadId },
          })
        }
        onOpenStandIn={(standInOwnerId) =>
          void navigate({
            to: "/communications",
            search: { standInOwnerId },
          })
        }
        onOpenPerson={(personId) =>
          void navigate({
            to: "/people/$personId",
            params: { personId },
          })
        }
      />
    );
  }

  if (view === "coord") {
    return (
      <CoordinationView
        {...(coordinationMatch
          ? { initialThreadId: coordinationMatch.threadId }
          : {})}
        onSelectThread={(threadId) =>
          void navigate({
            to: "/coordination/$threadId",
            params: { threadId },
          })
        }
        onOpenThread={() => void navigate({ to: "/communications" })}
      />
    );
  }

  if (view === "spec") {
    return <SpecReviewView onOpenAgentConnections={openAgentConnections} />;
  }

  if (view === "project") {
    return (
      <ProjectView
        onOpenItem={(itemId) => {
          const projectId =
            (projectMatch && projectMatch.projectId) ?? selectedProjectId;
          if (!projectId) return;
          void navigate({
            to: "/projects/$projectId/items/$itemId",
            params: { projectId, itemId },
          });
        }}
        onOpenAgentConnections={openAgentConnections}
      />
    );
  }

  if (view === "item" && itemMatch) {
    return (
      <WorkItemView
        cardId={itemMatch.itemId}
        onBack={() => openProjectSurface("work", itemMatch.projectId)}
      />
    );
  }

  if (view === "settings") {
    return (
      <SettingsView
        initialCategory={settingsCategory(
          settingsMatch ? settingsMatch.category : undefined,
        )}
        onCategoryChange={(category) =>
          void navigate({
            to: "/settings/$category",
            params: { category },
          })
        }
      />
    );
  }

  if (view === "admin") {
    return (
      <AdminView
        initialTab={adminTab(adminMatch ? adminMatch.tab : undefined)}
        onTabChange={(tab) =>
          void navigate({
            to: "/admin/$tab",
            params: { tab },
          })
        }
        onOpenSpecs={() => openProjectSurface("specs")}
      />
    );
  }

  if (view === "inbox") {
    return (
      <AttentionView
        onOpenAction={openAction}
        {...(routeSearch.itemId ? { focusedItemId: routeSearch.itemId } : {})}
      />
    );
  }

  if (view === "search") {
    return (
      <SearchView
        onOpenPerson={(personId) =>
          void navigate({
            to: "/people/$personId",
            params: { personId },
          })
        }
        onOpenResult={(result) => {
          if (result.sourceRef.startsWith("work-item:")) {
            if (!selectedProjectId) return;
            void navigate({
              to: "/projects/$projectId/items/$itemId",
              params: {
                projectId: selectedProjectId,
                itemId: result.sourceRef.slice("work-item:".length),
              },
            });
          } else if (result.sourceRef.startsWith("spec")) {
            openProjectSurface("specs");
          } else if (result.sourceRef.startsWith("coordination:")) {
            void navigate({
              to: "/coordination/$threadId",
              params: {
                threadId: result.sourceRef.slice("coordination:".length),
              },
            });
          } else {
            openPulse();
          }
        }}
      />
    );
  }

  return (
    <div className="grid h-full place-items-center p-10 text-center">
      <div>
        <p className="font-mono text-[11px] text-faint">404</p>
        <h1 className="mt-2 text-[22px] font-[620]">找不到这个页面</h1>
        <button
          type="button"
          onClick={() => openPulse({ replace: true })}
          className="mt-5 h-9 rounded-btn border-0 bg-accent-strong px-4 text-[12px] font-[620] text-on-accent"
        >
          返回 Team Pulse
        </button>
      </div>
    </div>
  );
}
