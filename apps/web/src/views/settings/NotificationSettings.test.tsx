import type { PrincipalId } from "@intero/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { zhCN } from "../../i18n/locales/zh-CN.js";
import { I18nProvider } from "../../i18n/index.js";
import {
  NotificationSettings,
  webPushDescriptionKey,
} from "./NotificationSettings.js";

vi.mock("../../web-push-client.js", () => ({
  browserSupportsWebPush: () => true,
  currentPushSubscription: async () => undefined,
  subscribeWebPush: async () => {
    throw new Error("subscribe is not used in this render");
  },
  unsubscribeWebPush: async () => undefined,
}));

vi.mock("../../action-inbox-browser-notifications.js", () => ({
  currentBrowserNotificationPermission: () => "granted",
  requestBrowserNotificationPermission: async () => "granted",
}));

function render(node: ReactNode): string {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(["web-push-config"], {
    enabled: true,
    publicKey: "B".repeat(87),
  });
  queryClient.setQueryData(["action-inbox"], {
    items: [],
    preferences: {
      principalId: "019b5ac0-7600-7000-8000-000000000002" as PrincipalId,
      mutedKinds: [],
      messages: "mentions",
      updatedAt: "2026-09-03T12:00:00.000Z",
    },
    unreadCount: 0,
    automationSummary: [],
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>{node}</I18nProvider>
    </QueryClientProvider>,
  );
}

describe("webPushDescriptionKey", () => {
  it("shows unavailable only without Push support or when config is disabled", () => {
    expect(
      webPushDescriptionKey({
        pushSupported: false,
        config: { enabled: true },
        permission: "granted",
        subscribed: false,
      }),
    ).toBe("settings.notifications.webPushUnavailable");
    expect(
      webPushDescriptionKey({
        pushSupported: true,
        config: { enabled: false },
        permission: "granted",
        subscribed: false,
      }),
    ).toBe("settings.notifications.webPushUnavailable");
    expect(
      webPushDescriptionKey({
        pushSupported: true,
        permission: "denied",
        subscribed: false,
      }),
    ).toBe("settings.notifications.webPushDenied");
    expect(
      webPushDescriptionKey({
        pushSupported: true,
        config: { enabled: true },
        permission: "granted",
        subscribed: false,
      }),
    ).toBe("settings.notifications.webPushLede");
    expect(
      webPushDescriptionKey({
        pushSupported: true,
        config: { enabled: true },
        permission: "granted",
        subscribed: true,
      }),
    ).toBe("settings.notifications.webPushLede");
  });
});

describe("NotificationSettings", () => {
  it("shows the enable copy when Web Push is configured but not subscribed", () => {
    const output = render(<NotificationSettings />);
    expect(output).toContain(zhCN["settings.notifications.webPushLede"]);
    expect(output).not.toContain(
      zhCN["settings.notifications.webPushUnavailable"],
    );
    expect(output).toContain(zhCN["settings.notifications.webPushOff"]);
  });
});
