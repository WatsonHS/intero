import {
  type CanonicalWorkEvent,
  type Claim,
  type PublicWorkProjection,
  type Workstream,
  uuidv7,
} from "@intero/domain";
import {
  type RepresentativePorts,
  processCanonicalEvent,
} from "@intero/representative-core";

export type ModelEgressMode = "managed_api" | "user_provided_api" | "disabled";

export class LocalRepresentativeRuntime implements RepresentativePorts {
  readonly workstreams = new Map<Workstream["id"], Workstream>();
  readonly claims = new Map<Workstream["id"], Claim[]>();
  readonly projections: PublicWorkProjection[] = [];
  readonly processed = new Set<string>();

  constructor(
    readonly modelEgressMode: ModelEgressMode,
    readonly principalId = "019b5ac0-7600-7000-8000-000000000002" as Workstream["ownerId"],
  ) {}

  async handle(event: CanonicalWorkEvent) {
    if (event.workstreamId && !this.workstreams.has(event.workstreamId)) {
      await this.saveWorkstream({
        id: event.workstreamId,
        workspaceId: event.workspaceId,
        ownerId: this.principalId,
        title: event.payload.summary?.slice(0, 160) || "Coding Agent work",
        phase: "planning",
        scope: [],
        blockers: [],
        dependencies: [],
        decisions: [],
        artifactIds: [],
        freshnessAt: event.occurredAt,
        confidence: 0.5,
        evidenceClaimIds: [],
        contradictionClaimIds: [],
        version: 0,
      });
    }
    return processCanonicalEvent(event, this);
  }

  async loadWorkstream(id: Workstream["id"]): Promise<Workstream> {
    const value = this.workstreams.get(id);
    if (!value) throw new Error("Workstream was not found.");
    return value;
  }

  async loadClaims(id: Workstream["id"]): Promise<Claim[]> {
    return this.claims.get(id) ?? [];
  }

  async eventToClaim(
    event: CanonicalWorkEvent,
    workstream: Workstream,
  ): Promise<Claim | undefined> {
    const kind = event.payload.checkpointKind;
    if (!kind && event.type !== "ValidationChanged") return undefined;
    const predicate: Claim["predicate"] =
      kind === "intent"
        ? "intent"
        : kind === "decision"
          ? "decision"
          : kind === "blocker"
            ? "blocker"
            : kind === "dependency"
              ? "dependency"
              : kind === "scope"
                ? "scope"
                : kind === "artifact"
                  ? "artifact"
                  : kind === "pause"
                    ? "paused"
                    : kind === "completion"
                      ? "completed"
                      : "validation";
    return {
      id: uuidv7() as Claim["id"],
      workstreamId: workstream.id,
      predicate,
      value:
        predicate === "paused" || predicate === "completed"
          ? "true"
          : (event.payload.summary ??
            event.payload.validationStatus ??
            event.type),
      sourceType:
        event.type === "CheckpointReported"
          ? "coding_agent_report"
          : "direct_observation",
      sourceRef: `${event.source}:${event.id}`,
      observedAt: event.occurredAt,
      confidence: event.type === "CheckpointReported" ? 0.74 : 0.92,
      privacy: event.privacy,
      evidenceRefs: [event.id],
    };
  }

  async saveClaim(claim: Claim): Promise<void> {
    this.claims.set(claim.workstreamId, [
      ...(this.claims.get(claim.workstreamId) ?? []),
      claim,
    ]);
  }

  async saveWorkstream(workstream: Workstream): Promise<void> {
    this.workstreams.set(workstream.id, workstream);
  }

  async publishProjection(projection: PublicWorkProjection): Promise<void> {
    this.projections.push(projection);
  }

  async markProcessed(idempotencyKey: string): Promise<boolean> {
    if (this.processed.has(idempotencyKey)) return false;
    this.processed.add(idempotencyKey);
    return true;
  }
}
