import {
  type OrganizationId,
  type PrincipalId,
  type ProjectAutomationAudit,
  type ProjectAutomationPolicy,
  type ProjectAutomationSignal,
  type ProjectAutomationSignalKind,
  type ProjectId,
  uuidv7,
} from "@intero/domain";
import type { Pool, PoolClient } from "pg";

const DEFAULT_SIGNAL_KINDS = [
  "blocker",
  "dependency_change",
  "spec_review_stale",
  "coordination_unresolved",
  "project_work_risk",
] as const satisfies readonly ProjectAutomationSignalKind[];

interface DetectionCandidate {
  projectId: ProjectId;
  kind: ProjectAutomationSignalKind;
  fingerprint: string;
  sourceRef: string;
  safeContext: string;
  candidateNextSteps: string[];
  preferredParticipantIds: PrincipalId[];
  preferredTargetIds?: PrincipalId[];
}

interface AutomationJobReference {
  schemaVersion: 1;
  organizationId: OrganizationId;
  projectId: ProjectId;
  signalId: string;
}

export interface PortfolioSummaryJobReference {
  schemaVersion: 1;
  organizationId: OrganizationId;
  principalId: PrincipalId;
  operationId: string;
}

export interface ProjectAutomationPortfolioSummary {
  projectId: ProjectId;
  projectName: string;
  openSignalCount: number;
  confirmedSignalCount: number;
  progressFacts: {
    total: number;
    todo: number;
    inProgress: number;
    readyForTest: number;
    done: number;
  };
  risks: Array<{
    sourceRef: string;
    kind: ProjectAutomationSignalKind;
    summary: string;
    updatedAt: string;
  }>;
  decisions: Array<{
    id: string;
    title: string;
    outcome: string;
    sourceSpecRevisionId: string;
    createdAt: string;
  }>;
  interpretation: string;
  freshnessAt: string;
}

export class PostgresAutomationStore {
  constructor(
    private readonly pool: Pool,
    private readonly organizationId: OrganizationId,
  ) {}

  async getPolicy(projectId: ProjectId): Promise<ProjectAutomationPolicy> {
    return this.read(async (client) => {
      const result = await client.query(
        `SELECT * FROM project_automation_policies WHERE project_id=$1`,
        [projectId],
      );
      return result.rows[0]
        ? policyFromRow(result.rows[0])
        : defaultPolicy(projectId);
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async updatePolicy(input: {
    projectId: ProjectId;
    enabled: boolean;
    enabledSignals: ProjectAutomationSignalKind[];
    staleSpecReviewHours: number;
    unresolvedCoordinationHours: number;
    quietUntil?: string;
    actorId: PrincipalId;
  }): Promise<ProjectAutomationPolicy> {
    return this.write(async (client) => {
      const result = await client.query(
        `INSERT INTO project_automation_policies
          (organization_id,project_id,enabled,enabled_signals,
           stale_spec_review_hours,unresolved_coordination_hours,quiet_until,
           updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (project_id) DO UPDATE SET
           enabled=EXCLUDED.enabled,
           enabled_signals=EXCLUDED.enabled_signals,
           stale_spec_review_hours=EXCLUDED.stale_spec_review_hours,
           unresolved_coordination_hours=EXCLUDED.unresolved_coordination_hours,
           quiet_until=EXCLUDED.quiet_until,
           updated_by=EXCLUDED.updated_by,
           updated_at=now()
         RETURNING *`,
        [
          this.organizationId,
          input.projectId,
          input.enabled,
          [...new Set(input.enabledSignals)],
          input.staleSpecReviewHours,
          input.unresolvedCoordinationHours,
          input.quietUntil ?? null,
          input.actorId,
        ],
      );
      if (input.quietUntil) {
        const latest = await client.query(
          `SELECT id FROM project_automation_signals
           WHERE project_id=$1 ORDER BY updated_at DESC LIMIT 1`,
          [input.projectId],
        );
        if (latest.rows[0]) {
          await this.audit(client, {
            projectId: input.projectId,
            signalId: String(latest.rows[0].id),
            action: "quieted",
            actorId: input.actorId,
            detail: `Project automation quiet until ${input.quietUntil}.`,
          });
        }
      }
      return policyFromRow(result.rows[0]);
    });
  }

  async listSignals(projectId: ProjectId): Promise<
    Array<{
      signal: ProjectAutomationSignal;
      audit: ProjectAutomationAudit[];
    }>
  > {
    return this.read(async (client) => {
      const signals = await client.query(
        `SELECT * FROM project_automation_signals
         WHERE project_id=$1 ORDER BY updated_at DESC`,
        [projectId],
      );
      const audit = await client.query(
        `SELECT * FROM project_automation_audit
         WHERE project_id=$1 ORDER BY created_at`,
        [projectId],
      );
      const auditBySignal = new Map<string, ProjectAutomationAudit[]>();
      for (const row of audit.rows) {
        const item = auditFromRow(row);
        const items = auditBySignal.get(item.signalId) ?? [];
        items.push(item);
        auditBySignal.set(item.signalId, items);
      }
      return signals.rows.map((row) => {
        const signal = signalFromRow(row);
        return {
          signal,
          audit: auditBySignal.get(signal.id) ?? [],
        };
      });
    });
  }

  async findSignalByCoordinationThread(
    threadId: string,
  ): Promise<ProjectAutomationSignal | undefined> {
    return this.read(async (client) => {
      const result = await client.query(
        `SELECT * FROM project_automation_signals
         WHERE coordination_thread_id=$1`,
        [threadId],
      );
      return result.rows[0] ? signalFromRow(result.rows[0]) : undefined;
    });
  }

  async summarizeForPrincipal(
    principalId: PrincipalId,
  ): Promise<ProjectAutomationPortfolioSummary[]> {
    return this.read(async (client) => {
      const result = await client.query(
        `WITH accessible_projects AS (
           SELECT p.id,p.name,p.updated_at
           FROM projects p
           WHERE p.organization_id=$1
             AND (
               EXISTS (
                 SELECT 1 FROM memberships m
                 WHERE m.organization_id=p.organization_id
                   AND m.principal_id=$2 AND m.role='admin'
               )
               OR EXISTS (
                 SELECT 1
                 FROM pilot_project_teams ppt
                 JOIN pilot_team_memberships ptm
                   ON ptm.organization_id=ppt.organization_id
                  AND ptm.team_id=ppt.team_id
                 WHERE ppt.project_id=p.id AND ptm.principal_id=$2
               )
             )
         )
         SELECT ap.id,ap.name,
                (
                  SELECT count(*)::integer
                  FROM project_automation_signals s
                  WHERE s.project_id=ap.id AND s.status='opened'
                ) open_count,
                (
                  SELECT count(*)::integer
                  FROM project_automation_signals s
                  WHERE s.project_id=ap.id AND s.status='confirmed'
                ) confirmed_count,
                (
                  SELECT jsonb_build_object(
                    'total',count(*)::integer,
                    'todo',count(*) FILTER (WHERE status='todo')::integer,
                    'inProgress',
                      count(*) FILTER (WHERE status='in_progress')::integer,
                    'readyForTest',
                      count(*) FILTER (WHERE status='ready_for_test')::integer,
                    'done',count(*) FILTER (WHERE status='done')::integer
                  )
                  FROM project_work_items wi
                  WHERE wi.project_id=ap.id AND wi.revoked_at IS NULL
                ) progress_facts,
                COALESCE((
                  SELECT jsonb_agg(
                    jsonb_build_object(
                      'sourceRef',risk.source_ref,
                      'kind',risk.kind,
                      'summary',risk.safe_context,
                      'updatedAt',risk.updated_at
                    )
                    ORDER BY risk.updated_at DESC
                  )
                  FROM (
                    SELECT source_ref,kind,safe_context,updated_at
                    FROM project_automation_signals
                    WHERE project_id=ap.id AND status='opened'
                    ORDER BY updated_at DESC
                    LIMIT 5
                  ) risk
                ),'[]'::jsonb) risks,
                COALESCE((
                  SELECT jsonb_agg(
                    jsonb_build_object(
                      'id',decision.id,
                      'title',decision.title,
                      'outcome',decision.outcome,
                      'sourceSpecRevisionId',
                        decision.source_spec_revision_id,
                      'createdAt',decision.created_at
                    )
                    ORDER BY decision.created_at DESC
                  )
                  FROM (
                    SELECT d.id,d.title,d.outcome,d.source_spec_revision_id,
                           d.created_at
                    FROM decisions d
                    JOIN spec_revisions revision
                      ON revision.id=d.source_spec_revision_id
                    JOIN specs spec ON spec.id=revision.spec_id
                    WHERE spec.project_id=ap.id
                      AND revision.confirmed_at IS NOT NULL
                      AND revision.revoked_at IS NULL
                    ORDER BY d.created_at DESC
                    LIMIT 5
                  ) decision
                ),'[]'::jsonb) decisions,
                GREATEST(
                  ap.updated_at,
                  COALESCE((
                    SELECT max(updated_at)
                    FROM project_automation_signals
                    WHERE project_id=ap.id
                  ),ap.updated_at),
                  COALESCE((
                    SELECT max(updated_at)
                    FROM project_work_items
                    WHERE project_id=ap.id AND revoked_at IS NULL
                  ),ap.updated_at),
                  COALESCE((
                    SELECT max(d.updated_at)
                    FROM decisions d
                    JOIN spec_revisions revision
                      ON revision.id=d.source_spec_revision_id
                    JOIN specs spec ON spec.id=revision.spec_id
                    WHERE spec.project_id=ap.id
                      AND revision.confirmed_at IS NOT NULL
                      AND revision.revoked_at IS NULL
                  ),ap.updated_at)
                ) freshness_at
         FROM accessible_projects ap
         ORDER BY freshness_at DESC,ap.id`,
        [this.organizationId, principalId],
      );
      return result.rows.map((row) => {
        const progress = row.progress_facts as {
          total: number;
          todo: number;
          inProgress: number;
          readyForTest: number;
          done: number;
        };
        const openSignalCount = Number(row.open_count);
        const incomplete = Number(progress.total) - Number(progress.done);
        return {
          projectId: String(row.id) as ProjectId,
          projectName: String(row.name),
          openSignalCount,
          confirmedSignalCount: Number(row.confirmed_count),
          progressFacts: {
            total: Number(progress.total),
            todo: Number(progress.todo),
            inProgress: Number(progress.inProgress),
            readyForTest: Number(progress.readyForTest),
            done: Number(progress.done),
          },
          risks: (
            row.risks as Array<{
              sourceRef: string;
              kind: ProjectAutomationSignalKind;
              summary: string;
              updatedAt: string;
            }>
          ).map((risk) => ({
            ...risk,
            updatedAt: new Date(risk.updatedAt).toISOString(),
          })),
          decisions: (
            row.decisions as Array<{
              id: string;
              title: string;
              outcome: string;
              sourceSpecRevisionId: string;
              createdAt: string;
            }>
          ).map((decision) => ({
            ...decision,
            createdAt: new Date(decision.createdAt).toISOString(),
          })),
          interpretation:
            openSignalCount > 0
              ? `存在 ${openSignalCount} 项待协调风险，需要人类确认。`
              : incomplete > 0
                ? `暂无自动化风险信号；仍有 ${incomplete} 项工作未完成。`
                : "当前事实中没有未完成工作或待协调风险。",
          freshnessAt: new Date(String(row.freshness_at)).toISOString(),
        };
      });
    });
  }

  async requestPortfolioSummary(
    principalId: PrincipalId,
  ): Promise<PortfolioSummaryJobReference | undefined> {
    return this.write(async (client) => {
      const principal = await client.query(
        `SELECT 1
         FROM memberships membership
         JOIN principals principal ON principal.id=membership.principal_id
         WHERE membership.organization_id=$1
           AND membership.principal_id=$2
           AND principal.kind='human'`,
        [this.organizationId, principalId],
      );
      if (!principal.rowCount) {
        throw new Error("portfolio_summary_principal_not_found");
      }
      const sourceFingerprint = await portfolioSourceFingerprint(
        client,
        this.organizationId,
        principalId,
      );
      const operationId = uuidv7();
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO project_automation_summary_jobs
          (id,organization_id,principal_id,source_fingerprint)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (organization_id,principal_id,source_fingerprint)
           WHERE status IN ('pending','processing','completed')
         DO NOTHING
         RETURNING id`,
        [operationId, this.organizationId, principalId, sourceFingerprint],
      );
      if (!inserted.rows[0]) return undefined;
      const payload: PortfolioSummaryJobReference = {
        schemaVersion: 1,
        organizationId: this.organizationId,
        principalId,
        operationId,
      };
      await client.query(
        `INSERT INTO outbox
          (operation_id,organization_id,topic,payload)
         VALUES ($1,$2,'project.automation.summary.enqueue',$3)`,
        [operationId, this.organizationId, payload],
      );
      return payload;
    });
  }

  async requestPortfolioSummaries(): Promise<number> {
    const principals = await this.read(async (client) => {
      const result = await client.query<{ principal_id: PrincipalId }>(
        `SELECT DISTINCT membership.principal_id
         FROM memberships membership
         JOIN principals principal ON principal.id=membership.principal_id
         WHERE membership.organization_id=$1 AND principal.kind='human'
         ORDER BY membership.principal_id`,
        [this.organizationId],
      );
      return result.rows.map((row) => row.principal_id);
    });
    let requested = 0;
    for (const principalId of principals) {
      if (await this.requestPortfolioSummary(principalId)) requested += 1;
    }
    return requested;
  }

  async claimPortfolioSummaryOutbox(limit = 50): Promise<
    Array<{
      operationId: string;
      payload: PortfolioSummaryJobReference;
      attempts: number;
    }>
  > {
    return this.write(async (client) => {
      const result = await client.query(
        `WITH candidates AS (
           SELECT operation_id
           FROM outbox
           WHERE organization_id=$1
             AND topic='project.automation.summary.enqueue'
             AND completed_at IS NULL
             AND available_at <= now()
           ORDER BY available_at,operation_id
           FOR UPDATE SKIP LOCKED
           LIMIT $2
         )
         UPDATE outbox
         SET attempts=outbox.attempts+1,
             available_at=now()+interval '30 seconds'
         FROM candidates
         WHERE outbox.operation_id=candidates.operation_id
         RETURNING outbox.operation_id,outbox.payload,outbox.attempts`,
        [this.organizationId, Math.max(1, Math.min(limit, 100))],
      );
      return result.rows.map((row) => ({
        operationId: String(row.operation_id),
        payload: parsePortfolioSummaryJobReference(
          row.payload,
          this.organizationId,
        ),
        attempts: Number(row.attempts),
      }));
    });
  }

  async markPortfolioSummaryOutboxCompleted(
    operationId: string,
  ): Promise<void> {
    await this.write(async (client) => {
      await client.query(
        `UPDATE outbox SET completed_at=now(),last_error_code=NULL
         WHERE organization_id=$1 AND operation_id=$2
           AND topic='project.automation.summary.enqueue'`,
        [this.organizationId, operationId],
      );
    });
  }

  async markPortfolioSummaryOutboxFailed(
    operationId: string,
    attempts: number,
    errorCode: string,
  ): Promise<void> {
    await this.write(async (client) => {
      const terminal = attempts >= 12;
      await client.query(
        `UPDATE outbox SET
           last_error_code=$3,
           available_at=now()+make_interval(
             secs=>LEAST(300,GREATEST(1,power(2,LEAST($4,8))::integer))
           ),
           completed_at=CASE WHEN $5 THEN now() ELSE NULL END
         WHERE organization_id=$1 AND operation_id=$2
           AND topic='project.automation.summary.enqueue'`,
        [
          this.organizationId,
          operationId,
          (terminal ? `dead_letter:${errorCode}` : errorCode).slice(0, 120),
          attempts,
          terminal,
        ],
      );
      if (terminal) {
        await client.query(
          `UPDATE project_automation_summary_jobs
           SET status='failed',last_error_code=$3,updated_at=now()
           WHERE organization_id=$1 AND id=$2
             AND status<>'completed'`,
          [this.organizationId, operationId, errorCode.slice(0, 120)],
        );
      }
    });
  }

  async generatePortfolioSummary(
    reference: PortfolioSummaryJobReference,
  ): Promise<ProjectAutomationPortfolioSummary[]> {
    if (
      reference.organizationId !== this.organizationId ||
      reference.schemaVersion !== 1
    ) {
      throw new Error("cross_organization_portfolio_summary_job");
    }
    const claimed = await this.write(async (client) => {
      const result = await client.query<{
        principal_id: PrincipalId;
        status: string;
        summary: ProjectAutomationPortfolioSummary[] | null;
      }>(
        `UPDATE project_automation_summary_jobs
         SET status='processing',attempts=attempts+1,
             last_error_code=NULL,updated_at=now()
         WHERE organization_id=$1 AND id=$2
           AND principal_id=$3 AND status IN ('pending','processing')
         RETURNING principal_id,status,summary`,
        [this.organizationId, reference.operationId, reference.principalId],
      );
      if (result.rows[0]) return result.rows[0];
      const existing = await client.query<{
        principal_id: PrincipalId;
        status: string;
        summary: ProjectAutomationPortfolioSummary[] | null;
      }>(
        `SELECT principal_id,status,summary
         FROM project_automation_summary_jobs
         WHERE organization_id=$1 AND id=$2 AND principal_id=$3`,
        [this.organizationId, reference.operationId, reference.principalId],
      );
      return existing.rows[0];
    });
    if (!claimed) throw new Error("portfolio_summary_job_not_found");
    if (claimed.status === "completed" && claimed.summary) {
      return claimed.summary;
    }
    if (claimed.status === "failed") {
      throw new Error("portfolio_summary_job_failed");
    }
    const summary = await this.summarizeForPrincipal(reference.principalId);
    const freshnessAt =
      summary
        .map((item) => item.freshnessAt)
        .sort()
        .at(-1) ?? new Date(0).toISOString();
    await this.write(async (client) => {
      await client.query(
        `UPDATE project_automation_summary_jobs
         SET status='completed',summary=$4,freshness_at=$5,
             completed_at=now(),updated_at=now(),last_error_code=NULL
         WHERE organization_id=$1 AND id=$2 AND principal_id=$3`,
        [
          this.organizationId,
          reference.operationId,
          reference.principalId,
          JSON.stringify(summary),
          freshnessAt,
        ],
      );
    });
    return summary;
  }

  async markPortfolioSummaryJobFailed(
    reference: PortfolioSummaryJobReference,
    attempt: number,
    maxAttempts: number,
    errorCode: string,
  ): Promise<void> {
    await this.write(async (client) => {
      await client.query(
        `UPDATE project_automation_summary_jobs
         SET status=CASE WHEN $5 >= $6 THEN 'failed' ELSE status END,
             attempts=GREATEST(attempts,$5),
             last_error_code=$4,updated_at=now()
         WHERE organization_id=$1 AND id=$2 AND principal_id=$3
           AND status<>'completed'`,
        [
          this.organizationId,
          reference.operationId,
          reference.principalId,
          errorCode.slice(0, 120),
          attempt,
          maxAttempts,
        ],
      );
    });
  }

  async latestPortfolioSummary(
    principalId: PrincipalId,
  ): Promise<ProjectAutomationPortfolioSummary[] | undefined> {
    return this.read(async (client) => {
      const sourceFingerprint = await portfolioSourceFingerprint(
        client,
        this.organizationId,
        principalId,
      );
      const result = await client.query<{
        summary: ProjectAutomationPortfolioSummary[];
      }>(
        `SELECT summary
         FROM project_automation_summary_jobs
         WHERE organization_id=$1 AND principal_id=$2
           AND source_fingerprint=$3
           AND status='completed' AND summary IS NOT NULL
         ORDER BY completed_at DESC,id DESC
         LIMIT 1`,
        [this.organizationId, principalId, sourceFingerprint],
      );
      return result.rows[0]?.summary;
    });
  }

  async detectMeaningfulSignals(
    now = new Date().toISOString(),
  ): Promise<number> {
    return this.write(async (client) => {
      const policies = await client.query(
        `SELECT * FROM project_automation_policies
         WHERE enabled=true AND (quiet_until IS NULL OR quiet_until <= $1)`,
        [now],
      );
      let inserted = 0;
      for (const row of policies.rows) {
        const policy = policyFromRow(row);
        const candidates = await this.candidates(client, policy, now);
        for (const candidate of candidates) {
          if (!policy.enabledSignals.includes(candidate.kind)) continue;
          const participants = await this.resolveParticipants(
            client,
            candidate.projectId,
            candidate.preferredParticipantIds,
          );
          if (participants.length === 0) continue;
          const targets =
            candidate.preferredTargetIds?.filter((id) =>
              participants.includes(id),
            ) ?? [];
          const targetIds =
            targets.length > 0
              ? targets
              : await this.resolveTargets(
                  client,
                  participants,
                  candidate.preferredParticipantIds[0],
                );
          inserted += await this.insertSignal(client, {
            ...candidate,
            participantIds: participants,
            targetIds,
            now,
          });
        }
      }
      return inserted;
    });
  }

  async reconcilePending(limit = 100): Promise<number> {
    return this.write(async (client) => {
      const result = await client.query(
        `INSERT INTO outbox
          (operation_id,organization_id,topic,payload,attempts,available_at)
         SELECT s.id,s.organization_id,'project.automation.enqueue',
                jsonb_build_object(
                  'schemaVersion',1,
                  'organizationId',s.organization_id,
                  'projectId',s.project_id,
                  'signalId',s.id
                ),
                0,now()
         FROM project_automation_signals s
         WHERE s.organization_id=$1
           AND s.status IN ('pending','processing')
           AND NOT EXISTS (
             SELECT 1 FROM outbox o WHERE o.operation_id=s.id
           )
         ORDER BY s.detected_at
         LIMIT $2
         ON CONFLICT (operation_id) DO NOTHING`,
        [this.organizationId, Math.max(1, Math.min(limit, 500))],
      );
      return result.rowCount ?? 0;
    });
  }

  async claimOutbox(limit = 50): Promise<
    Array<{
      operationId: string;
      payload: AutomationJobReference;
      attempts: number;
    }>
  > {
    return this.write(async (client) => {
      const result = await client.query(
        `WITH candidates AS (
           SELECT operation_id
           FROM outbox
           WHERE organization_id=$1
             AND topic='project.automation.enqueue'
             AND completed_at IS NULL
             AND available_at <= now()
           ORDER BY available_at,operation_id
           FOR UPDATE SKIP LOCKED
           LIMIT $2
         )
         UPDATE outbox
         SET attempts=outbox.attempts+1,
             available_at=now()+interval '30 seconds'
         FROM candidates
         WHERE outbox.operation_id=candidates.operation_id
         RETURNING outbox.operation_id,outbox.payload,outbox.attempts`,
        [this.organizationId, Math.max(1, Math.min(limit, 100))],
      );
      return result.rows.map((row) => ({
        operationId: String(row.operation_id),
        payload: parseJobReference(row.payload, this.organizationId),
        attempts: Number(row.attempts),
      }));
    });
  }

  async markOutboxCompleted(operationId: string): Promise<void> {
    await this.write(async (client) => {
      await client.query(
        `UPDATE outbox SET completed_at=now(),last_error_code=NULL
         WHERE organization_id=$1 AND operation_id=$2
           AND topic='project.automation.enqueue'`,
        [this.organizationId, operationId],
      );
    });
  }

  async markOutboxFailed(
    operationId: string,
    attempts: number,
    errorCode: string,
  ): Promise<void> {
    await this.write(async (client) => {
      const terminal = attempts >= 12;
      await client.query(
        `UPDATE outbox SET
           last_error_code=$3,
           available_at=now()+make_interval(
             secs=>LEAST(300,GREATEST(1,power(2,LEAST($4,8))::integer))
           ),
           completed_at=CASE WHEN $5 THEN now() ELSE NULL END
         WHERE organization_id=$1 AND operation_id=$2
           AND topic='project.automation.enqueue'`,
        [
          this.organizationId,
          operationId,
          (terminal ? `dead_letter:${errorCode}` : errorCode).slice(0, 120),
          attempts,
          terminal,
        ],
      );
      if (terminal) {
        await client.query(
          `UPDATE project_automation_signals
           SET status='failed',last_error_code=$3,updated_at=now()
           WHERE organization_id=$1 AND id=$2
             AND status NOT IN ('opened','confirmed','reverted','dismissed')`,
          [this.organizationId, operationId, errorCode.slice(0, 120)],
        );
      }
    });
  }

  async openCoordination(
    signalId: string,
    now = new Date().toISOString(),
  ): Promise<ProjectAutomationSignal> {
    return this.write(async (client) => {
      const claimed = await client.query(
        `UPDATE project_automation_signals
         SET status='processing',updated_at=$3
         WHERE organization_id=$1 AND id=$2 AND status='pending'
         RETURNING *`,
        [this.organizationId, signalId, now],
      );
      const current =
        claimed.rows[0] ??
        (
          await client.query(
            `SELECT * FROM project_automation_signals
             WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
            [this.organizationId, signalId],
          )
        ).rows[0];
      if (!current) throw new Error("automation_signal_not_found");
      const signal = signalFromRow(current);
      if (
        signal.status === "opened" ||
        signal.status === "confirmed" ||
        signal.status === "reverted" ||
        signal.status === "dismissed"
      ) {
        return signal;
      }
      const policy = await client.query(
        `SELECT enabled,quiet_until FROM project_automation_policies
         WHERE project_id=$1`,
        [signal.projectId],
      );
      if (
        !policy.rows[0]?.enabled ||
        (policy.rows[0].quiet_until &&
          new Date(policy.rows[0].quiet_until).getTime() > Date.parse(now))
      ) {
        await client.query(
          `UPDATE project_automation_signals
           SET status='dismissed',processed_at=$3,updated_at=$3
           WHERE organization_id=$1 AND id=$2`,
          [this.organizationId, signal.id, now],
        );
        await this.audit(client, {
          projectId: signal.projectId,
          signalId: signal.id,
          action: "dismissed",
          detail:
            "Automation was disabled or quiet before processing; no coordination was opened.",
        });
        return {
          ...signal,
          status: "dismissed",
          processedAt: now,
          updatedAt: now,
        };
      }

      const workStateId = workStateIdFromSourceRef(signal.sourceRef);
      if (workStateId) {
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          [`intero:pilot:${this.organizationId}`],
        );
      }
      const correlated = workStateId
        ? (
            await client.query<{
              id: string;
              data: Record<string, unknown>;
            }>(
              `SELECT id,data
               FROM pilot_coordination_threads
               WHERE organization_id=$1 AND project_id=$2 AND work_state_id=$3
               FOR UPDATE`,
              [this.organizationId, signal.projectId, workStateId],
            )
          ).rows[0]
        : undefined;
      const correlatedData = correlated?.data ?? {};
      const threadId =
        correlated?.id ?? signal.coordinationThreadId ?? uuidv7();
      const trigger = triggerForKind(signal.kind);
      const thread = {
        ...correlatedData,
        id: threadId,
        projectId: signal.projectId,
        ...(workStateId ? { workStateId } : {}),
        automationSignalId: signal.id,
        automationKind: signal.kind,
        trigger: correlatedData.trigger ?? trigger,
        participantIds: [
          ...new Set([
            ...((correlatedData.participantIds as PrincipalId[] | undefined) ??
              []),
            ...signal.participantIds,
          ]),
        ],
        safeContext:
          typeof correlatedData.safeContext === "string"
            ? correlatedData.safeContext
            : signal.safeContext,
        candidateNextSteps:
          Array.isArray(correlatedData.candidateNextSteps) &&
          correlatedData.candidateNextSteps.length > 0
            ? correlatedData.candidateNextSteps
            : signal.candidateNextSteps,
        status: "open" as const,
        createdAt:
          typeof correlatedData.createdAt === "string"
            ? correlatedData.createdAt
            : signal.detectedAt,
        updatedAt: now,
      };
      if (correlated) {
        await client.query(
          `UPDATE pilot_coordination_threads
           SET automation_signal_id=$4,status='open',data=$5,updated_at=$6
           WHERE id=$1 AND organization_id=$2 AND project_id=$3`,
          [
            threadId,
            this.organizationId,
            signal.projectId,
            signal.id,
            JSON.stringify(thread),
            now,
          ],
        );
      } else {
        await client.query(
          `INSERT INTO pilot_coordination_threads
            (id,organization_id,project_id,work_state_id,automation_signal_id,
             status,data,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,'open',$6,$7,$8)
           ON CONFLICT (automation_signal_id)
             WHERE automation_signal_id IS NOT NULL
           DO UPDATE SET
             work_state_id=COALESCE(
               pilot_coordination_threads.work_state_id,
               EXCLUDED.work_state_id
             ),
             data=EXCLUDED.data,
             status='open',
             updated_at=EXCLUDED.updated_at`,
          [
            threadId,
            this.organizationId,
            signal.projectId,
            workStateId ?? null,
            signal.id,
            JSON.stringify(thread),
            signal.detectedAt,
            now,
          ],
        );
      }
      for (const principalId of thread.participantIds) {
        await client.query(
          `INSERT INTO pilot_coordination_participants
            (organization_id,thread_id,principal_id)
           VALUES ($1,$2,$3)
           ON CONFLICT (thread_id,principal_id) DO NOTHING`,
          [this.organizationId, threadId, principalId],
        );
      }
      await client.query(
        `UPDATE project_automation_signals
         SET status='opened',coordination_thread_id=$3,processed_at=$4,
             updated_at=$4,last_error_code=NULL
         WHERE organization_id=$1 AND id=$2`,
        [this.organizationId, signal.id, threadId, now],
      );

      const targetIds = await this.signalTargets(client, signal.id);
      for (const targetId of targetIds) {
        await client.query(
          `INSERT INTO action_inbox
            (id,organization_id,principal_id,project_id,kind,title,detail,
             source_ref,dedupe_key)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (organization_id,principal_id,dedupe_key)
             WHERE resolved_at IS NULL
           DO NOTHING`,
          [
            uuidv7(),
            this.organizationId,
            targetId,
            signal.projectId,
            inboxKind(signal.kind),
            inboxTitle(signal.kind),
            signal.safeContext,
            `coordination:${threadId}`,
            workStateId
              ? `work-state-coordination:${workStateId}`
              : `automation-signal:${signal.id}`,
          ],
        );
      }
      await this.audit(client, {
        projectId: signal.projectId,
        signalId: signal.id,
        action: "coordination_opened",
        detail: `Opened bounded Project coordination ${threadId}.`,
      });
      const operationId = uuidv7();
      const actorId = signal.participantIds[0]!;
      await client.query(
        `INSERT INTO activity_events
          (organization_id,operation_id,actor_id,aggregate_type,aggregate_id,
           event_type,metadata,occurred_at)
         VALUES ($1,$2,$3,'project_automation_signal',$4,
                 'project.automation.coordination_opened',$5,$6)`,
        [
          this.organizationId,
          operationId,
          actorId,
          signal.id,
          JSON.stringify({
            projectId: signal.projectId,
            signalKind: signal.kind,
            coordinationThreadId: threadId,
          }),
          now,
        ],
      );
      await client.query(
        `INSERT INTO outbox
          (operation_id,organization_id,topic,payload)
         VALUES ($1,$2,'project.automation.coordination_opened',$3)`,
        [
          operationId,
          this.organizationId,
          JSON.stringify({
            schemaVersion: 1,
            projectId: signal.projectId,
            signalId: signal.id,
            coordinationThreadId: threadId,
          }),
        ],
      );
      return {
        ...signal,
        status: "opened",
        coordinationThreadId: threadId,
        processedAt: now,
        updatedAt: now,
      };
    });
  }

  async markConfirmed(input: {
    signalId: string;
    actorId: PrincipalId;
    now: string;
  }): Promise<ProjectAutomationSignal> {
    return this.transition(input, "confirmed");
  }

  async revert(input: {
    projectId: ProjectId;
    signalId: string;
    actorId: PrincipalId;
    now: string;
  }): Promise<ProjectAutomationSignal> {
    return this.write(async (client) => {
      const result = await client.query(
        `UPDATE project_automation_signals
         SET status='reverted',updated_at=$3
         WHERE organization_id=$1 AND id=$2
           AND project_id=$4
           AND status IN ('opened','confirmed')
         RETURNING *`,
        [this.organizationId, input.signalId, input.now, input.projectId],
      );
      if (!result.rows[0]) throw new Error("automation_signal_not_revertible");
      const signal = signalFromRow(result.rows[0]);
      if (signal.coordinationThreadId) {
        await client.query(
          `UPDATE pilot_coordination_threads
           SET status='resolved',
               data=data || jsonb_build_object(
                 'status','resolved',
                 'automationRevertedAt',$3::timestamptz::text,
                 'updatedAt',$3::timestamptz::text
               ),
               updated_at=$3::timestamptz
           WHERE organization_id=$1 AND id=$2`,
          [this.organizationId, signal.coordinationThreadId, input.now],
        );
      }
      await client.query(
        `UPDATE action_inbox SET
           resolved_at=$3,read_at=COALESCE(read_at,$3),updated_at=$3
         WHERE organization_id=$1
           AND dedupe_key=$2 AND resolved_at IS NULL`,
        [this.organizationId, `automation-signal:${signal.id}`, input.now],
      );
      await this.audit(client, {
        projectId: signal.projectId,
        signalId: signal.id,
        action: "reverted",
        actorId: input.actorId,
        detail:
          "Human reverted the automation effect. Source work and decisions were not changed.",
      });
      await this.notifyWorkspaceChange(client, {
        projectId: signal.projectId,
        signalId: signal.id,
        eventType: "project.automation.reverted",
      });
      return signal;
    });
  }

  private async transition(
    input: { signalId: string; actorId: PrincipalId; now: string },
    status: "confirmed",
  ): Promise<ProjectAutomationSignal> {
    return this.write(async (client) => {
      const result = await client.query(
        `UPDATE project_automation_signals
         SET status=$3,updated_at=$4
         WHERE organization_id=$1 AND id=$2
           AND status IN ('opened','confirmed')
         RETURNING *`,
        [this.organizationId, input.signalId, status, input.now],
      );
      if (!result.rows[0]) throw new Error("automation_signal_not_found");
      const signal = signalFromRow(result.rows[0]);
      await client.query(
        `UPDATE action_inbox SET
           resolved_at=$3,read_at=COALESCE(read_at,$3),updated_at=$3
         WHERE organization_id=$1
           AND dedupe_key=$2 AND resolved_at IS NULL`,
        [this.organizationId, `automation-signal:${signal.id}`, input.now],
      );
      await this.audit(client, {
        projectId: signal.projectId,
        signalId: signal.id,
        action: "confirmed",
        actorId: input.actorId,
        detail:
          "Responsible participant confirmed the bounded coordination conclusion.",
      });
      return signal;
    });
  }

  private async insertSignal(
    client: PoolClient,
    input: DetectionCandidate & {
      participantIds: PrincipalId[];
      targetIds: PrincipalId[];
      now: string;
    },
  ): Promise<number> {
    const id = uuidv7();
    const result = await client.query(
      `INSERT INTO project_automation_signals
        (id,organization_id,project_id,kind,status,fingerprint,source_ref,
         safe_context,candidate_next_steps,participant_ids,target_ids,detected_at)
       VALUES ($1,$2,$3,$4,'pending',$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (organization_id,project_id,fingerprint) DO NOTHING
       RETURNING id`,
      [
        id,
        this.organizationId,
        input.projectId,
        input.kind,
        input.fingerprint,
        input.sourceRef,
        input.safeContext.slice(0, 600),
        JSON.stringify(input.candidateNextSteps.slice(0, 3)),
        input.participantIds,
        input.targetIds,
        input.now,
      ],
    );
    if (!result.rows[0]) return 0;
    await this.audit(client, {
      projectId: input.projectId,
      signalId: id,
      action: "detected",
      detail: `${input.kind} detected from ${input.sourceRef}.`,
    });
    await client.query(
      `INSERT INTO outbox
        (operation_id,organization_id,topic,payload,attempts,available_at)
       VALUES ($1,$2,'project.automation.enqueue',$3,0,$4)`,
      [
        id,
        this.organizationId,
        JSON.stringify({
          schemaVersion: 1,
          organizationId: this.organizationId,
          projectId: input.projectId,
          signalId: id,
        }),
        input.now,
      ],
    );
    return 1;
  }

  private async candidates(
    client: PoolClient,
    policy: ProjectAutomationPolicy,
    now: string,
  ): Promise<DetectionCandidate[]> {
    const candidates: DetectionCandidate[] = [];
    const checkpointRows = await client.query(
      `SELECT j.id,j.work_state_id,w.owner_id,j.data
       FROM pilot_stand_in_jobs j
       JOIN pilot_work_states w ON w.id=j.work_state_id
       WHERE j.project_id=$1
         AND j.status IN ('pending','retrying','published','private')
         AND j.data#>>'{checkpoint,eventType}' IN (
           'blocker_raised','dependency_declared','review_requested',
           'coordination_requested'
         )`,
      [policy.projectId],
    );
    for (const row of checkpointRows.rows) {
      const eventType = String(row.data.checkpoint.eventType);
      const kind =
        eventType === "blocker_raised"
          ? "blocker"
          : eventType === "dependency_declared"
            ? "dependency_change"
            : eventType === "review_requested"
              ? "spec_review_stale"
              : "coordination_unresolved";
      const narrative = row.data.checkpoint.narrative as {
        currentFocus?: string;
        nextStep?: string;
        collaboration?: {
          targetPrincipalId?: string;
        };
      };
      const targetPrincipalId = narrative.collaboration?.targetPrincipalId as
        PrincipalId | undefined;
      candidates.push({
        projectId: policy.projectId,
        kind,
        fingerprint: `checkpoint:${row.id}`,
        sourceRef: `work-state:${row.work_state_id}`,
        safeContext:
          narrative.currentFocus ??
          "Structured Agent signal needs coordination.",
        candidateNextSteps: [
          narrative.nextStep ||
            "Confirm the responsible participant and next step.",
        ],
        preferredParticipantIds: [
          String(row.owner_id) as PrincipalId,
          ...(targetPrincipalId ? [targetPrincipalId] : []),
        ],
        ...(targetPrincipalId
          ? { preferredTargetIds: [targetPrincipalId] }
          : {}),
      });
    }

    const relationRows = await client.query(
      `SELECT r.source_id,r.target_id,r.kind,
              source.title AS source_title,target.title AS target_title,
              source.owner_id AS source_owner_id,
              target.owner_id AS target_owner_id
       FROM project_work_relations r
       JOIN project_work_items source ON source.id=r.source_id
       JOIN project_work_items target ON target.id=r.target_id
       WHERE source.project_id=$1 AND target.project_id=$1
         AND r.kind IN ('blocks','blocked_by')
         AND source.revoked_at IS NULL AND target.revoked_at IS NULL
         AND (source.status <> 'done' OR target.status <> 'done')`,
      [policy.projectId],
    );
    for (const row of relationRows.rows) {
      candidates.push({
        projectId: policy.projectId,
        kind: "dependency_change",
        fingerprint: `relation:${row.source_id}:${row.target_id}:${row.kind}`,
        sourceRef: `work-relation:${row.source_id}:${row.target_id}`,
        safeContext: `“${row.source_title}”与“${row.target_title}”之间存在尚未解除的阻塞关系。`,
        candidateNextSteps: [
          "确认依赖的负责人与解除条件。",
          "由负责参与者确认是否需要调整实现顺序。",
        ],
        preferredParticipantIds: [row.source_owner_id, row.target_owner_id]
          .filter(Boolean)
          .map((id) => String(id) as PrincipalId),
      });
    }

    const staleSpecs = await client.query(
      `SELECT s.id,s.title,s.current_revision_id,r.created_by,
              array_remove(array_agg(DISTINCT n.reviewer_id),NULL) reviewers
       FROM specs s
       JOIN spec_revisions r ON r.id=s.current_revision_id
       LEFT JOIN project_spec_reviewer_nominations n
         ON n.revision_id=s.current_revision_id
       WHERE s.project_id=$1 AND s.status='in_review'
         AND s.updated_at <= $2::timestamptz
           - make_interval(hours=>$3)
         AND NOT EXISTS (
           SELECT 1 FROM project_spec_confirmations c
           WHERE c.revision_id=s.current_revision_id
         )
       GROUP BY s.id,s.title,s.current_revision_id,r.created_by`,
      [policy.projectId, now, policy.staleSpecReviewHours],
    );
    for (const row of staleSpecs.rows) {
      const reviewers = (row.reviewers ?? []).map(
        (id: unknown) => String(id) as PrincipalId,
      );
      candidates.push({
        projectId: policy.projectId,
        kind: "spec_review_stale",
        fingerprint: `spec-review:${row.current_revision_id}`,
        sourceRef: `spec:${row.id}`,
        safeContext: `Spec“${row.title}”的当前版本仍在等待确认。`,
        candidateNextSteps: [
          "由已指定评审人查看当前完整版本并给出确认或评论。",
          "若范围仍不清楚，在 Coordination 中列出待确认问题。",
        ],
        preferredParticipantIds: [
          String(row.created_by) as PrincipalId,
          ...reviewers,
        ],
        preferredTargetIds: reviewers,
      });
    }

    const unresolved = await client.query(
      `SELECT id,data
       FROM pilot_coordination_threads
       WHERE project_id=$1 AND status IN ('open','needs_confirmation')
         AND automation_signal_id IS NULL
         AND updated_at <= $2::timestamptz
           - make_interval(hours=>$3)`,
      [policy.projectId, now, policy.unresolvedCoordinationHours],
    );
    for (const row of unresolved.rows) {
      candidates.push({
        projectId: policy.projectId,
        kind: "coordination_unresolved",
        fingerprint: `coordination:${row.id}:${row.data.status}`,
        sourceRef: `coordination:${row.id}`,
        safeContext: `Coordination“${row.data.safeContext}”仍未得到负责参与者确认。`,
        candidateNextSteps: [
          "确认当前阻塞点和负责参与者。",
          "由负责参与者确认或明确拒绝候选结论。",
        ],
        preferredParticipantIds: (row.data.participantIds ?? []).map(
          (id: unknown) => String(id) as PrincipalId,
        ),
      });
    }

    const riskItems = await client.query(
      `SELECT id,title,owner_id,carryover,status
       FROM project_work_items
       WHERE project_id=$1 AND revoked_at IS NULL AND status <> 'done'
         AND carryover=true`,
      [policy.projectId],
    );
    for (const row of riskItems.rows) {
      candidates.push({
        projectId: policy.projectId,
        kind: "project_work_risk",
        fingerprint: `carryover:${row.id}`,
        sourceRef: `work-item:${row.id}`,
        safeContext: `延续工作“${row.title}”仍处于 ${row.status}，需要确认当前风险和后续安排。`,
        candidateNextSteps: [
          "确认该延续工作的当前阻塞或验收条件。",
          "由负责人确认下一步；自动化不会改变优先级或负责人。",
        ],
        preferredParticipantIds: row.owner_id
          ? [String(row.owner_id) as PrincipalId]
          : [],
      });
    }
    return candidates;
  }

  private async resolveParticipants(
    client: PoolClient,
    projectId: ProjectId,
    preferred: PrincipalId[],
  ): Promise<PrincipalId[]> {
    const result = await client.query(
      `SELECT DISTINCT principal_id FROM (
         SELECT ptm.principal_id
         FROM pilot_project_teams ppt
         JOIN pilot_team_memberships ptm
           ON ptm.organization_id=ppt.organization_id
          AND ptm.team_id=ppt.team_id
         WHERE ppt.project_id=$1 AND ptm.role='leader'
         UNION ALL
         SELECT principal_id FROM memberships
         WHERE organization_id=$2 AND role='admin'
         UNION ALL
         SELECT (data->>'ownerId')::uuid
         FROM pilot_project_settings WHERE project_id=$1
       ) participants
       WHERE principal_id IS NOT NULL
       ORDER BY principal_id`,
      [projectId, this.organizationId],
    );
    return [
      ...new Set([
        ...preferred,
        ...result.rows.map((row) => String(row.principal_id) as PrincipalId),
      ]),
    ].slice(0, 20);
  }

  private async resolveTargets(
    client: PoolClient,
    participants: PrincipalId[],
    source?: PrincipalId,
  ): Promise<PrincipalId[]> {
    const result = await client.query(
      `SELECT p.id
       FROM principals p
       WHERE p.id=ANY($1::uuid[]) AND p.kind='human'
       ORDER BY CASE WHEN p.id=$2 THEN 1 ELSE 0 END,p.id
       LIMIT 3`,
      [participants, source ?? null],
    );
    return result.rows.map((row) => String(row.id) as PrincipalId);
  }

  private async signalTargets(
    client: PoolClient,
    signalId: string,
  ): Promise<PrincipalId[]> {
    const signal = await client.query(
      `SELECT participant_ids,target_ids
       FROM project_automation_signals WHERE id=$1`,
      [signalId],
    );
    const row = signal.rows[0];
    if (!row) return [];
    if (row.target_ids?.length) {
      return row.target_ids.map((id: unknown) => String(id) as PrincipalId);
    }
    return this.resolveTargets(client, row.participant_ids);
  }

  private async audit(
    client: PoolClient,
    input: Omit<ProjectAutomationAudit, "id" | "createdAt">,
  ): Promise<void> {
    await client.query(
      `INSERT INTO project_automation_audit
        (id,organization_id,project_id,signal_id,action,actor_id,detail)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        uuidv7(),
        this.organizationId,
        input.projectId,
        input.signalId,
        input.action,
        input.actorId ?? null,
        input.detail,
      ],
    );
  }

  private async notifyWorkspaceChange(
    client: PoolClient,
    input: {
      projectId: ProjectId;
      signalId: string;
      eventType: string;
    },
  ): Promise<void> {
    const operationId = uuidv7();
    await client.query(
      `INSERT INTO outbox (operation_id,organization_id,topic,payload)
       VALUES ($1,$2,$3,$4)`,
      [
        operationId,
        this.organizationId,
        `project.${input.projectId}.phase7`,
        JSON.stringify({
          eventType: input.eventType,
          aggregateType: "project_automation_signal",
          aggregateId: input.signalId,
          projectId: input.projectId,
        }),
      ],
    );
  }

  private async read<T>(operation: (client: PoolClient) => Promise<T>) {
    return this.transaction("READ ONLY", operation);
  }

  private async write<T>(operation: (client: PoolClient) => Promise<T>) {
    return this.transaction("", operation);
  }

  private async transaction<T>(
    mode: "READ ONLY" | "",
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query(`BEGIN${mode ? ` ${mode}` : ""}`);
      await client.query(
        "SELECT set_config('intero.organization_id',$1,true)",
        [this.organizationId],
      );
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

function defaultPolicy(projectId: ProjectId): ProjectAutomationPolicy {
  return {
    projectId,
    enabled: false,
    enabledSignals: [...DEFAULT_SIGNAL_KINDS],
    staleSpecReviewHours: 48,
    unresolvedCoordinationHours: 24,
    updatedAt: new Date(0).toISOString(),
  };
}

function policyFromRow(row: Record<string, unknown>): ProjectAutomationPolicy {
  return {
    projectId: String(row.project_id) as ProjectId,
    enabled: Boolean(row.enabled),
    enabledSignals: (row.enabled_signals ??
      DEFAULT_SIGNAL_KINDS) as ProjectAutomationSignalKind[],
    staleSpecReviewHours: Number(row.stale_spec_review_hours),
    unresolvedCoordinationHours: Number(row.unresolved_coordination_hours),
    ...(row.quiet_until
      ? { quietUntil: new Date(String(row.quiet_until)).toISOString() }
      : {}),
    ...(row.updated_by
      ? { updatedBy: String(row.updated_by) as PrincipalId }
      : {}),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

function signalFromRow(row: Record<string, unknown>): ProjectAutomationSignal {
  return {
    id: String(row.id),
    projectId: String(row.project_id) as ProjectId,
    kind: String(row.kind) as ProjectAutomationSignalKind,
    status: String(row.status) as ProjectAutomationSignal["status"],
    sourceRef: String(row.source_ref),
    safeContext: String(row.safe_context),
    candidateNextSteps: Array.isArray(row.candidate_next_steps)
      ? row.candidate_next_steps.map(String)
      : [],
    participantIds: Array.isArray(row.participant_ids)
      ? row.participant_ids.map((id) => String(id) as PrincipalId)
      : [],
    ...(row.coordination_thread_id
      ? { coordinationThreadId: String(row.coordination_thread_id) }
      : {}),
    detectedAt: new Date(String(row.detected_at)).toISOString(),
    ...(row.processed_at
      ? { processedAt: new Date(String(row.processed_at)).toISOString() }
      : {}),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

function auditFromRow(row: Record<string, unknown>): ProjectAutomationAudit {
  return {
    id: String(row.id),
    projectId: String(row.project_id) as ProjectId,
    signalId: String(row.signal_id),
    action: String(row.action) as ProjectAutomationAudit["action"],
    ...(row.actor_id ? { actorId: String(row.actor_id) as PrincipalId } : {}),
    detail: String(row.detail),
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

function parseJobReference(
  value: unknown,
  organizationId: OrganizationId,
): AutomationJobReference {
  const input = value as Partial<AutomationJobReference>;
  if (
    input?.schemaVersion !== 1 ||
    input.organizationId !== organizationId ||
    typeof input.projectId !== "string" ||
    typeof input.signalId !== "string"
  ) {
    throw new Error("invalid_automation_job_reference");
  }
  return input as AutomationJobReference;
}

function parsePortfolioSummaryJobReference(
  value: unknown,
  organizationId: OrganizationId,
): PortfolioSummaryJobReference {
  const input = value as Partial<PortfolioSummaryJobReference>;
  if (
    input?.schemaVersion !== 1 ||
    input.organizationId !== organizationId ||
    typeof input.principalId !== "string" ||
    typeof input.operationId !== "string"
  ) {
    throw new Error("invalid_portfolio_summary_job_reference");
  }
  return input as PortfolioSummaryJobReference;
}

async function portfolioSourceFingerprint(
  client: PoolClient,
  organizationId: OrganizationId,
  principalId: PrincipalId,
): Promise<string> {
  const result = await client.query<{ fingerprint: string }>(
    `WITH accessible_projects AS (
       SELECT project.id,project.updated_at
       FROM projects project
       WHERE project.organization_id=$1
         AND (
           EXISTS (
             SELECT 1 FROM memberships membership
             WHERE membership.organization_id=project.organization_id
               AND membership.principal_id=$2
               AND membership.role='admin'
           )
           OR EXISTS (
             SELECT 1
             FROM pilot_project_teams project_team
             JOIN pilot_team_memberships team_membership
               ON team_membership.organization_id=project_team.organization_id
              AND team_membership.team_id=project_team.team_id
             WHERE project_team.project_id=project.id
               AND team_membership.principal_id=$2
           )
         )
     )
     SELECT md5(
       COALESCE(
         string_agg(
           concat_ws(
             ':',
             project.id::text,
             project.updated_at::text,
             (
               SELECT count(*)::text
               FROM project_work_items item
               WHERE item.project_id=project.id
                 AND item.revoked_at IS NULL
             ),
             COALESCE((
               SELECT max(item.updated_at)::text
               FROM project_work_items item
               WHERE item.project_id=project.id
                 AND item.revoked_at IS NULL
             ),''),
             (
               SELECT count(*)::text
               FROM project_automation_signals signal
               WHERE signal.project_id=project.id
             ),
             COALESCE((
               SELECT max(signal.updated_at)::text
               FROM project_automation_signals signal
               WHERE signal.project_id=project.id
             ),''),
             (
               SELECT count(*)::text
               FROM decisions decision
               JOIN spec_revisions revision
                 ON revision.id=decision.source_spec_revision_id
               JOIN specs spec ON spec.id=revision.spec_id
               WHERE spec.project_id=project.id
                 AND revision.confirmed_at IS NOT NULL
                 AND revision.revoked_at IS NULL
             ),
             COALESCE((
               SELECT max(decision.updated_at)::text
               FROM decisions decision
               JOIN spec_revisions revision
                 ON revision.id=decision.source_spec_revision_id
               JOIN specs spec ON spec.id=revision.spec_id
               WHERE spec.project_id=project.id
                 AND revision.confirmed_at IS NOT NULL
                 AND revision.revoked_at IS NULL
             ),'')
           ),
           '|' ORDER BY project.id
         ),
         'no-visible-projects'
       )
     ) AS fingerprint
     FROM accessible_projects project`,
    [organizationId, principalId],
  );
  return result.rows[0]!.fingerprint;
}

function workStateIdFromSourceRef(sourceRef: string): string | undefined {
  const match = /^work-state:([0-9a-f-]{36})$/i.exec(sourceRef);
  return match?.[1];
}

function triggerForKind(kind: ProjectAutomationSignalKind) {
  if (kind === "blocker") return "blocker_raised" as const;
  if (kind === "dependency_change") return "dependency_declared" as const;
  if (kind === "spec_review_stale") return "review_requested" as const;
  return "coordination_requested" as const;
}

function inboxKind(
  kind: ProjectAutomationSignalKind,
): "human_decision" | "review_request" | "imminent_blocker" {
  if (kind === "spec_review_stale") return "review_request";
  if (kind === "blocker" || kind === "project_work_risk") {
    return "imminent_blocker";
  }
  return "human_decision";
}

function inboxTitle(kind: ProjectAutomationSignalKind): string {
  if (kind === "spec_review_stale") return "有一项 Spec 评审仍待确认";
  if (kind === "blocker") return "项目阻塞需要协调";
  if (kind === "dependency_change") return "依赖关系变化需要确认";
  if (kind === "coordination_unresolved") return "协调事项仍未形成确认";
  return "项目工作风险需要确认";
}
