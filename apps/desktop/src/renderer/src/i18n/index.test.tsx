import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { I18nProvider, useI18n } from "./index.js";
import { enUS } from "./locales/en-US.js";
import { zhCN } from "./locales/zh-CN.js";

describe("desktop localization", () => {
  it("keeps Chinese and English dictionaries in exact key parity", () => {
    expect(Object.keys(enUS).sort()).toEqual(Object.keys(zhCN).sort());
  });

  it("renders Chinese by default when no device preference is available", () => {
    function Probe() {
      const { locale, t } = useI18n();
      return (
        <span data-locale={locale}>
          {t("pulse.title")} · {t("settings.language")}
        </span>
      );
    }

    const output = renderToStaticMarkup(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );

    expect(output).toContain('data-locale="zh-CN"');
    expect(output).toContain("大家正在干什么");
    expect(output).toContain("界面语言");
  });
});
