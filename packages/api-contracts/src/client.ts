import createClient from "openapi-fetch";

import type { paths } from "../generated/openapi.js";

export function createInteroApiClient(baseUrl: string) {
  return createClient<paths>({ baseUrl });
}

export type InteroApiClient = ReturnType<typeof createInteroApiClient>;
