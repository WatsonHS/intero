import {
  CheckIcon,
  DesktopTowerIcon,
  EyeSlashIcon,
  HardDrivesIcon,
  KeyIcon,
} from "@phosphor-icons/react";
import { useState } from "react";

export function SettingsView() {
  const [egress, setEgress] = useState(
    () => localStorage.getItem("intero:model-egress") ?? "disabled",
  );

  function selectEgress(value: string) {
    localStorage.setItem("intero:model-egress", value);
    setEgress(value);
  }

  return (
    <div className="settings-view">
      <header className="view-header">
        <div>
          <p className="eyebrow">Local trust boundary</p>
          <h1>Privacy & runtime</h1>
          <p className="view-header__lede">
            Decide what Intero may observe, interpret, and project to the team.
          </p>
        </div>
      </header>

      <section className="settings-section">
        <div className="settings-section__intro">
          <HardDrivesIcon size={22} />
          <div>
            <h2>Authorized Workspaces</h2>
            <p>Only enrolled roots produce work signals.</p>
          </div>
        </div>
        <div className="workspace-setting">
          <span className="workspace-setting__mark">IN</span>
          <span>
            <strong>intero</strong>
            <small>~/Development/intero · Git worktrees included</small>
          </span>
          <span className="setting-ok">
            <CheckIcon size={13} /> active
          </span>
          <button
            type="button"
            disabled
            title="Workspace enrollment is managed by interod in the MVP."
          >
            Managed by interod
          </button>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section__intro">
          <EyeSlashIcon size={22} />
          <div>
            <h2>Model egress</h2>
            <p>
              Deterministic Work State continues in every mode. This desktop
              preference does not enable model calls by itself.
            </p>
          </div>
        </div>
        <div className="choice-grid">
          <label>
            <input
              type="radio"
              name="egress"
              checked={egress === "managed_api"}
              onChange={() => selectEgress("managed_api")}
            />
            <span>
              <strong>Managed API</strong>
              <small>Policy-filtered context</small>
            </span>
          </label>
          <label>
            <input
              type="radio"
              name="egress"
              checked={egress === "user_provided_api"}
              onChange={() => selectEgress("user_provided_api")}
            />
            <span>
              <strong>Your provider</strong>
              <small>Credential stays in OS keychain</small>
            </span>
          </label>
          <label>
            <input
              type="radio"
              name="egress"
              checked={egress === "disabled"}
              onChange={() => selectEgress("disabled")}
            />
            <span>
              <strong>Disabled</strong>
              <small>No model calls</small>
            </span>
          </label>
        </div>
      </section>

      <section className="settings-section settings-section--split">
        <div className="settings-section__intro">
          <DesktopTowerIcon size={22} />
          <div>
            <h2>Local runtime</h2>
            <p>interod 0.1.0 · Local Representative 0.1.0</p>
          </div>
        </div>
        <div className="runtime-detail">
          <span className="runtime-dot" />
          <span>
            <strong>Connected</strong>
            <small>Unix socket · OS user bound</small>
          </span>
        </div>
        <div className="runtime-detail">
          <KeyIcon size={18} />
          <span>
            <strong>Encrypted storage</strong>
            <small>SQLCipher · key stored in Keychain</small>
          </span>
        </div>
      </section>
    </div>
  );
}
