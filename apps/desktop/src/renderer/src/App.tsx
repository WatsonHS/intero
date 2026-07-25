import {
  ChatCircleDotsIcon,
  FileTextIcon,
  GearSixIcon,
  GitBranchIcon,
  KanbanIcon,
  PulseIcon,
  SidebarSimpleIcon,
} from "@phosphor-icons/react";
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@intero/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { getBootstrap, getOfflineStatus } from "./api.js";
import { useI18n } from "./i18n/index.js";
import type { TranslationKey } from "./i18n/locales/zh-CN.js";
import { CommunicationsView } from "./views/CommunicationsView.js";
import { KanbanView } from "./views/KanbanView.js";
import { RepresentativeView } from "./views/RepresentativeView.js";
import { SettingsView } from "./views/SettingsView.js";
import { SpecReviewView } from "./views/SpecReviewView.js";
import { TeamPulseView } from "./views/TeamPulseView.js";

type View = "pulse" | "chat" | "kanban" | "coordination" | "specs" | "settings";

const navigation: Array<{
  id: View;
  label: TranslationKey;
  icon: typeof PulseIcon;
}> = [
  { id: "pulse", label: "app.nav.pulse", icon: PulseIcon },
  {
    id: "chat",
    label: "app.nav.chat",
    icon: ChatCircleDotsIcon,
  },
  { id: "kanban", label: "app.nav.kanban", icon: KanbanIcon },
  { id: "coordination", label: "app.nav.coordination", icon: GitBranchIcon },
  { id: "specs", label: "app.nav.specs", icon: FileTextIcon },
];

export function App() {
  const { t } = useI18n();
  const [view, setView] = useState<View>("pulse");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const bootstrap = useQuery({
    queryKey: ["bootstrap"],
    queryFn: ({ signal }) => getBootstrap(signal),
  });
  const runtime = useQuery({
    queryKey: ["offline-status"],
    queryFn: ({ signal }) => getOfflineStatus(signal),
    refetchInterval: 5_000,
  });
  const identity = bootstrap.data?.currentPrincipal;
  const runtimeLabel = runtime.isPending
    ? t("general.loading")
    : runtime.data?.localRuntime === "online"
      ? t("app.localConnected")
      : runtime.data?.fallback === "public"
        ? t("app.publicFallback")
        : t("app.runtimeUnavailable");
  const activeViewLabel =
    view === "settings"
      ? t("app.nav.settings")
      : t(
          navigation.find((item) => item.id === view)?.label ?? "app.nav.pulse",
        );

  return (
    <TooltipProvider>
      <div
        className={sidebarOpen ? "app-shell" : "app-shell app-shell--collapsed"}
      >
        <aside className="sidebar" aria-label={t("app.primaryNavigation")}>
          <div className="sidebar__brand">
            <span className="brand-mark" aria-hidden="true">
              I
            </span>
            <span className="brand-word">INTERO</span>
            <Button
              className="icon-button sidebar__toggle"
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={
                sidebarOpen
                  ? t("app.collapseNavigation")
                  : t("app.expandNavigation")
              }
              onClick={() => setSidebarOpen((current) => !current)}
            >
              <SidebarSimpleIcon size={18} weight="regular" />
            </Button>
          </div>

          <nav className="sidebar__nav">
            <p className="nav-label">{t("app.workspace")}</p>
            {navigation.map((item) => {
              const Icon = item.icon;
              return (
                <Tooltip key={item.id}>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      className={
                        view === item.id
                          ? "nav-item nav-item--active"
                          : "nav-item"
                      }
                      aria-current={view === item.id ? "page" : undefined}
                      onClick={() => setView(item.id)}
                    >
                      <Icon
                        size={19}
                        weight={view === item.id ? "fill" : "regular"}
                      />
                      <span>{t(item.label)}</span>
                    </Button>
                  </TooltipTrigger>
                  {!sidebarOpen ? (
                    <TooltipContent side="right">
                      {t(item.label)}
                    </TooltipContent>
                  ) : null}
                </Tooltip>
              );
            })}
          </nav>

          <div className="sidebar__footer">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  className={
                    view === "settings"
                      ? "nav-item nav-item--active"
                      : "nav-item"
                  }
                  aria-current={view === "settings" ? "page" : undefined}
                  onClick={() => setView("settings")}
                >
                  <GearSixIcon size={19} weight="regular" />
                  <span>{t("app.nav.settings")}</span>
                </Button>
              </TooltipTrigger>
              {!sidebarOpen ? (
                <TooltipContent side="right">
                  {t("app.nav.settings")}
                </TooltipContent>
              ) : null}
            </Tooltip>
            <div className="identity-chip">
              <span className="identity-chip__avatar">
                {initials(identity?.displayName)}
              </span>
              <span>
                <strong>{identity?.displayName ?? "—"}</strong>
                <small>{runtimeLabel}</small>
              </span>
            </div>
          </div>
        </aside>

        <div className="app-frame">
          <header className="app-topbar">
            <div className="app-topbar__breadcrumb">
              <strong>Intero</strong>
              <span aria-hidden="true">—</span>
              <span>{activeViewLabel}</span>
            </div>
            <div className="app-topbar__runtime">
              <span
                className={
                  runtime.data?.localRuntime === "online"
                    ? "runtime-dot"
                    : "runtime-dot runtime-dot--stale"
                }
                aria-hidden="true"
              />
              <span>{runtimeLabel}</span>
            </div>
          </header>

          <main className="workspace">
            {view === "pulse" ? (
              <TeamPulseView
                onOpenRepresentative={() => setView("chat")}
                onOpenAction={(sourceRef) =>
                  setView(
                    sourceRef.startsWith("spec:") ? "specs" : "coordination",
                  )
                }
              />
            ) : null}
            {view === "chat" ? <CommunicationsView /> : null}
            {view === "kanban" ? <KanbanView /> : null}
            {view === "coordination" ? (
              <RepresentativeView coordination />
            ) : null}
            {view === "specs" ? <SpecReviewView /> : null}
            {view === "settings" ? <SettingsView /> : null}
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}

function initials(name: string | undefined): string {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts.at(-1)![0] ?? ""}`.toUpperCase();
}
