import {
  ChatCircleDotsIcon,
  FileTextIcon,
  GearSixIcon,
  GitBranchIcon,
  PulseIcon,
  SidebarSimpleIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";
import { useState } from "react";

import { RepresentativeView } from "./views/RepresentativeView.js";
import { ProjectRoomView } from "./views/ProjectRoomView.js";
import { SettingsView } from "./views/SettingsView.js";
import { SpecReviewView } from "./views/SpecReviewView.js";
import { TeamPulseView } from "./views/TeamPulseView.js";

type View =
  "pulse" | "representative" | "rooms" | "coordination" | "specs" | "settings";

const navigation: Array<{
  id: View;
  label: string;
  icon: typeof PulseIcon;
}> = [
  { id: "pulse", label: "Team Pulse", icon: PulseIcon },
  { id: "representative", label: "Representative", icon: ChatCircleDotsIcon },
  { id: "rooms", label: "Project Room", icon: UsersThreeIcon },
  { id: "coordination", label: "Coordination", icon: GitBranchIcon },
  { id: "specs", label: "Specs", icon: FileTextIcon },
];

export function App() {
  const [view, setView] = useState<View>("pulse");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div
      className={sidebarOpen ? "app-shell" : "app-shell app-shell--collapsed"}
    >
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="sidebar__brand">
          <span className="brand-mark" aria-hidden="true">
            I
          </span>
          <span className="brand-word">INTERO</span>
          <button
            className="icon-button sidebar__toggle"
            type="button"
            aria-label={
              sidebarOpen ? "Collapse navigation" : "Expand navigation"
            }
            onClick={() => setSidebarOpen((current) => !current)}
          >
            <SidebarSimpleIcon size={18} weight="regular" />
          </button>
        </div>

        <nav className="sidebar__nav">
          <p className="nav-label">Workspace</p>
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
                <span>{item.label}</span>
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
            <span>Settings</span>
          </button>
          <div className="identity-chip">
            <span className="identity-chip__avatar">HS</span>
            <span>
              <strong>Huang Sheng</strong>
              <small>Local connected</small>
            </span>
          </div>
        </div>
      </aside>

      <main className="workspace">
        {view === "pulse" ? (
          <TeamPulseView
            onOpenRepresentative={() => setView("representative")}
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
