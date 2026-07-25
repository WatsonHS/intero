import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { App } from "./App.js";
import { I18nProvider } from "./i18n/index.js";

describe("desktop application shell", () => {
  it("renders localized navigation without a fixture identity", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const output = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <App />
        </I18nProvider>
      </QueryClientProvider>,
    );

    expect(output).toContain("团队脉搏");
    expect(output).toContain("通讯");
    expect(output).toContain("看板");
    expect(output).toContain("方案评审");
    expect(output).not.toContain("Huang Sheng");
    expect(output).not.toContain("Friday, 24 July");
  });
});
