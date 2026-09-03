import {
  createBrowserHistory,
  createHashHistory,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";

import { App, RoutedWorkspace } from "./App.js";

const rootRoute = createRootRoute({
  component: App,
  notFoundComponent: RoutedWorkspace,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: RoutedWorkspace,
});

const pulseRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/pulse",
  component: RoutedWorkspace,
});

const personRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/people/$personId",
  component: RoutedWorkspace,
});

const communicationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/communications",
  validateSearch: (
    search: Record<string, unknown>,
  ): { standInOwnerId?: string } =>
    typeof search.standInOwnerId === "string"
      ? { standInOwnerId: search.standInOwnerId }
      : {},
  component: RoutedWorkspace,
});

const communicationThreadRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/communications/$threadId",
  validateSearch: (
    search: Record<string, unknown>,
  ): { messageId?: string; sequence?: number } => {
    const sequence = Number(search.sequence);
    return {
      ...(typeof search.messageId === "string"
        ? { messageId: search.messageId }
        : {}),
      ...(Number.isFinite(sequence) && sequence > 0 ? { sequence } : {}),
    };
  },
  component: RoutedWorkspace,
});

const coordinationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/coordination",
  component: RoutedWorkspace,
});

const coordinationThreadRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/coordination/$threadId",
  component: RoutedWorkspace,
});

const projectWorkRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/work",
  component: RoutedWorkspace,
});

const projectItemRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/items/$itemId",
  component: RoutedWorkspace,
});

const projectSpecsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/specs",
  component: RoutedWorkspace,
});

const attentionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/attention",
  validateSearch: (search: Record<string, unknown>): { itemId?: string } =>
    typeof search.itemId === "string" ? { itemId: search.itemId } : {},
  component: RoutedWorkspace,
});

const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/search",
  component: RoutedWorkspace,
});

const adminIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin",
  component: RoutedWorkspace,
});

const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/$tab",
  component: RoutedWorkspace,
});

const settingsIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: RoutedWorkspace,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/$category",
  component: RoutedWorkspace,
});

const invitationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/accept-invitation",
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : "",
  }),
  component: RoutedWorkspace,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  pulseRoute,
  personRoute,
  communicationsRoute,
  communicationThreadRoute,
  coordinationRoute,
  coordinationThreadRoute,
  projectWorkRoute,
  projectItemRoute,
  projectSpecsRoute,
  attentionRoute,
  searchRoute,
  adminIndexRoute,
  adminRoute,
  settingsIndexRoute,
  settingsRoute,
  invitationRoute,
]);

function createRuntimeHistory() {
  if (typeof window === "undefined") {
    return createMemoryHistory({ initialEntries: ["/"] });
  }
  return window.location.protocol === "file:"
    ? createHashHistory()
    : createBrowserHistory();
}

export function createInteroRouter(
  history: ReturnType<typeof createMemoryHistory> = createRuntimeHistory(),
) {
  return createRouter({
    routeTree,
    history,
    defaultPreload: "intent",
    scrollRestoration: true,
  });
}

export const router = createInteroRouter();

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
