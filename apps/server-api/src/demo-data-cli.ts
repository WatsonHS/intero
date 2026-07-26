import { requireDemoTarget, resetDemoData, seedDemoData } from "./demo-data.js";

const command = process.argv[2] ?? "seed";
if (!["seed", "reset", "reset-and-seed"].includes(command)) {
  throw new Error("Usage: demo-data-cli.ts <seed|reset|reset-and-seed>");
}

const target = requireDemoTarget({
  ...(process.env.DATABASE_URL
    ? { databaseUrl: process.env.DATABASE_URL }
    : {}),
  ...(process.env.INTERO_DEMO_CONFIRM
    ? { confirmation: process.env.INTERO_DEMO_CONFIRM }
    : {}),
  ...(process.env.NODE_ENV ? { nodeEnv: process.env.NODE_ENV } : {}),
  ...(process.env.INTERO_DEMO_DATA
    ? { demoEnabled: process.env.INTERO_DEMO_DATA }
    : {}),
});

process.stdout.write(
  `${JSON.stringify({
    command,
    target: {
      host: target.host,
      port: target.port,
      database: target.databaseName,
    },
  })}\n`,
);

if (command === "reset" || command === "reset-and-seed") {
  process.stdout.write(
    `${JSON.stringify(
      await resetDemoData(target, {
        ...(process.env.INTERO_DEMO_DESTROY_PROVIDER_CONFIG
          ? {
              providerDestructionConfirmation:
                process.env.INTERO_DEMO_DESTROY_PROVIDER_CONFIG,
            }
          : {}),
      }),
    )}\n`,
  );
}
if (command === "seed" || command === "reset-and-seed") {
  const providerEncryptionKey = process.env.INTERO_PROVIDER_ENCRYPTION_KEY;
  if (!providerEncryptionKey) {
    throw new Error(
      "INTERO_PROVIDER_ENCRYPTION_KEY is required to persist the Demo provider placeholder safely.",
    );
  }
  process.stdout.write(
    `${JSON.stringify(
      await seedDemoData({
        target,
        providerEncryptionKey,
        ...(process.env.INTERO_PUBLIC_URL
          ? { publicUrl: process.env.INTERO_PUBLIC_URL }
          : {}),
      }),
    )}\n`,
  );
}
