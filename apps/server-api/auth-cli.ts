import { passkey } from "@better-auth/passkey";
import { oauthProvider } from "@better-auth/oauth-provider";
import { betterAuth } from "better-auth";
import { deviceAuthorization, jwt } from "better-auth/plugins";
import { Pool } from "pg";

/**
 * Schema-generation entrypoint for the Better Auth CLI. Runtime delivery and
 * provider secrets remain in src/auth.ts; this file contains no live sender.
 */
export const auth = betterAuth({
  baseURL: "http://localhost:4310",
  secret: "intero-schema-generation-secret-at-least-32-bytes",
  database: new Pool({
    connectionString:
      process.env.DATABASE_URL ??
      "postgresql://intero:intero@localhost:5432/intero",
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
  },
  plugins: [
    jwt({
      disableSettingJwtHeader: true,
      jwt: {
        issuer: "http://localhost:4310/api/auth",
      },
    }),
    oauthProvider({
      loginPage: "/",
      consentPage: "/oauth/consent",
      validAudiences: ["http://localhost:4310/v1/pilot/mcp"],
      silenceWarnings: {
        oauthAuthServerConfig: true,
        openidConfig: true,
      },
      scopes: ["openid", "offline_access", "intero:mcp"],
      grantTypes: ["authorization_code", "refresh_token"],
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      clientRegistrationDefaultScopes: [
        "openid",
        "offline_access",
        "intero:mcp",
      ],
      clientRegistrationAllowedScopes: [
        "openid",
        "offline_access",
        "intero:mcp",
      ],
    }),
    passkey({
      rpID: "localhost",
      rpName: "Intero",
      origin: "http://localhost:4310",
    }),
    deviceAuthorization({
      verificationUri: "http://localhost:4310/device",
      validateClient: (clientId) => clientId.startsWith("intero-desktop:"),
    }),
  ],
});
