import type {
  MessageId,
  OrganizationId,
  PilotStandInSource,
  PrincipalId,
  ProjectId,
  ThreadId,
} from "@intero/domain";
import { personalStandInId } from "@intero/domain";
import type { WorkerUtils } from "graphile-worker";
import { Pool, type PoolClient } from "pg";

import type { ModelGateway } from "../../server-api/src/pilot-ports.js";
import type { PilotStore } from "../../server-api/src/pilot-store.js";
import type { PlatformStore } from "../../server-api/src/platform-store.js";

export const PILOT_STAND_IN_QUESTION_TASK = "pilot_stand_in_question";
export const PILOT_STAND_IN_QUESTION_DISPATCH_TASK =
  "pilot_stand_in_question_dispatch";

export interface StandInQuestionReference {
  schemaVersion: 1;
  organizationId: OrganizationId;
  jobId: string;
  projectId: ProjectId;
}

interface StandInQuestionJob {
  id: string;
  threadId: ThreadId;
  projectId: ProjectId;
  standInOwnerId: PrincipalId;
  askedByPrincipalId: PrincipalId;
  questionMessageId: MessageId;
  answerMessageId: MessageId;
  question: string;
}

interface ClaimedPublication {
  operationId: string;
  reference: StandInQuestionReference;
  attempts: number;
}

export class PostgresStandInQuestionRepository {
  constructor(
    private readonly pool: Pool,
    private readonly organizationId: OrganizationId,
  ) {}

  async claimOutbox(limit = 50): Promise<ClaimedPublication[]> {
    return this.write(async (client) => {
      const result = await client.query<{
        operation_id: string;
        payload: StandInQuestionReference;
        attempts: number;
      }>(
        `WITH candidates AS (
           SELECT operation_id
           FROM outbox
           WHERE topic = 'pilot.stand_in.question.enqueue'
             AND completed_at IS NULL
             AND available_at <= now()
           ORDER BY available_at, operation_id
           FOR UPDATE SKIP LOCKED
           LIMIT $1
         )
         UPDATE outbox o
         SET attempts = o.attempts + 1,
             available_at = now() + interval '30 seconds'
         FROM candidates
         WHERE o.operation_id = candidates.operation_id
         RETURNING o.operation_id, o.payload, o.attempts`,
        [Math.max(1, Math.min(limit, 100))],
      );
      return result.rows.map((row) => ({
        operationId: row.operation_id,
        reference: parseReference(row.payload, this.organizationId),
        attempts: row.attempts,
      }));
    });
  }

  async completeOutbox(operationId: string): Promise<void> {
    await this.write((client) =>
      client.query(
        `UPDATE outbox
         SET completed_at = now(), last_error_code = NULL
         WHERE operation_id = $1
           AND topic = 'pilot.stand_in.question.enqueue'`,
        [operationId],
      ),
    );
  }

  async failOutbox(
    operationId: string,
    attempts: number,
    errorCode: string,
  ): Promise<void> {
    await this.write((client) =>
      client.query(
        `UPDATE outbox
         SET last_error_code = $2,
             available_at = now() + make_interval(
               secs => LEAST(300, GREATEST(1, power(2, LEAST($3, 8))::integer))
             )
         WHERE operation_id = $1
           AND topic = 'pilot.stand_in.question.enqueue'`,
        [operationId, errorCode.slice(0, 120), attempts],
      ),
    );
  }

  async claimJob(
    jobId: string,
    workerId: string,
  ): Promise<
    | { status: "completed" }
    | { status: "busy" }
    | { status: "claimed"; job: StandInQuestionJob }
  > {
    return this.write(async (client) => {
      const claimed = await client.query(
        `UPDATE stand_in_question_jobs
         SET status = 'processing',
             attempts = attempts + 1,
             claimed_by = $2,
             claimed_at = now(),
             updated_at = now()
         WHERE id = $1
           AND (
             status IN ('pending', 'retrying')
             OR (
               status = 'processing'
               AND claimed_at < now() - interval '30 seconds'
             )
           )
         RETURNING id`,
        [jobId, workerId],
      );
      if ((claimed.rowCount ?? 0) === 0) {
        const status = await client.query<{ status: string }>(
          "SELECT status FROM stand_in_question_jobs WHERE id = $1",
          [jobId],
        );
        if (!status.rows[0]) throw new Error("stand_in_question_not_found");
        return status.rows[0].status === "completed"
          ? { status: "completed" }
          : { status: "busy" };
      }
      const result = await client.query<{
        id: string;
        thread_id: ThreadId;
        project_id: ProjectId;
        stand_in_owner_id: PrincipalId;
        asked_by_principal_id: PrincipalId;
        question_message_id: MessageId;
        answer_message_id: MessageId;
        body: string;
      }>(
        `SELECT j.id, j.thread_id, j.project_id, j.stand_in_owner_id,
                j.asked_by_principal_id, j.question_message_id,
                j.answer_message_id, m.body
         FROM stand_in_question_jobs j
         JOIN messages m ON m.id = j.question_message_id
         WHERE j.id = $1`,
        [jobId],
      );
      const row = result.rows[0];
      if (!row?.body) throw new Error("stand_in_question_message_missing");
      return {
        status: "claimed",
        job: {
          id: row.id,
          threadId: row.thread_id,
          projectId: row.project_id,
          standInOwnerId: row.stand_in_owner_id,
          askedByPrincipalId: row.asked_by_principal_id,
          questionMessageId: row.question_message_id,
          answerMessageId: row.answer_message_id,
          question: row.body,
        },
      };
    });
  }

  async completeJob(jobId: string): Promise<void> {
    await this.write((client) =>
      client.query(
        `UPDATE stand_in_question_jobs
         SET status = 'completed',
             completed_at = now(),
             last_error_code = NULL,
             updated_at = now()
         WHERE id = $1`,
        [jobId],
      ),
    );
  }

  async failJob(
    jobId: string,
    errorCode: string,
    terminal: boolean,
  ): Promise<void> {
    await this.write((client) =>
      client.query(
        `UPDATE stand_in_question_jobs
         SET status = CASE WHEN $3 THEN 'failed' ELSE 'retrying' END,
             available_at = now() + make_interval(
               secs => LEAST(300, GREATEST(1, power(2, LEAST(attempts, 8))::integer))
             ),
             last_error_code = $2,
             claimed_by = NULL,
             claimed_at = NULL,
             updated_at = now()
         WHERE id = $1`,
        [jobId, errorCode.slice(0, 120), terminal],
      ),
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async write<T>(
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT set_config('intero.organization_id', $1, true)",
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

export class StandInQuestionOutboxDispatcher {
  constructor(
    private readonly repository: PostgresStandInQuestionRepository,
    private readonly workerUtils: WorkerUtils,
    private readonly organizationId: OrganizationId,
  ) {}

  async dispatch(limit = 50): Promise<number> {
    const publications = await this.repository.claimOutbox(limit);
    let firstError: Error | undefined;
    for (const publication of publications) {
      try {
        await this.workerUtils.addJob(
          PILOT_STAND_IN_QUESTION_TASK,
          publication.reference,
          {
            jobKey: `stand-in-question:${this.organizationId}:${publication.reference.jobId}`,
            jobKeyMode: "unsafe_dedupe",
            queueName: `pilot-project-${publication.reference.projectId}`,
            maxAttempts: 8,
          },
        );
        await this.repository.completeOutbox(publication.operationId);
      } catch (error) {
        const normalized =
          error instanceof Error
            ? error
            : new Error("stand_in_question_enqueue_failed");
        await this.repository.failOutbox(
          publication.operationId,
          publication.attempts,
          normalized.message,
        );
        firstError ??= normalized;
      }
    }
    if (firstError) throw firstError;
    return publications.length;
  }
}

export class StandInQuestionHandler {
  constructor(
    private readonly repository: PostgresStandInQuestionRepository,
    private readonly pilotStore: PilotStore,
    private readonly conversations: PlatformStore,
    private readonly model: ModelGateway,
    private readonly organizationId: OrganizationId,
  ) {}

  async handle(
    reference: StandInQuestionReference,
    execution: {
      workerId: string;
      attempt: number;
      maxAttempts: number;
    },
  ): Promise<void> {
    if (reference.organizationId !== this.organizationId) {
      throw new Error("cross_organization_stand_in_question");
    }
    const claimed = await this.repository.claimJob(
      reference.jobId,
      execution.workerId,
    );
    if (claimed.status === "completed") return;
    if (claimed.status === "busy") {
      throw new Error("stand_in_question_already_processing");
    }
    const job = claimed.job;
    try {
      const project = (
        await this.pilotStore.listProjects(job.askedByPrincipalId)
      ).find((candidate) => candidate.id === job.projectId);
      if (!project) throw new Error("stand_in_question_project_not_found");
      await this.pilotStore.listStandInExchanges(
        job.projectId,
        job.askedByPrincipalId,
        job.standInOwnerId,
      );
      const pulse = (
        await this.pilotStore.listTeamPulse(
          job.projectId,
          job.askedByPrincipalId,
        )
      ).filter((entry) => entry.ownerId === job.standInOwnerId);
      if (pulse.length === 0) {
        throw new Error("stand_in_question_context_unavailable");
      }
      const answer = await this.model.answerStandInQuestion({
        organizationId: project.organizationId,
        project: {
          id: project.id,
          name: project.name,
          posture: project.posture,
        },
        standInOwnerId: job.standInOwnerId,
        askedByPrincipalId: job.askedByPrincipalId,
        preferredLanguage: "en-US",
        question: job.question,
        sources: pulse,
      });
      const byWorkStateId = new Map(
        pulse.map((source) => [source.workStateId, source]),
      );
      const sources: PilotStandInSource[] = answer.sourceWorkStateIds.map(
        (workStateId) => {
          const source = byWorkStateId.get(workStateId);
          if (!source) throw new Error("stand_in_question_source_invalid");
          return {
            workStateId: source.workStateId,
            title: source.title,
            eventType: source.eventType,
            summary: source.summary,
            narrative: source.narrative,
            freshnessAt: source.freshnessAt,
            provenance: {
              source: source.provenance.source,
              client: source.provenance.client,
              connectionName: source.provenance.connectionName,
              occurredAt: source.provenance.occurredAt,
            },
          };
        },
      );
      const exchange = await this.pilotStore.recordStandInExchange({
        id: job.id,
        questionMessageId: job.questionMessageId,
        answerMessageId: job.answerMessageId,
        projectId: job.projectId,
        standInOwnerId: job.standInOwnerId,
        askedByPrincipalId: job.askedByPrincipalId,
        question: job.question,
        answer: answer.answer,
        structuredAnswer: {
          answer: answer.answer,
          currentStatus: answer.currentStatus,
          completedOutcome: answer.completedOutcome,
          evidence: answer.evidence,
          nextStep: answer.nextStep,
          neededCollaboration: answer.neededCollaboration,
        },
        sources,
        now: new Date().toISOString(),
      });
      await this.conversations.appendMessage(job.threadId, {
        id: job.answerMessageId,
        senderId: personalStandInId(job.standInOwnerId),
        body: exchange.answer,
        createdAt: exchange.createdAt,
      });
      await this.repository.completeJob(job.id);
    } catch (error) {
      const normalized =
        error instanceof Error ? error : new Error("stand_in_question_failed");
      await this.repository.failJob(
        job.id,
        normalized.message,
        execution.attempt >= execution.maxAttempts,
      );
      throw normalized;
    }
  }
}

function parseReference(
  payload: StandInQuestionReference,
  organizationId: OrganizationId,
): StandInQuestionReference {
  if (
    payload?.schemaVersion !== 1 ||
    payload.organizationId !== organizationId ||
    typeof payload.jobId !== "string" ||
    typeof payload.projectId !== "string"
  ) {
    throw new Error("invalid_stand_in_question_reference");
  }
  return payload;
}
