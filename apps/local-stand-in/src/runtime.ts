import {
  type CanonicalWorkEvent,
  type Claim,
  type PublicWorkProjection,
  type Workstream,
  uuidv7,
} from "@intero/domain";
import {
  type StandInPorts,
  buildPublicProjection,
  processCanonicalEvent,
} from "@intero/stand-in-core";

export type ModelEgressMode = "managed_api" | "user_provided_api" | "disabled";

export class LocalStandInRuntime implements StandInPorts {
  readonly workstreams = new Map<Workstream["id"], Workstream>();
  readonly claims = new Map<Workstream["id"], Claim[]>();
  readonly projections: PublicWorkProjection[] = [];
  readonly processed = new Set<string>();

  constructor(
    public modelEgressMode: ModelEgressMode,
    readonly principalId = "019b5ac0-7600-7000-8000-000000000002" as Workstream["ownerId"],
  ) {}

  setModelEgressMode(mode: ModelEgressMode): void {
    this.modelEgressMode = mode;
  }

  async handle(event: CanonicalWorkEvent) {
    const isNew =
      event.workstreamId !== undefined &&
      !this.workstreams.has(event.workstreamId);
    if (event.workstreamId && isNew) {
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
    const result = await processCanonicalEvent(event, this);
    if (isNew && !result.projection) {
      const projection = buildPublicProjection(undefined, result.workstream);
      if (projection) {
        await this.publishProjection(projection);
        return { ...result, projection };
      }
    }
    return result;
  }

  async loadWorkstream(id: Workstream["id"]): Promise<Workstream> {
    const value = this.workstreams.get(id);
    if (!value) throw new Error("Workstream was not found.");
    return value;
  }

  async loadClaims(id: Workstream["id"]): Promise<Claim[]> {
    return this.claims.get(id) ?? [];
  }

  async eventToClaims(
    event: CanonicalWorkEvent,
    workstream: Workstream,
  ): Promise<Claim[]> {
    const kind = event.payload.checkpointKind;
    const claims: Claim[] = [];
    const pauses =
      kind === "pause" ||
      event.type === "SessionPaused" ||
      event.type === "SessionStopped";
    const resumes =
      event.type === "SessionStarted" ||
      (workstream.phase === "paused" && !pauses);
    if (pauses || resumes) {
      claims.push(
        this.claimFor(
          event,
          workstream,
          "paused",
          pauses ? "true" : "false",
          "direct_observation",
        ),
      );
    }
    if (!kind || kind === "pause") {
      if (event.type === "ValidationChanged") {
        claims.push(
          this.claimFor(
            event,
            workstream,
            "validation",
            event.payload.summary ??
              event.payload.validationStatus ??
              event.type,
          ),
        );
      }
      return claims;
    }
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
                  : kind === "completion"
                    ? "completed"
                    : "validation";
    claims.push(
      this.claimFor(
        event,
        workstream,
        predicate,
        predicate === "completed"
          ? "true"
          : (event.payload.summary ??
              event.payload.validationStatus ??
              event.type),
      ),
    );
    return claims;
  }

  private claimFor(
    event: CanonicalWorkEvent,
    workstream: Workstream,
    predicate: Claim["predicate"],
    value: string,
    sourceType: Claim["sourceType"] = event.type === "CheckpointReported"
      ? "coding_agent_report"
      : "direct_observation",
  ): Claim {
    return {
      id: uuidv7() as Claim["id"],
      workstreamId: workstream.id,
      predicate,
      value,
      sourceType,
      sourceRef: `${event.source}:${event.id}`,
      observedAt: event.occurredAt,
      confidence: sourceType === "coding_agent_report" ? 0.74 : 0.92,
      privacy: event.privacy,
      evidenceRefs: [event.id],
    };
  }

  async saveClaim(claim: Claim): Promise<void> {
    const existing = this.claims.get(claim.workstreamId) ?? [];
    const superseded =
      claim.predicate === "paused"
        ? existing.map((candidate) =>
            candidate.predicate === "paused" &&
            candidate.withdrawnAt === undefined
              ? { ...candidate, withdrawnAt: claim.observedAt }
              : candidate,
          )
        : existing;
    this.claims.set(claim.workstreamId, [...superseded, claim]);
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
