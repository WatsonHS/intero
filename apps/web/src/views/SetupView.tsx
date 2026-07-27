import { CloudSlashIcon } from "@phosphor-icons/react";

import { useI18n } from "../i18n/index.js";
import { usePilotOptional } from "../pilot/context.js";
import { PilotTestSetupFlow } from "./pilot/PilotSetupView.js";

export function SetupView({
  mode = "canonical",
  onDone,
}: {
  mode?: "canonical" | "pilot-test";
  onDone: () => void;
}) {
  const pilot = usePilotOptional();
  const { t } = useI18n();

  if (pilot?.enabled) {
    return (
      <PilotTestSetupFlow testMode={mode === "pilot-test"} onDone={onDone} />
    );
  }

  return (
    <div className="animate-view-enter grid h-full place-items-center bg-bg px-8">
      <div className="w-full max-w-[520px] rounded-container border border-line bg-panel2 p-8">
        <span className="grid h-10 w-10 place-items-center rounded-[12px] bg-accent-soft text-accent-strong">
          <CloudSlashIcon size={20} />
        </span>
        <h1 className="mt-5 text-[24px] font-[560] tracking-[-0.03em]">
          {t("setup.cloudUnavailable.title")}
        </h1>
        <p className="mt-3 text-[13px] leading-[1.75] text-ink-muted">
          {t("setup.cloudUnavailable.body")}
        </p>
        <button
          type="button"
          onClick={onDone}
          className="mt-6 h-9 rounded-btn border border-line2 bg-transparent px-4 text-[12.5px] text-ink hover:border-accent-strong"
        >
          {t("setup.cloudUnavailable.back")}
        </button>
      </div>
    </div>
  );
}
