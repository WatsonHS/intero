import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NotificationProvider } from "./design/notifications.js";
import { ThemeProvider } from "./design/theme.js";
import { I18nProvider } from "./i18n/index.js";
import { createInteroRouter } from "./router.js";

async function renderShell(
  queryClient: QueryClient,
  path = "/pulse",
): Promise<string> {
  const router = createInteroRouter(
    createMemoryHistory({ initialEntries: [path] }),
  );
  await router.load();
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <ThemeProvider>
          <NotificationProvider>
            <RouterProvider router={router} />
          </NotificationProvider>
        </ThemeProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

describe("desktop application shell", () => {
  it("renders localized navigation without a fixture identity", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const output = await renderShell(queryClient);

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

  it("keeps the governance surface out of the rail without a lead role", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const output = await renderShell(queryClient);

    // 团队管理 is gated on being a team leader or organization admin; with no
    // resolved membership it must not appear at all.
    expect(output).not.toContain("团队管理");
    // The breadcrumb falls back to the product name and still names the view.
    expect(output).toContain("Intero");
  });

  it("keeps the titlebar brand fixed when an organization is active", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(["bootstrap"], {
      organization: { id: "org-demo", name: "演示组织" },
    });

    const output = await renderShell(queryClient);

    expect(output).toMatch(/data-testid="app-brand"[^>]*>Intero<\/span>/);
    expect(output).not.toMatch(/data-testid="app-brand"[^>]*>演示组织<\/span>/);
  });

  it("renders a settings category directly from its URL", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const output = await renderShell(queryClient, "/settings/agent");

    // Static rendering does not resolve client-only lazy routes, but the shell
    // must still select the correct destination for a direct URL.
    expect(output).toMatch(/title="设置"[^>]*aria-current="page"/);
  });
});
