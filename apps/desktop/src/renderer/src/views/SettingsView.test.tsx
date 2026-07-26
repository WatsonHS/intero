import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ThemeProvider } from "../design/theme.js";
import { I18nProvider } from "../i18n/index.js";
import { SettingsView } from "./SettingsView.js";

describe("canonical settings view", () => {
  it("keeps normal settings and exposes test setup only when requested", () => {
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
    expect(output).toContain("本地运行时");
    expect(output).toContain("Test Setup");
    expect(output).toContain("仅开发环境可见");
  });
});
