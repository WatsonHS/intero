import { createMemoryHistory } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { resolveAppView } from "./App.js";
import { createInteroRouter } from "./router.js";

describe("application routes", () => {
  it("maps canonical URLs to their application surfaces", () => {
    expect(resolveAppView("/pulse")).toBe("pulse");
    expect(resolveAppView("/people/person-1")).toBe("person");
    expect(resolveAppView("/communications/thread-1")).toBe("chat");
    expect(resolveAppView("/coordination/branch-1")).toBe("coord");
    expect(resolveAppView("/projects/project-1/work")).toBe("project");
    expect(resolveAppView("/projects/project-1/items/item-1")).toBe("item");
    expect(resolveAppView("/projects/project-1/specs")).toBe("spec");
    expect(resolveAppView("/settings/agent")).toBe("settings");
    expect(resolveAppView("/admin/members")).toBe("admin");
    expect(resolveAppView("/does-not-exist")).toBe("not_found");
  });

  it("keeps the root URL as a Team Pulse alias", async () => {
    const router = createInteroRouter(
      createMemoryHistory({ initialEntries: ["/"] }),
    );

    await router.load();

    expect(router.state.location.pathname).toBe("/");
    expect(resolveAppView(router.state.location.pathname)).toBe("pulse");
  });

  it("preserves route params, search, and browser history", async () => {
    const history = createMemoryHistory({ initialEntries: ["/pulse"] });
    const router = createInteroRouter(history);
    await router.load();

    await router.navigate({
      to: "/people/$personId",
      params: { personId: "person-1" },
    });
    expect(router.state.location.pathname).toBe("/people/person-1");

    await router.navigate({
      to: "/communications",
      search: { standInOwnerId: "person-2" },
    });
    expect(router.state.location.href).toContain(
      "/communications?standInOwnerId=person-2",
    );

    history.back();
    await router.load();
    expect(router.state.location.pathname).toBe("/people/person-1");
  });

  it("keeps invitation tokens on the dedicated invitation route", async () => {
    const router = createInteroRouter(
      createMemoryHistory({
        initialEntries: ["/accept-invitation?token=invite_test"],
      }),
    );

    await router.load();

    expect(router.state.location.pathname).toBe("/accept-invitation");
    expect(router.state.location.search).toEqual({ token: "invite_test" });
  });
});
