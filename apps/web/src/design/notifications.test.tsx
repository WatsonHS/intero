import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "../i18n/index.js";
import {
  MAX_VISIBLE_NOTIFICATIONS,
  NotificationCard,
  NotificationProvider,
  notificationReducer,
  useNotifications,
  type AppNotification,
} from "./notifications.js";

function notification(id: string): AppNotification {
  return {
    id,
    tone: "success",
    message: `notification ${id}`,
    durationMs: 0,
  };
}

describe("notification framework", () => {
  it("exposes the notification API through its provider", () => {
    function Probe() {
      const api = useNotifications();
      return (
        <span>
          {[
            api.notify,
            api.success,
            api.error,
            api.warning,
            api.info,
            api.dismiss,
            api.clear,
          ].every((entry) => typeof entry === "function")
            ? "ready"
            : "missing"}
        </span>
      );
    }

    const output = renderToStaticMarkup(
      <I18nProvider>
        <NotificationProvider>
          <Probe />
        </NotificationProvider>
      </I18nProvider>,
    );

    expect(output).toContain("ready");
  });

  it("limits the visible stack and supports dismissing and clearing", () => {
    const all = Array.from(
      { length: MAX_VISIBLE_NOTIFICATIONS + 2 },
      (_, index) => notification(String(index)),
    ).reduce(
      (state, entry) =>
        notificationReducer(state, { type: "add", notification: entry }),
      [] as AppNotification[],
    );

    expect(all).toHaveLength(MAX_VISIBLE_NOTIFICATIONS);
    expect(all[0]?.id).toBe("2");
    expect(
      notificationReducer(all, { type: "dismiss", id: "3" }).some(
        (entry) => entry.id === "3",
      ),
    ).toBe(false);
    expect(notificationReducer(all, { type: "clear" })).toEqual([]);
  });

  it("uses polite status semantics for success and alerts for errors", () => {
    const success = renderToStaticMarkup(
      <I18nProvider>
        <NotificationCard
          notification={notification("success")}
          onDismiss={() => undefined}
        />
      </I18nProvider>,
    );
    const danger = renderToStaticMarkup(
      <I18nProvider>
        <NotificationCard
          notification={{
            ...notification("danger"),
            tone: "danger",
          }}
          onDismiss={() => undefined}
        />
      </I18nProvider>,
    );

    expect(success).toContain('role="status"');
    expect(success).toContain('aria-label="关闭"');
    expect(danger).toContain('role="alert"');
  });
});
