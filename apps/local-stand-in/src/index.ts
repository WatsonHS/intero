import { createInterface } from "node:readline";

import { CanonicalWorkEvent, type PrincipalId } from "@intero/domain";

import { LocalStandInRuntime } from "./runtime.js";
import { runSidecar } from "./sidecar.js";

const mode = parseMode(process.env.INTERO_MODEL_EGRESS);
const runtime = process.env.INTERO_PRINCIPAL_ID
  ? new LocalStandInRuntime(
      mode,
      process.env.INTERO_PRINCIPAL_ID as PrincipalId,
    )
  : new LocalStandInRuntime(mode);

if (process.env.INTERO_LOCAL_REP_MODE === "sidecar") {
  await runSidecar(runtime);
} else {
  const input = createInterface({ input: process.stdin, terminal: false });
  for await (const line of input) {
    let parsed: ReturnType<typeof CanonicalWorkEvent.safeParse>;
    try {
      parsed = CanonicalWorkEvent.safeParse(JSON.parse(line));
    } catch {
      process.stdout.write(
        `${JSON.stringify({ ok: false, error: "invalid_json" })}\n`,
      );
      continue;
    }
    if (!parsed.success) {
      process.stdout.write(
        `${JSON.stringify({ ok: false, error: "invalid_event" })}\n`,
      );
      continue;
    }
    try {
      const result = await runtime.handle(parsed.data);
      process.stdout.write(
        `${JSON.stringify({
          ok: true,
          duplicate: result.duplicate,
          workstreamId: result.workstream.id,
          projection: result.projection ?? null,
          modelUsed: false,
        })}\n`,
      );
    } catch (error) {
      process.stdout.write(
        `${JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : "unknown_error",
        })}\n`,
      );
    }
  }
}

function parseMode(value: string | undefined) {
  if (value === "managed_api" || value === "user_provided_api") return value;
  return "disabled";
}
