export type WorkerRuntimeMode = "development" | "product";

export function isListenAddressInUse(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "EADDRINUSE"
  );
}

export function metricsPortConflictDecision(
  runtimeMode: WorkerRuntimeMode,
): "rethrow" | "warn" {
  return runtimeMode === "product" ? "rethrow" : "warn";
}
