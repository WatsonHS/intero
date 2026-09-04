import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider, resolveInitialLocale, useI18n } from "./index.js";
import { enUS } from "./locales/en-US.js";
import { zhCN } from "./locales/zh-CN.js";

describe("desktop localization", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps Chinese and English dictionaries in exact key parity", () => {
    expect(Object.keys(enUS).sort()).toEqual(Object.keys(zhCN).sort());
  });

  it("picks English from the browser locale when nothing is stored", () => {
    expect(
      resolveInitialLocale({ stored: null, languages: ["en-US", "en"] }),
    ).toBe("en-US");
    expect(resolveInitialLocale({ stored: null, languages: ["zh-CN"] })).toBe(
      "zh-CN",
    );
    expect(
      resolveInitialLocale({ stored: "zh-CN", languages: ["en-US"] }),
    ).toBe("zh-CN");
    expect(resolveInitialLocale({ stored: null, languages: ["fr-FR"] })).toBe(
      "zh-CN",
    );
  });

  it("prefers the server locale over stored and navigator values", () => {
    expect(
      resolveInitialLocale({
        server: "en-US",
        stored: "zh-CN",
        languages: ["zh-CN"],
      }),
    ).toBe("en-US");
    expect(
      resolveInitialLocale({
        server: "zh-CN",
        stored: "en-US",
        languages: ["en-US"],
      }),
    ).toBe("zh-CN");
    expect(
      resolveInitialLocale({
        stored: "en-US",
        languages: ["zh-CN"],
      }),
    ).toBe("en-US");
    expect(
      resolveInitialLocale({
        stored: null,
        languages: ["en-GB"],
      }),
    ).toBe("en-US");
    expect(resolveInitialLocale({ stored: null, languages: ["de"] })).toBe(
      "zh-CN",
    );
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
    expect(output).toContain("界面与协作语言");
  });

  it("formats future deadlines without calling them just now", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-27T00:00:00.000Z"));

    function Probe() {
      const { formatRelative } = useI18n();
      return <span>{formatRelative("2026-08-03T00:00:00.000Z")}过期</span>;
    }

    const output = renderToStaticMarkup(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );

    expect(output).toContain("7 天后过期");
    expect(output).not.toContain("刚刚过期");
  });
});
