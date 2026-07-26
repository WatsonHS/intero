import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ThemeProvider } from "../design/theme.js";
import { I18nProvider } from "../i18n/index.js";
import { SettingsView } from "./SettingsView.js";

describe("canonical settings view", () => {
  it("keeps only the personal-scope categories; governance lives in 团队管理", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const output = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <ThemeProvider>
            <SettingsView
              onOpenSetup={() => undefined}
              onOpenTestSetup={() => undefined}
            />
          </ThemeProvider>
        </I18nProvider>
      </QueryClientProvider>,
    );

    expect(output).toContain("外观");
    expect(output).toContain("界面与协作语言");
    expect(output).toContain("Coding Agent 工作动态和替身回复");
    expect(output).toContain("Personal");
    expect(output).toContain("Project");
    expect(output).toContain("Coding Agent");
    // Members, deployment and the model service are organization-wide
    // governance and now belong to 团队管理, not to per-person settings.
    expect(output).not.toContain("Team &amp; Members");
    expect(output).not.toContain("Intero Service");
    expect(output).not.toContain("Model Service");
    expect(output).not.toContain("本地运行时");
    expect(output).not.toContain("公共平面");
    expect(output).not.toContain("Test Setup");
  });

  it("keeps the explicit test setup entry with the connection settings", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const output = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <ThemeProvider>
            <SettingsView
              initialCategory="agent"
              onOpenSetup={() => undefined}
              onOpenTestSetup={() => undefined}
            />
          </ThemeProvider>
        </I18nProvider>
      </QueryClientProvider>,
    );

    expect(output).toContain("Test Setup");
    expect(output).toContain("仅开发环境可见");
    expect(output).not.toContain("界面语言");
  });
});
