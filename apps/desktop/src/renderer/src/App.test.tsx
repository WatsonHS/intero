import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { App } from "./App.js";
import { ThemeProvider } from "./design/theme.js";
import { I18nProvider } from "./i18n/index.js";

describe("desktop application shell", () => {
  it("renders localized navigation without a fixture identity", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const output = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <ThemeProvider>
            <App />
          </ThemeProvider>
        </I18nProvider>
      </QueryClientProvider>,
    );

    expect(output).toContain("Team Pulse");
    expect(output).toContain("通讯");
    expect(output).toContain("项目");
    expect(output).toContain("Spec Review");
    expect(output).toContain("设置");
    expect(output).toContain("账户与个人资料");
    expect(output).not.toContain("Huang Sheng");
    expect(output).not.toContain("Friday, 24 July");
    expect(output).not.toContain("Development identity");
    expect(output).not.toContain("Intero Cloud Pilot");
    expect(output).not.toContain("macos-titlebar-controls-spacer");
    expect(output).not.toContain("bg-[#e0685f]");
  });

  it("keeps the governance surface out of the rail without a lead role", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const output = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <ThemeProvider>
            <App />
          </ThemeProvider>
        </I18nProvider>
      </QueryClientProvider>,
    );

    // 团队管理 is gated on being a team leader or organization admin; with no
    // resolved membership it must not appear at all.
    expect(output).not.toContain("团队管理");
    // The breadcrumb falls back to the product name and still names the view.
    expect(output).toContain("Intero");
  });
});
