export const PILOT_IDENTITY_STORAGE_KEY = "intero.pilot.identity.v1";
export const PILOT_PROJECT_STORAGE_KEY = "intero.pilot.project.v1";
export const PILOT_TEAM_STORAGE_KEY = "intero.pilot.team.v1";
export const AUTHENTICATION_REQUIRED_EVENT = "intero:authentication-required";

type ScopeStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;
type AuthenticationEventTarget = Pick<EventTarget, "dispatchEvent">;

export interface AuthenticationFailureEnvironment {
  storage?: ScopeStorage;
  eventTarget?: AuthenticationEventTarget;
}

export function clearStoredPilotScope(storage: ScopeStorage): void {
  storage.removeItem(PILOT_IDENTITY_STORAGE_KEY);
  storage.removeItem(PILOT_PROJECT_STORAGE_KEY);
  storage.removeItem(PILOT_TEAM_STORAGE_KEY);
}

export function storedDevelopmentIdentityId(
  storage: Pick<Storage, "getItem">,
): string | undefined {
  return storage.getItem(PILOT_IDENTITY_STORAGE_KEY) ?? undefined;
}

export function handleAuthenticationFailure(
  status: number,
  environment: AuthenticationFailureEnvironment = {},
): boolean {
  if (status !== 401) return false;

  const storage =
    environment.storage ??
    (typeof window === "undefined" ? undefined : window.localStorage);
  if (storage) clearStoredPilotScope(storage);

  const eventTarget =
    environment.eventTarget ??
    (typeof window === "undefined" ? undefined : window);
  eventTarget?.dispatchEvent(new Event(AUTHENTICATION_REQUIRED_EVENT));
  return true;
}

export type AuthenticationSurface = "application" | "loading" | "login";

export function resolveAuthenticationSurface(input: {
  pilotEnabled: boolean;
  bootstrapPending: boolean;
  authMode: "session" | "development_identity" | "unavailable" | undefined;
  effectiveIdentityId: string | undefined;
  authenticationRequired: boolean;
}): AuthenticationSurface {
  if (!input.pilotEnabled) return "application";
  if (input.bootstrapPending || !input.authMode) return "loading";
  if (input.effectiveIdentityId && !input.authenticationRequired) {
    return "application";
  }
  return "login";
}

export function developmentIdentityToolEnabled(input: {
  developmentBuild: boolean;
  locationHref: string;
  authenticationRequired: boolean;
}): boolean {
  if (!input.developmentBuild || input.authenticationRequired) return false;
  return (
    new URL(input.locationHref).searchParams.get("interoDevIdentity") === "1"
  );
}
