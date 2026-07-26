export interface AuthorizationPort {
  check(input: {
    principalId: string;
    permission: string;
    resourceType: string;
    resourceId: string;
    consistencyToken?: string;
  }): Promise<{ allowed: boolean; consistencyToken?: string }>;
}

export type DependencyReadinessStatus =
  "ready" | "degraded" | "unavailable" | "disabled";

export interface DependencyReadinessResult {
  name: string;
  status: DependencyReadinessStatus;
  critical: boolean;
  detail?: string;
}

export interface ReadinessDependency {
  name: string;
  critical: boolean;
  check(): Promise<Omit<DependencyReadinessResult, "name" | "critical">>;
}

export interface ServiceReadiness {
  status: "ready" | "degraded" | "unavailable";
  dependencies: DependencyReadinessResult[];
}

export async function evaluateReadiness(
  dependencies: ReadinessDependency[],
): Promise<ServiceReadiness> {
  const results = await Promise.all(
    dependencies.map(async (dependency): Promise<DependencyReadinessResult> => {
      try {
        return {
          name: dependency.name,
          critical: dependency.critical,
          ...(await dependency.check()),
        };
      } catch {
        return {
          name: dependency.name,
          critical: dependency.critical,
          status: "unavailable",
          detail: "dependency_check_failed",
        };
      }
    }),
  );
  const criticalUnavailable = results.some(
    (result) => result.critical && result.status === "unavailable",
  );
  if (criticalUnavailable) {
    return { status: "unavailable", dependencies: results };
  }
  const degraded = results.some(
    (result) => result.status === "degraded" || result.status === "unavailable",
  );
  return {
    status: degraded ? "degraded" : "ready",
    dependencies: results,
  };
}

export interface QueuePort {
  publish(
    topic: string,
    payload: Record<string, unknown>,
    operationId: string,
  ): Promise<void>;
}

export interface RealtimePort {
  publish(channel: string, event: Record<string, unknown>): Promise<void>;
}

export interface ObjectStorePort {
  createUpload(input: {
    objectId: string;
    purpose: "artifact" | "authorized_raw";
    checksumSha256: string;
    byteSize: number;
    contentType: string;
    encrypted: boolean;
  }): Promise<{
    object: {
      objectId: string;
      objectKey: string;
      state: string;
      expiresAt: string;
    };
    uploadUrl: string;
    expiresAt: string;
    requiredHeaders: Record<string, string>;
  }>;
  completeUpload(objectId: string): Promise<{ state: string }>;
  markScanned(
    objectId: string,
    result: "clean" | "infected" | "failed",
  ): Promise<{ state: string }>;
  cleanup(now?: Date): Promise<number>;
  checkReadiness(): Promise<{
    status: "ready" | "unavailable";
    detail?: string;
  }>;
}

export interface JobEnvelope<Payload = unknown> {
  id: string;
  kind: string;
  idempotencyKey: string;
  payload: Payload;
}

export type JobDispatchResult =
  | { status: "completed" }
  | { status: "queued" }
  | { status: "failed"; errorCode: string };

export interface JobRunnerPort<Job extends JobEnvelope<unknown> = JobEnvelope> {
  dispatch(job: Job): Promise<JobDispatchResult>;
}

export class FailClosedAuthorization implements AuthorizationPort {
  async check(): Promise<{ allowed: boolean }> {
    return { allowed: false };
  }
}
