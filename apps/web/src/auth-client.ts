import { passkeyClient } from "@better-auth/passkey/client";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { createAuthClient } from "better-auth/react";

import { PILOT_API_URL } from "./pilot/api.js";

export const authClient = createAuthClient({
  baseURL: PILOT_API_URL,
  fetchOptions: { credentials: "include" },
  plugins: [passkeyClient(), oauthProviderClient()],
});
