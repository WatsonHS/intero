import {
  ChatCircleDotsIcon,
  FileTextIcon,
  GearSixIcon,
  GitBranchIcon,
  PulseIcon,
  SidebarSimpleIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { getBootstrap, getOfflineStatus } from "./api.js";
import { useI18n } from "./i18n/index.js";
import type { TranslationKey } from "./i18n/locales/zh-CN.js";
import { RepresentativeView } from "./views/RepresentativeView.js";
import { ProjectRoomView } from "./views/ProjectRoomView.js";
import { SettingsView } from "./views/SettingsView.js";
import { SpecReviewView } from "./views/SpecReviewView.js";
import { TeamPulseView } from "./views/TeamPulseView.js";

type View =
  "pulse" | "representative" | "rooms" | "coordination" | "specs" | "settings";

const navigation: Array<{
  id: View;
  label: TranslationKey;
  icon: typeof PulseIcon;
}> = [
  { id: "pulse", label: "app.nav.pulse", icon: PulseIcon },
  {
    id: "representative",
    label: "app.nav.representative",
    icon: ChatCircleDotsIcon,
  },
  { id: "rooms", label: "app.nav.rooms", icon: UsersThreeIcon },
  { id: "coordination", label: "app.nav.coordination", icon: GitBranchIcon },
  { id: "specs", label: "app.nav.specs", icon: FileTextIcon },
];

export function App() {
  const { t } = useI18n();
  const [view, setView] = useState<View>("pulse");
  const [sidebarOpen, setSidebarOpen] = useState(true);
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

  return (
    <div
      className={sidebarOpen ? "app-shell" : "app-shell app-shell--collapsed"}
    >
      <aside className="sidebar" aria-label={t("app.primaryNavigation")}>
        <div className="sidebar__brand">
          <span className="brand-mark" aria-hidden="true">
            I
          </span>
          <span className="brand-word">INTERO</span>
          <button
            className="icon-button sidebar__toggle"
            type="button"
            aria-label={
              sidebarOpen
                ? t("app.collapseNavigation")
                : t("app.expandNavigation")
            }
            onClick={() => setSidebarOpen((current) => !current)}
          >
            <SidebarSimpleIcon size={18} weight="regular" />
          </button>
        </div>

        <nav className="sidebar__nav">
          <p className="nav-label">{t("app.workspace")}</p>
          {navigation.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className={
                  view === item.id ? "nav-item nav-item--active" : "nav-item"
                }
                onClick={() => setView(item.id)}
              >
                <Icon
                  size={19}
                  weight={view === item.id ? "fill" : "regular"}
                />
                <span>{t(item.label)}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar__footer">
          <button
            type="button"
            className={
              view === "settings" ? "nav-item nav-item--active" : "nav-item"
            }
            onClick={() => setView("settings")}
          >
            <GearSixIcon size={19} weight="regular" />
            <span>{t("app.nav.settings")}</span>
          </button>
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

      <main className="workspace">
        {view === "pulse" ? (
          <TeamPulseView
            onOpenRepresentative={() => setView("representative")}
            onOpenAction={(sourceRef) =>
              setView(sourceRef.startsWith("spec:") ? "specs" : "coordination")
            }
          />
        ) : null}
        {view === "representative" ? <RepresentativeView /> : null}
        {view === "rooms" ? <ProjectRoomView /> : null}
        {view === "coordination" ? <RepresentativeView coordination /> : null}
        {view === "specs" ? <SpecReviewView /> : null}
        {view === "settings" ? <SettingsView /> : null}
      </main>
    </div>
  );
}

function initials(name: string | undefined): string {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts.at(-1)![0] ?? ""}`.toUpperCase();
}
