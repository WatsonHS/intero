import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/database/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url:
      process.env.INTERO_DATABASE_URL ??
      "postgres://intero:intero@localhost:5432/intero",
  },
  strict: true,
  verbose: true,
});
