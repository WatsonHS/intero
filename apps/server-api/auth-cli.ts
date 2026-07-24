import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { deviceAuthorization, magicLink } from "better-auth/plugins";
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
  plugins: [
    magicLink({
      storeToken: "hashed",
      sendMagicLink: async () => undefined,
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
