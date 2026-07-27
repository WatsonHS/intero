import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { deviceAuthorization, jwt, oneTimeToken } from "better-auth/plugins";
import { randomBytes } from "node:crypto";
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
    oneTimeToken({
      expiresIn: 10,
      disableClientRequest: true,
      disableSetSessionCookie: true,
      storeToken: "hashed",
      generateToken: async () => `ott_${randomBytes(32).toString("base64url")}`,
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
