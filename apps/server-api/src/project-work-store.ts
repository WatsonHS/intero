import {
  EpicId,
  FeatureId,
  type Epic,
  Feature,
  type FeatureHistoryEntry,
  type OrganizationId,
  type PrincipalId,
  planningStatus,
  ProgramIncrementId,
  type ProgramIncrement,
  type ProjectId,
  type SpecId,
  type Spec,
  type SpecComment,
  type SpecCommentThread,
  type SpecConfirmation,
  type SpecReviewPolicy,
  type SpecRevision,
  type SpecRevisionId,
  SprintId,
  type Sprint,
  type WorkActor,
  type WorkCodeReference,
  type WorkComment,
  type WorkHistoryEntry,
  WorkItem,
  WorkItemId,
  type WorkRelation,
  uuidv7,
} from "@intero/domain";
import { createSpecRevision } from "@intero/stand-in-core";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

import { PilotStoreError } from "./pilot-store.js";

export interface ProjectWorkSnapshot {
  project: { id: ProjectId; name: string; timezone: string };
  epics: Epic[];
  features: Feature[];
  workItems: WorkItem[];
  relations: WorkRelation[];
  codeReferences: WorkCodeReference[];
  comments: WorkComment[];
  history: WorkHistoryEntry[];
  featureHistory: FeatureHistoryEntry[];
  programIncrements: Array<ProgramIncrement & { status: string }>;
  sprints: Array<Sprint & { status: string }>;
}

export interface ProjectSpecDetail {
  spec: Spec;
  revisions: SpecRevision[];
  commentThreads: Array<SpecCommentThread & { comments: SpecComment[] }>;
  confirmations: SpecConfirmation[];
  nominatedReviewerIds: string[];
  policy: SpecReviewPolicy;
}

export type WorkItemPatch = Partial<
  Pick<
    WorkItem,
    "title" | "description" | "status" | "priority" | "coordinationThreadIds"
  >
> & {
  ownerId?: PrincipalId | null;
  specId?: SpecId | null;
  featureId?: FeatureId | null;
  piId?: ProgramIncrementId | null;
  sprintId?: SprintId | null;
  points?: number | null;
  completionEvidence?: string | null;
  sourceSpecRevisionId?: SpecRevisionId | null;
  sourceReferences?: string[];
  automationPolicyVersion?: string | null;
};

export class PostgresProjectWorkStore {
  constructor(
    private readonly pool: Pool,
    private readonly organizationId: OrganizationId,
  ) {}

  async listProject(projectId: ProjectId): Promise<ProjectWorkSnapshot> {
    return this.read(async (client) => {
      const project = await client.query(
        "SELECT id, name, timezone FROM projects WHERE id = $1",
        [projectId],
      );
      if (!project.rows[0]) throw new Error("Project was not found.");
      const epics = await client.query(
        "SELECT * FROM project_epics WHERE project_id = $1 ORDER BY created_at",
        [projectId],
      );
      const features = await client.query(
        `SELECT * FROM project_features
         WHERE project_id = $1 AND revoked_at IS NULL
         ORDER BY created_at`,
        [projectId],
      );
      const items = await client.query(
        `SELECT * FROM project_work_items
         WHERE project_id = $1 AND revoked_at IS NULL
         ORDER BY updated_at DESC`,
        [projectId],
      );
      const relations = await client.query(
        `SELECT r.* FROM project_work_relations r
         JOIN project_work_items i ON i.id = r.source_id
         JOIN project_work_items target ON target.id = r.target_id
         WHERE i.project_id = $1
           AND i.revoked_at IS NULL AND target.revoked_at IS NULL
           AND r.revoked_at IS NULL
         ORDER BY r.created_at`,
        [projectId],
      );
      const refs = await client.query(
        `SELECT r.* FROM project_work_code_refs r
         JOIN project_work_items i ON i.id = r.work_item_id
         WHERE i.project_id = $1 AND i.revoked_at IS NULL
         ORDER BY r.created_at`,
        [projectId],
      );
      const comments = await client.query(
        `SELECT c.* FROM project_work_comments c
         JOIN project_work_items i ON i.id = c.work_item_id
         WHERE i.project_id = $1 AND i.revoked_at IS NULL
         ORDER BY c.created_at`,
        [projectId],
      );
      const history = await client.query(
        `SELECT * FROM project_work_history
         WHERE project_id = $1 ORDER BY occurred_at`,
        [projectId],
      );
      const featureHistory = await client.query(
        `SELECT * FROM project_feature_history
         WHERE project_id = $1 ORDER BY occurred_at`,
        [projectId],
      );
      const pis = await client.query(
        `SELECT * FROM project_program_increments
         WHERE project_id = $1 ORDER BY number`,
        [projectId],
      );
      const sprints = await client.query(
        `SELECT * FROM project_sprints
         WHERE project_id = $1 ORDER BY start_date`,
        [projectId],
      );
      const timezone = project.rows[0].timezone as string;
      return {
        project: {
          id: project.rows[0].id,
          name: project.rows[0].name,
          timezone,
        },
        epics: epics.rows.map(epicFromRow),
        features: features.rows.map(featureFromRow),
        workItems: items.rows.map(workItemFromRow),
        relations: relations.rows.map(relationFromRow),
        codeReferences: refs.rows.map(codeRefFromRow),
        comments: comments.rows.map(commentFromRow),
        history: history.rows.map(historyFromRow),
        featureHistory: featureHistory.rows.map(featureHistoryFromRow),
        programIncrements: pis.rows.map((row) => {
          const pi = piFromRow(row);
          return {
            ...pi,
            status: planningStatus(
              pi.startDate,
              pi.endDate,
              timezone,
              new Date(),
              pi.closedAt,
            ),
          };
        }),
        sprints: sprints.rows.map((row) => {
          const sprint = sprintFromRow(row);
          return {
            ...sprint,
            status: planningStatus(
              sprint.startDate,
              sprint.endDate,
              timezone,
              new Date(),
              sprint.closedAt,
            ),
          };
        }),
      };
    });
  }

  async createEpic(
    input: Omit<Epic, "id" | "createdAt" | "updatedAt">,
    actor: WorkActor,
  ) {
    const now = new Date().toISOString();
    const epic: Epic = {
      ...input,
      id: EpicId.parse(uuidv7()),
      createdAt: now,
      updatedAt: now,
    };
    return this.write(async (client) => {
      await client.query(
        `INSERT INTO project_epics
         (id, organization_id, project_id, title, description, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$6)`,
        [
          epic.id,
          this.organizationId,
          epic.projectId,
          epic.title,
          epic.description,
          now,
        ],
      );
      await this.record(
        client,
        epic.projectId,
        actor,
        "epic",
        epic.id,
        "project.epic.created",
        epic,
      );
      return epic;
    });
  }

  async updateEpic(
    projectId: ProjectId,
    epicId: string,
    patch: Partial<Pick<Epic, "title" | "description">>,
    actor: WorkActor,
  ): Promise<Epic> {
    return this.write(async (client) => {
      const current = await client.query(
        `SELECT * FROM project_epics
         WHERE id=$1 AND project_id=$2 FOR UPDATE`,
        [epicId, projectId],
      );
      if (!current.rows[0]) throw new Error("Epic was not found.");
      const next: Epic = {
        ...epicFromRow(current.rows[0]),
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      await client.query(
        `UPDATE project_epics
         SET title=$3,description=$4,updated_at=$5
         WHERE id=$1 AND project_id=$2`,
        [epicId, projectId, next.title, next.description, next.updatedAt],
      );
      await this.record(
        client,
        projectId,
        actor,
        "epic",
        epicId,
        "project.epic.updated",
        next,
      );
      return next;
    });
  }

  async recordAutomationAuthorityDenial(
    projectId: ProjectId,
    actor: WorkActor,
    attemptedAction: string,
    detail: string,
  ): Promise<void> {
    await this.write(async (client) => {
      const operationId = uuidv7();
      const payload = {
        projectId,
        attemptedAction,
        detail,
        actorKind: actor.kind,
        actorSource: actor.source,
      };
      await client.query(
        `INSERT INTO activity_events
          (organization_id,operation_id,actor_id,aggregate_type,aggregate_id,
           event_type,metadata)
         VALUES ($1,$2,$3,'automation_authority',$4,
                 'project.automation.authority_denied',$5)`,
        [
          this.organizationId,
          operationId,
          actor.principalId,
          projectId,
          json(payload),
        ],
      );
      await client.query(
        `INSERT INTO outbox (operation_id,organization_id,topic,payload)
         VALUES ($1,$2,$3,$4)`,
        [
          operationId,
          this.organizationId,
          `project.${projectId}.phase7`,
          json({
            eventType: "project.automation.authority_denied",
            ...payload,
          }),
        ],
      );
    });
  }

  async createFeature(
    input: Omit<Feature, "id" | "createdAt" | "updatedAt">,
    actor: WorkActor,
    idempotencyKey?: string,
  ) {
    try {
      assertAgentFeatureMutation(actor, input);
    } catch (error) {
      await this.recordAutomationAuthorityDenial(
        input.projectId,
        actor,
        "feature.create",
        error instanceof Error ? error.message : "Feature authority denied.",
      );
      throw error;
    }
    const now = new Date().toISOString();
    const feature: Feature = {
      ...input,
      id: FeatureId.parse(uuidv7()),
      createdAt: now,
      updatedAt: now,
    };
    return this.write(async (client) => {
      const duplicate = await this.idempotentFeature(
        client,
        input.projectId,
        idempotencyKey,
      );
      if (duplicate) return duplicate;
      await assertHumanOwner(client, feature.ownerId);
      await assertEpic(client, feature.projectId, feature.epicId);
      await assertConfirmedSpecSource(client, {
        projectId: feature.projectId,
        specId: feature.specId,
        sourceSpecRevisionId: feature.sourceSpecRevisionId,
        sourceReferences: feature.sourceReferences,
      });
      await assertPlanning(
        client,
        feature.projectId,
        feature.piId,
        feature.sprintId,
      );
      await client.query(
        `INSERT INTO project_features
         (id,organization_id,project_id,epic_id,spec_id,
          source_spec_revision_id,source_references,automation_policy_version,
          title,description,stage,owner_id,pi_id,sprint_id,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)`,
        [
          feature.id,
          this.organizationId,
          feature.projectId,
          feature.epicId ?? null,
          feature.specId ?? null,
          feature.sourceSpecRevisionId ?? null,
          json(feature.sourceReferences ?? []),
          feature.automationPolicyVersion ?? null,
          feature.title,
          feature.description,
          feature.stage,
          feature.ownerId ?? null,
          feature.piId ?? null,
          feature.sprintId ?? null,
          now,
        ],
      );
      await this.record(
        client,
        feature.projectId,
        actor,
        "feature",
        feature.id,
        "project.feature.created",
        feature,
      );
      await this.featureHistory(
        client,
        feature,
        "created",
        actor,
        idempotencyKey,
      );
      if (feature.sourceSpecRevisionId && !feature.ownerId) {
        await this.createAutomationChoiceAttention(
          client,
          feature.projectId,
          "feature",
          feature.id,
          feature.title,
        );
      }
      await this.rememberResult(client, idempotencyKey, feature.id);
      return feature;
    });
  }

  async updateFeature(
    projectId: ProjectId,
    featureId: string,
    patch: Partial<Pick<Feature, "title" | "description" | "stage">> & {
      epicId?: Epic["id"] | null;
      specId?: SpecId | null;
      sourceSpecRevisionId?: SpecRevisionId | null;
      sourceReferences?: string[];
      automationPolicyVersion?: string | null;
      ownerId?: PrincipalId | null;
      piId?: ProgramIncrementId | null;
      sprintId?: SprintId | null;
    },
    actor: WorkActor,
    idempotencyKey?: string,
  ): Promise<Feature> {
    try {
      assertAgentFeatureMutation(actor, patch);
    } catch (error) {
      await this.recordAutomationAuthorityDenial(
        projectId,
        actor,
        "feature.update",
        error instanceof Error ? error.message : "Feature authority denied.",
      );
      throw error;
    }
    return this.write(async (client) => {
      const duplicate = await this.idempotentFeature(
        client,
        projectId,
        idempotencyKey,
      );
      if (duplicate) return duplicate;
      const current = await client.query(
        `SELECT * FROM project_features
         WHERE id=$1 AND project_id=$2 FOR UPDATE`,
        [featureId, projectId],
      );
      if (!current.rows[0]) throw new Error("Feature was not found.");
      const previous = featureFromRow(current.rows[0]);
      const next: Feature = {
        ...previous,
        ...(patch.title === undefined ? {} : { title: patch.title }),
        ...(patch.description === undefined
          ? {}
          : { description: patch.description }),
        ...(patch.stage === undefined ? {} : { stage: patch.stage }),
        updatedAt: new Date().toISOString(),
      };
      if (patch.epicId === null) delete next.epicId;
      else if (patch.epicId !== undefined) next.epicId = patch.epicId;
      if (patch.specId === null) {
        delete next.specId;
        delete next.sourceSpecRevisionId;
        delete next.sourceReferences;
        delete next.automationPolicyVersion;
      } else if (patch.specId !== undefined) next.specId = patch.specId;
      if (patch.sourceSpecRevisionId === null) {
        delete next.sourceSpecRevisionId;
        delete next.sourceReferences;
        delete next.automationPolicyVersion;
      } else if (patch.sourceSpecRevisionId !== undefined) {
        next.sourceSpecRevisionId = patch.sourceSpecRevisionId;
      }
      if (patch.sourceReferences !== undefined) {
        next.sourceReferences = patch.sourceReferences;
      }
      if (patch.automationPolicyVersion === null) {
        delete next.automationPolicyVersion;
      } else if (patch.automationPolicyVersion !== undefined) {
        next.automationPolicyVersion = patch.automationPolicyVersion;
      }
      if (patch.ownerId === null) delete next.ownerId;
      else if (patch.ownerId !== undefined) next.ownerId = patch.ownerId;
      if (patch.piId === null) delete next.piId;
      else if (patch.piId !== undefined) next.piId = patch.piId;
      if (patch.sprintId === null) delete next.sprintId;
      else if (patch.sprintId !== undefined) next.sprintId = patch.sprintId;
      await assertHumanOwner(client, next.ownerId);
      await assertEpic(client, projectId, next.epicId);
      await assertConfirmedSpecSource(client, {
        projectId,
        specId: next.specId,
        sourceSpecRevisionId: next.sourceSpecRevisionId,
        sourceReferences: next.sourceReferences,
      });
      await assertPlanning(client, projectId, next.piId, next.sprintId);
      await client.query(
        `UPDATE project_features SET
           epic_id=$3,spec_id=$4,source_spec_revision_id=$5,
           source_references=$6,automation_policy_version=$7,
           title=$8,description=$9,stage=$10,owner_id=$11,
           pi_id=$12,sprint_id=$13,updated_at=$14
         WHERE id=$1 AND project_id=$2`,
        [
          featureId,
          projectId,
          next.epicId ?? null,
          next.specId ?? null,
          next.sourceSpecRevisionId ?? null,
          json(next.sourceReferences ?? []),
          next.automationPolicyVersion ?? null,
          next.title,
          next.description,
          next.stage,
          next.ownerId ?? null,
          next.piId ?? null,
          next.sprintId ?? null,
          next.updatedAt,
        ],
      );
      await this.record(
        client,
        projectId,
        actor,
        "feature",
        featureId,
        "project.feature.updated",
        next,
      );
      await this.featureHistory(client, next, "updated", actor, idempotencyKey);
      if (next.sourceSpecRevisionId && !next.ownerId) {
        await this.createAutomationChoiceAttention(
          client,
          projectId,
          "feature",
          next.id,
          next.title,
        );
      } else {
        await this.resolveAutomationChoiceAttention(client, "feature", next.id);
      }
      await this.rememberResult(client, idempotencyKey, featureId);
      return next;
    });
  }

  async revertFeature(
    projectId: ProjectId,
    featureId: FeatureId,
    historyId: string,
    actor: WorkActor,
    idempotencyKey?: string,
  ): Promise<Feature> {
    return this.write(async (client) => {
      const duplicate = await this.idempotentFeature(
        client,
        projectId,
        idempotencyKey,
      );
      if (duplicate) return duplicate;
      const current = await client.query(
        `SELECT * FROM project_features
         WHERE id=$1 AND project_id=$2 AND revoked_at IS NULL
         FOR UPDATE`,
        [featureId, projectId],
      );
      if (!current.rows[0]) throw new Error("Feature was not found.");
      const target = await client.query<{ snapshot: unknown }>(
        `SELECT snapshot FROM project_feature_history
         WHERE id=$1 AND project_id=$2 AND feature_id=$3`,
        [historyId, projectId, featureId],
      );
      if (!target.rows[0]) throw new Error("Feature history was not found.");
      const snapshot = Feature.parse(target.rows[0].snapshot);
      const currentFeature = featureFromRow(current.rows[0]);
      if (
        actor.kind === "agent" &&
        (snapshot.ownerId !== currentFeature.ownerId ||
          (snapshot.stage === "released" &&
            currentFeature.stage !== "released"))
      ) {
        throw new PilotStoreError(
          "AUTOMATION_AUTHORITY_DENIED",
          403,
          "Agent revert cannot change the Feature owner or make a release decision.",
        );
      }
      await assertHumanOwner(client, snapshot.ownerId);
      await assertEpic(client, projectId, snapshot.epicId);
      await assertHistoricallyConfirmedSpecSource(client, {
        projectId,
        specId: snapshot.specId,
        sourceSpecRevisionId: snapshot.sourceSpecRevisionId,
        sourceReferences: snapshot.sourceReferences,
      });
      await assertPlanning(client, projectId, snapshot.piId, snapshot.sprintId);
      const reverted: Feature = {
        ...snapshot,
        id: featureId,
        projectId,
        updatedAt: new Date().toISOString(),
      };
      delete reverted.revokedAt;
      await persistFeature(client, reverted);
      await this.featureHistory(
        client,
        reverted,
        "reverted",
        actor,
        idempotencyKey,
        historyId,
      );
      await this.record(
        client,
        projectId,
        actor,
        "feature",
        featureId,
        "project.feature.reverted",
        { historyId },
      );
      if (reverted.sourceSpecRevisionId && !reverted.ownerId) {
        await this.createAutomationChoiceAttention(
          client,
          projectId,
          "feature",
          reverted.id,
          reverted.title,
        );
      } else {
        await this.resolveAutomationChoiceAttention(
          client,
          "feature",
          reverted.id,
        );
      }
      await this.rememberResult(client, idempotencyKey, featureId);
      return reverted;
    });
  }

  async revokeFeature(
    projectId: ProjectId,
    featureId: FeatureId,
    actor: WorkActor,
  ): Promise<void> {
    await this.write(async (client) => {
      const current = await client.query(
        `SELECT * FROM project_features
         WHERE id=$1 AND project_id=$2 AND revoked_at IS NULL
         FOR UPDATE`,
        [featureId, projectId],
      );
      if (!current.rows[0]) throw new Error("Feature was not found.");
      const feature = featureFromRow(current.rows[0]);
      if (actor.kind === "agent") {
        const created = await client.query<{ actor: WorkActor }>(
          `SELECT actor FROM project_feature_history
           WHERE feature_id=$1 AND action='created'
           ORDER BY occurred_at LIMIT 1`,
          [featureId],
        );
        if (
          created.rows[0]?.actor.kind !== "agent" ||
          created.rows[0].actor.principalId !== actor.principalId
        ) {
          throw new PilotStoreError(
            "AUTOMATION_AUTHORITY_DENIED",
            403,
            "Agent may revoke only a Feature it created.",
          );
        }
      }
      const revokedAt = new Date().toISOString();
      await client.query(
        `UPDATE project_features SET revoked_at=$3,updated_at=$3
         WHERE id=$1 AND project_id=$2`,
        [featureId, projectId, revokedAt],
      );
      await this.featureHistory(
        client,
        { ...feature, revokedAt, updatedAt: revokedAt },
        "revoked",
        actor,
      );
      await this.record(
        client,
        projectId,
        actor,
        "feature",
        featureId,
        "project.feature.revoked",
        { revokedAt },
      );
      await this.resolveAutomationChoiceAttention(client, "feature", featureId);
    });
  }

  async createWorkItem(
    input: Omit<WorkItem, "id" | "createdAt" | "updatedAt" | "createdBy">,
    actor: WorkActor,
    idempotencyKey?: string,
  ): Promise<WorkItem> {
    try {
      assertAgentWorkItemMutation(actor, input, true);
    } catch (error) {
      await this.recordAutomationAuthorityDenial(
        input.projectId,
        actor,
        "work_item.create",
        error instanceof Error ? error.message : "Work authority denied.",
      );
      throw error;
    }
    const now = new Date().toISOString();
    const item: WorkItem = {
      ...input,
      id: WorkItemId.parse(uuidv7()),
      createdBy: actor,
      createdAt: now,
      updatedAt: now,
    };
    return this.write(async (client) => {
      const duplicate = await this.idempotent<WorkItem>(
        client,
        input.projectId,
        idempotencyKey,
      );
      if (duplicate) return duplicate;
      await assertHumanOwner(client, item.ownerId);
      await assertWorkLinks(
        client,
        item.projectId,
        item.featureId,
        item.specId,
      );
      await assertConfirmedSpecSource(client, {
        projectId: item.projectId,
        specId: item.specId,
        sourceSpecRevisionId: item.sourceSpecRevisionId,
        sourceReferences: item.sourceReferences,
      });
      await assertPlanning(client, item.projectId, item.piId, item.sprintId);
      await client.query(
        `INSERT INTO project_work_items
         (id,organization_id,project_id,feature_id,title,description,status,owner_id,spec_id,
          source_spec_revision_id,source_references,automation_policy_version,
          priority,points,pi_id,sprint_id,source_sprint_id,carryover,completion_evidence,
          completed_by,completed_at,coordination_thread_ids,created_by,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$24)`,
        [
          item.id,
          this.organizationId,
          item.projectId,
          item.featureId ?? null,
          item.title,
          item.description,
          item.status,
          item.ownerId ?? null,
          item.specId ?? null,
          item.sourceSpecRevisionId ?? null,
          json(item.sourceReferences ?? []),
          item.automationPolicyVersion ?? null,
          item.priority,
          item.points ?? null,
          item.piId ?? null,
          item.sprintId ?? null,
          item.sourceSprintId ?? null,
          item.carryover,
          item.completionEvidence ?? null,
          item.completedBy ? json(item.completedBy) : null,
          item.completedAt ?? null,
          json(item.coordinationThreadIds),
          json(actor),
          now,
        ],
      );
      await this.history(client, item, "created", actor, idempotencyKey);
      await this.record(
        client,
        item.projectId,
        actor,
        "work_item",
        item.id,
        "project.work_item.created",
        item,
      );
      if (
        item.sourceSpecRevisionId &&
        (!item.ownerId || item.priority === "unset")
      ) {
        await this.createAutomationChoiceAttention(
          client,
          item.projectId,
          "work_item",
          item.id,
          item.title,
        );
      }
      return item;
    });
  }

  async updateWorkItem(
    projectId: ProjectId,
    workItemId: string,
    patch: WorkItemPatch,
    actor: WorkActor,
    idempotencyKey?: string,
    expectedUpdatedAt?: string,
  ): Promise<WorkItem> {
    try {
      assertAgentWorkItemMutation(actor, patch, false);
    } catch (error) {
      await this.recordAutomationAuthorityDenial(
        projectId,
        actor,
        "work_item.update",
        error instanceof Error ? error.message : "Work authority denied.",
      );
      throw error;
    }
    return this.write(async (client) => {
      const duplicate = await this.idempotent<WorkItem>(
        client,
        projectId,
        idempotencyKey,
      );
      if (duplicate) return duplicate;
      const currentResult = await client.query(
        "SELECT * FROM project_work_items WHERE id = $1 AND project_id = $2 FOR UPDATE",
        [workItemId, projectId],
      );
      if (!currentResult.rows[0]) throw new Error("Work Item was not found.");
      const current = workItemFromRow(currentResult.rows[0]);
      if (expectedUpdatedAt && current.updatedAt !== expectedUpdatedAt) {
        throw new PilotStoreError(
          "WORK_ITEM_CONFLICT",
          409,
          "The Work Item changed after this screen loaded. Refresh it before retrying.",
        );
      }
      await assertHumanOwner(client, patch.ownerId ?? undefined);
      const piId =
        patch.piId === null ? undefined : (patch.piId ?? current.piId);
      const sprintId =
        patch.sprintId === null
          ? undefined
          : (patch.sprintId ?? current.sprintId);
      await assertPlanning(client, projectId, piId, sprintId);
      const status = patch.status ?? current.status;
      if (
        status === "done" &&
        current.status !== "ready_for_test" &&
        current.status !== "done"
      ) {
        throw new Error("Only ready_for_test Work Items may move to done.");
      }
      const now = new Date().toISOString();
      const completion =
        status === "done" ? { completedBy: actor, completedAt: now } : {};
      const next = {
        ...current,
        ...patch,
        status,
        ...completion,
        updatedAt: now,
      } as WorkItem;
      if (patch.ownerId === null) delete next.ownerId;
      if (patch.specId === null) {
        delete next.specId;
        delete next.sourceSpecRevisionId;
        delete next.sourceReferences;
        delete next.automationPolicyVersion;
      }
      if (patch.featureId === null) delete next.featureId;
      if (patch.piId === null) delete next.piId;
      if (patch.sprintId === null) delete next.sprintId;
      if (patch.points === null) delete next.points;
      if (patch.completionEvidence === null) delete next.completionEvidence;
      if (patch.sourceSpecRevisionId === null) {
        delete next.sourceSpecRevisionId;
        delete next.sourceReferences;
        delete next.automationPolicyVersion;
      }
      if (patch.sourceReferences !== undefined) {
        next.sourceReferences = patch.sourceReferences;
      }
      if (patch.automationPolicyVersion === null) {
        delete next.automationPolicyVersion;
      }
      if (status !== "done") {
        delete next.completedBy;
        delete next.completedAt;
      }
      await assertWorkLinks(client, projectId, next.featureId, next.specId);
      await assertConfirmedSpecSource(client, {
        projectId,
        specId: next.specId,
        sourceSpecRevisionId: next.sourceSpecRevisionId,
        sourceReferences: next.sourceReferences,
      });
      await client.query(
        `UPDATE project_work_items SET
          title=$3,description=$4,status=$5,owner_id=$6,spec_id=$7,
          source_spec_revision_id=$8,source_references=$9,
          automation_policy_version=$10,priority=$11,points=$12,
          feature_id=$13,pi_id=$14,sprint_id=$15,completion_evidence=$16,
          completed_by=$17,completed_at=$18,coordination_thread_ids=$19,updated_at=$20
         WHERE id=$1 AND project_id=$2`,
        [
          workItemId,
          projectId,
          next.title,
          next.description,
          next.status,
          next.ownerId ?? null,
          next.specId ?? null,
          next.sourceSpecRevisionId ?? null,
          json(next.sourceReferences ?? []),
          next.automationPolicyVersion ?? null,
          next.priority,
          next.points ?? null,
          next.featureId ?? null,
          next.piId ?? null,
          next.sprintId ?? null,
          next.completionEvidence ?? null,
          next.completedBy ? json(next.completedBy) : null,
          next.completedAt ?? null,
          json(next.coordinationThreadIds),
          now,
        ],
      );
      await this.history(client, next, "updated", actor, idempotencyKey);
      await this.record(
        client,
        projectId,
        actor,
        "work_item",
        workItemId,
        "project.work_item.updated",
        next,
      );
      if (
        next.sourceSpecRevisionId &&
        (!next.ownerId || next.priority === "unset")
      ) {
        await this.createAutomationChoiceAttention(
          client,
          projectId,
          "work_item",
          next.id,
          next.title,
        );
      } else {
        await this.resolveAutomationChoiceAttention(
          client,
          "work_item",
          next.id,
        );
      }
      return next;
    });
  }

  async revertWorkItem(
    projectId: ProjectId,
    workItemId: string,
    historyId: string,
    actor: WorkActor,
    idempotencyKey?: string,
  ): Promise<WorkItem> {
    return this.write(async (client) => {
      const duplicate = await this.idempotent<WorkItem>(
        client,
        projectId,
        idempotencyKey,
      );
      if (duplicate) return duplicate;
      const current = await client.query(
        `SELECT * FROM project_work_items
         WHERE id = $1 AND project_id = $2 AND revoked_at IS NULL
         FOR UPDATE`,
        [workItemId, projectId],
      );
      if (!current.rows[0]) throw new Error("Work Item was not found.");
      const target = await client.query<{ snapshot: unknown }>(
        `SELECT snapshot FROM project_work_history
         WHERE id = $1 AND project_id = $2 AND work_item_id = $3`,
        [historyId, projectId, workItemId],
      );
      if (!target.rows[0]) throw new Error("Work Item history was not found.");
      const snapshot = WorkItem.parse(target.rows[0].snapshot);
      const currentItem = workItemFromRow(current.rows[0]);
      if (
        actor.kind === "agent" &&
        (snapshot.ownerId !== currentItem.ownerId ||
          snapshot.priority !== currentItem.priority)
      ) {
        throw new PilotStoreError(
          "AUTOMATION_AUTHORITY_DENIED",
          403,
          "Agent revert cannot change owner or priority.",
        );
      }
      await assertHumanOwner(client, snapshot.ownerId);
      await assertWorkLinks(
        client,
        projectId,
        snapshot.featureId,
        snapshot.specId,
      );
      await assertHistoricallyConfirmedSpecSource(client, {
        projectId,
        specId: snapshot.specId,
        sourceSpecRevisionId: snapshot.sourceSpecRevisionId,
        sourceReferences: snapshot.sourceReferences,
      });
      await assertPlanning(client, projectId, snapshot.piId, snapshot.sprintId);
      const now = new Date().toISOString();
      const reverted: WorkItem = {
        ...snapshot,
        id: WorkItemId.parse(workItemId),
        projectId,
        updatedAt: now,
      };
      delete reverted.revokedAt;
      await persistWorkItem(client, reverted);
      await this.history(
        client,
        reverted,
        "reverted",
        actor,
        idempotencyKey,
        historyId,
      );
      await this.record(
        client,
        projectId,
        actor,
        "work_item",
        workItemId,
        "project.work_item.reverted",
        { historyId },
      );
      if (
        reverted.sourceSpecRevisionId &&
        (!reverted.ownerId || reverted.priority === "unset")
      ) {
        await this.createAutomationChoiceAttention(
          client,
          projectId,
          "work_item",
          reverted.id,
          reverted.title,
        );
      } else {
        await this.resolveAutomationChoiceAttention(
          client,
          "work_item",
          reverted.id,
        );
      }
      return reverted;
    });
  }

  async revokeWorkItem(
    projectId: ProjectId,
    workItemId: string,
    actor: WorkActor,
  ): Promise<void> {
    await this.write(async (client) => {
      const current = await client.query(
        `SELECT * FROM project_work_items
         WHERE id = $1 AND project_id = $2 AND revoked_at IS NULL
         FOR UPDATE`,
        [workItemId, projectId],
      );
      if (!current.rows[0]) throw new Error("Work Item was not found.");
      const item = workItemFromRow(current.rows[0]);
      if (
        actor.kind === "agent" &&
        (item.createdBy.kind !== "agent" ||
          item.createdBy.principalId !== actor.principalId)
      ) {
        throw new PilotStoreError(
          "AUTOMATION_AUTHORITY_DENIED",
          403,
          "Agent may revoke only work it created.",
        );
      }
      const revokedAt = new Date().toISOString();
      await client.query(
        "UPDATE project_work_items SET revoked_at=$3,updated_at=$3 WHERE id=$1 AND project_id=$2",
        [workItemId, projectId, revokedAt],
      );
      await this.history(
        client,
        { ...item, revokedAt, updatedAt: revokedAt },
        "revoked",
        actor,
      );
      await this.record(
        client,
        projectId,
        actor,
        "work_item",
        workItemId,
        "project.work_item.revoked",
        {},
      );
      await this.resolveAutomationChoiceAttention(
        client,
        "work_item",
        workItemId,
      );
    });
  }

  async addRelation(
    projectId: ProjectId,
    relation: WorkRelation,
    idempotencyKey?: string,
  ): Promise<WorkRelation> {
    return this.write(async (client) => {
      const persistedRelation: WorkRelation = {
        ...relation,
        ...(idempotencyKey ? { idempotencyKey } : {}),
      };
      if (idempotencyKey) {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          idempotencyKey,
        ]);
        const known = await client.query(
          "SELECT 1 FROM idempotency_keys WHERE key=$1 AND organization_id=$2",
          [idempotencyKey, this.organizationId],
        );
        if (known.rows[0]) {
          const existing = await client.query(
            `SELECT * FROM project_work_relations
             WHERE source_id=$1 AND target_id=$2 AND kind=$3`,
            [relation.sourceId, relation.targetId, relation.kind],
          );
          if (!existing.rows[0]) {
            throw new Error("idempotency_relation_result_missing");
          }
          return relationFromRow(existing.rows[0]);
        }
      }
      const scopedItems = await client.query<{ id: string }>(
        `SELECT id FROM project_work_items
         WHERE project_id = $1 AND id = ANY($2::uuid[])
           AND revoked_at IS NULL`,
        [projectId, [relation.sourceId, relation.targetId]],
      );
      if (scopedItems.rowCount !== 2) {
        throw new Error("Work Item relation targets must share one Project.");
      }
      await assertConfirmedSpecSource(client, {
        projectId,
        specId: persistedRelation.specId,
        sourceSpecRevisionId: persistedRelation.sourceSpecRevisionId,
        sourceReferences: persistedRelation.sourceReferences,
      });
      const inserted = await client.query(
        `INSERT INTO project_work_relations
         (organization_id,source_id,target_id,kind,spec_id,
          source_spec_revision_id,source_references,automation_policy_version,
          idempotency_key,created_by,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (source_id,target_id,kind) DO UPDATE SET
           spec_id=EXCLUDED.spec_id,
           source_spec_revision_id=EXCLUDED.source_spec_revision_id,
           source_references=EXCLUDED.source_references,
           automation_policy_version=EXCLUDED.automation_policy_version,
           idempotency_key=EXCLUDED.idempotency_key,
           created_by=EXCLUDED.created_by,
           created_at=EXCLUDED.created_at,
           revoked_at=NULL
         WHERE project_work_relations.revoked_at IS NOT NULL
         RETURNING *`,
        [
          this.organizationId,
          persistedRelation.sourceId,
          persistedRelation.targetId,
          persistedRelation.kind,
          persistedRelation.specId ?? null,
          persistedRelation.sourceSpecRevisionId ?? null,
          json(persistedRelation.sourceReferences ?? []),
          persistedRelation.automationPolicyVersion ?? null,
          persistedRelation.idempotencyKey ?? null,
          json(persistedRelation.createdBy),
          persistedRelation.createdAt,
        ],
      );
      const storedRelation = inserted.rows[0]
        ? relationFromRow(inserted.rows[0])
        : relationFromRow(
            (
              await client.query(
                `SELECT * FROM project_work_relations
                 WHERE source_id=$1 AND target_id=$2 AND kind=$3`,
                [
                  persistedRelation.sourceId,
                  persistedRelation.targetId,
                  persistedRelation.kind,
                ],
              )
            ).rows[0],
          );
      if (inserted.rowCount) {
        await this.record(
          client,
          projectId,
          persistedRelation.createdBy,
          "work_relation",
          persistedRelation.sourceId,
          "project.work_relation.created",
          persistedRelation,
        );
      }
      await this.rememberResult(
        client,
        idempotencyKey,
        storedRelation.sourceId,
      );
      return storedRelation;
    });
  }

  async revokeRelation(
    projectId: ProjectId,
    sourceId: WorkItemId,
    targetId: WorkItemId,
    kind: WorkRelation["kind"],
    actor: WorkActor,
  ): Promise<void> {
    await this.write(async (client) => {
      const result = await client.query(
        `SELECT relation.*
         FROM project_work_relations relation
         JOIN project_work_items source ON source.id=relation.source_id
         JOIN project_work_items target ON target.id=relation.target_id
         WHERE relation.source_id=$1 AND relation.target_id=$2
           AND relation.kind=$3 AND relation.revoked_at IS NULL
           AND source.project_id=$4 AND target.project_id=$4
         FOR UPDATE OF relation`,
        [sourceId, targetId, kind, projectId],
      );
      if (!result.rows[0]) throw new Error("Work relation was not found.");
      const relation = relationFromRow(result.rows[0]);
      if (
        actor.kind === "agent" &&
        (relation.createdBy.kind !== "agent" ||
          relation.createdBy.principalId !== actor.principalId)
      ) {
        throw new PilotStoreError(
          "AUTOMATION_AUTHORITY_DENIED",
          403,
          "Agent may revoke only a relation it created.",
        );
      }
      const revokedAt = new Date().toISOString();
      await client.query(
        `UPDATE project_work_relations
         SET revoked_at=$4
         WHERE source_id=$1 AND target_id=$2 AND kind=$3`,
        [sourceId, targetId, kind, revokedAt],
      );
      await this.record(
        client,
        projectId,
        actor,
        "work_relation",
        sourceId,
        "project.work_relation.revoked",
        { targetId, kind, revokedAt },
      );
    });
  }

  async addCodeReference(
    projectId: ProjectId,
    reference: WorkCodeReference,
  ): Promise<WorkCodeReference> {
    return this.write(async (client) => {
      await assertWorkItem(client, reference.workItemId, projectId);
      await client.query(
        `INSERT INTO project_work_code_refs
         (id,organization_id,work_item_id,kind,label,url,repository,value,reported_by,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          reference.id,
          this.organizationId,
          reference.workItemId,
          reference.kind,
          reference.label,
          reference.url ?? null,
          reference.repository ?? null,
          reference.value,
          json(reference.reportedBy),
          reference.createdAt,
        ],
      );
      return reference;
    });
  }

  async removeCodeReference(projectId: ProjectId, id: string): Promise<void> {
    await this.write(async (client) => {
      const result = await client.query(
        `DELETE FROM project_work_code_refs r
         USING project_work_items i
         WHERE r.id = $1 AND r.work_item_id = i.id AND i.project_id = $2`,
        [id, projectId],
      );
      if (!result.rowCount) throw new Error("Code reference was not found.");
    });
  }

  async addWorkComment(
    projectId: ProjectId,
    comment: WorkComment,
    idempotencyKey?: string,
  ): Promise<WorkComment> {
    return this.write(async (client) => {
      if (idempotencyKey) {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          idempotencyKey,
        ]);
        const existing = await client.query(
          `SELECT * FROM project_work_comments
           WHERE organization_id=$1 AND idempotency_key=$2`,
          [this.organizationId, idempotencyKey],
        );
        if (existing.rows[0]) return commentFromRow(existing.rows[0]);
      }
      const persistedComment: WorkComment = {
        ...comment,
        ...(idempotencyKey ? { idempotencyKey } : {}),
      };
      await assertWorkItem(client, comment.workItemId, projectId);
      if (comment.parentId) {
        const parent = await client.query(
          `SELECT 1 FROM project_work_comments
           WHERE id=$1 AND work_item_id=$2`,
          [comment.parentId, comment.workItemId],
        );
        if (!parent.rowCount) {
          throw new Error("Comment replies must stay in one Work Item.");
        }
      }
      await assertConfirmedSpecSource(client, {
        projectId,
        specId: persistedComment.specId,
        sourceSpecRevisionId: persistedComment.sourceSpecRevisionId,
        sourceReferences: persistedComment.sourceReferences,
      });
      await client.query(
        `INSERT INTO project_work_comments
         (id,organization_id,work_item_id,parent_id,body,spec_id,
          source_spec_revision_id,source_references,automation_policy_version,
          idempotency_key,author,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          persistedComment.id,
          this.organizationId,
          persistedComment.workItemId,
          persistedComment.parentId ?? null,
          persistedComment.body,
          persistedComment.specId ?? null,
          persistedComment.sourceSpecRevisionId ?? null,
          json(persistedComment.sourceReferences ?? []),
          persistedComment.automationPolicyVersion ?? null,
          persistedComment.idempotencyKey ?? null,
          json(persistedComment.author),
          persistedComment.createdAt,
        ],
      );
      await this.record(
        client,
        projectId,
        persistedComment.author,
        "work_comment",
        persistedComment.id,
        "project.work_comment.created",
        persistedComment,
      );
      await this.rememberResult(client, idempotencyKey, persistedComment.id);
      return persistedComment;
    });
  }

  async revokeWorkComment(
    projectId: ProjectId,
    workItemId: WorkItemId,
    commentId: WorkComment["id"],
    actor: WorkActor,
  ): Promise<void> {
    await this.write(async (client) => {
      const result = await client.query(
        `SELECT comment.*
         FROM project_work_comments comment
         JOIN project_work_items item ON item.id=comment.work_item_id
         WHERE comment.id=$1 AND comment.work_item_id=$2
           AND item.project_id=$3 AND comment.revoked_at IS NULL
         FOR UPDATE OF comment`,
        [commentId, workItemId, projectId],
      );
      if (!result.rows[0]) throw new Error("Work comment was not found.");
      const comment = commentFromRow(result.rows[0]);
      if (
        actor.kind === "agent" &&
        (comment.author.kind !== "agent" ||
          comment.author.principalId !== actor.principalId)
      ) {
        throw new PilotStoreError(
          "AUTOMATION_AUTHORITY_DENIED",
          403,
          "Agent may revoke only a comment it created.",
        );
      }
      const revokedAt = new Date().toISOString();
      await client.query(
        "UPDATE project_work_comments SET revoked_at=$2 WHERE id=$1",
        [commentId, revokedAt],
      );
      await this.record(
        client,
        projectId,
        actor,
        "work_comment",
        commentId,
        "project.work_comment.revoked",
        { workItemId, revokedAt },
      );
    });
  }

  async createProgramIncrement(
    input: {
      projectId: ProjectId;
      startDate: string;
      sprintCount: number;
      sprintDurationWeeks: number;
      timezone: string;
    },
    actor: WorkActor,
  ): Promise<{ pi: ProgramIncrement; sprints: Sprint[] }> {
    return this.write(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        input.projectId,
      ]);
      const numberResult = await client.query<{ number: number }>(
        "SELECT COALESCE(max(number),0)+1 AS number FROM project_program_increments WHERE project_id=$1",
        [input.projectId],
      );
      const number = Number(numberResult.rows[0]!.number);
      const now = new Date().toISOString();
      const start = parseDate(input.startDate);
      const end = addDays(
        start,
        input.sprintCount * input.sprintDurationWeeks * 7 - 1,
      );
      const pi: ProgramIncrement = {
        id: ProgramIncrementId.parse(uuidv7()),
        projectId: input.projectId,
        number,
        startDate: formatDate(start),
        endDate: formatDate(end),
        timezone: input.timezone,
        createdAt: now,
      };
      await client.query("UPDATE projects SET timezone=$2 WHERE id=$1", [
        input.projectId,
        input.timezone,
      ]);
      await client.query(
        `INSERT INTO project_program_increments
         (id,organization_id,project_id,number,start_date,end_date,timezone,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          pi.id,
          this.organizationId,
          pi.projectId,
          pi.number,
          pi.startDate,
          pi.endDate,
          pi.timezone,
          pi.createdAt,
        ],
      );
      const sprints: Sprint[] = [];
      for (let index = 0; index < input.sprintCount; index += 1) {
        const sprintStart = addDays(
          start,
          index * input.sprintDurationWeeks * 7,
        );
        const sprint: Sprint = {
          id: SprintId.parse(uuidv7()),
          projectId: input.projectId,
          piId: pi.id,
          number: index + 1,
          startDate: formatDate(sprintStart),
          endDate: formatDate(
            addDays(sprintStart, input.sprintDurationWeeks * 7 - 1),
          ),
        };
        await client.query(
          `INSERT INTO project_sprints
           (id,organization_id,project_id,pi_id,number,start_date,end_date)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            sprint.id,
            this.organizationId,
            sprint.projectId,
            sprint.piId,
            sprint.number,
            sprint.startDate,
            sprint.endDate,
          ],
        );
        sprints.push(sprint);
      }
      await this.record(
        client,
        input.projectId,
        actor,
        "program_increment",
        pi.id,
        "project.pi.created",
        { pi, sprints },
      );
      return { pi, sprints };
    });
  }

  async closeSprint(
    projectId: ProjectId,
    sprintId: string,
    actor: WorkActor,
  ): Promise<void> {
    await this.write(async (client) => {
      const now = new Date().toISOString();
      const closed = await client.query(
        `UPDATE project_sprints SET closed_at=$3
         WHERE id=$1 AND project_id=$2 AND closed_at IS NULL RETURNING id`,
        [sprintId, projectId, now],
      );
      if (!closed.rowCount) throw new Error("Sprint was not found.");
      await client.query(
        `UPDATE project_work_items SET
           source_sprint_id=$1, carryover=true, sprint_id=NULL, status='in_progress', updated_at=$3
         WHERE project_id=$2 AND sprint_id=$1 AND status <> 'done'
           AND revoked_at IS NULL`,
        [sprintId, projectId, now],
      );
      await this.record(
        client,
        projectId,
        actor,
        "sprint",
        sprintId,
        "project.sprint.closed",
        { carryover: true },
      );
    });
  }

  async closeProgramIncrement(
    projectId: ProjectId,
    piId: string,
    actor: WorkActor,
  ): Promise<void> {
    await this.write(async (client) => {
      const now = new Date().toISOString();
      const pi = await client.query(
        `UPDATE project_program_increments
         SET closed_at=$3
         WHERE id=$1 AND project_id=$2 AND closed_at IS NULL
         RETURNING id`,
        [piId, projectId, now],
      );
      if (!pi.rowCount) throw new Error("Program Increment was not found.");
      const sprints = await client.query<{ id: string }>(
        `UPDATE project_sprints
         SET closed_at=$3
         WHERE pi_id=$1 AND project_id=$2 AND closed_at IS NULL
         RETURNING id`,
        [piId, projectId, now],
      );
      for (const sprint of sprints.rows) {
        await client.query(
          `UPDATE project_work_items SET
             source_sprint_id=$1,carryover=true,sprint_id=NULL,
             status='in_progress',updated_at=$3
           WHERE project_id=$2 AND sprint_id=$1
             AND status <> 'done' AND revoked_at IS NULL`,
          [sprint.id, projectId, now],
        );
      }
      await this.record(
        client,
        projectId,
        actor,
        "program_increment",
        piId,
        "project.pi.closed",
        { sprintIds: sprints.rows.map((row) => row.id) },
      );
    });
  }

  async listSpecs(projectId: ProjectId): Promise<ProjectSpecDetail[]> {
    return this.read(async (client) => {
      const result = await client.query(
        "SELECT id FROM specs WHERE project_id=$1 ORDER BY created_at DESC",
        [projectId],
      );
      const items: Array<ProjectSpecDetail | undefined> = [];
      for (const row of result.rows) {
        items.push(await this.specDetail(client, row.id));
      }
      return items;
    }).then((items) =>
      items.filter((item): item is ProjectSpecDetail => Boolean(item)),
    );
  }

  async createSpecVersion(input: {
    projectId: ProjectId;
    specId?: string;
    title: string;
    markdown: string;
    changeSummary: string;
    affectedScopes: string[];
    actor: WorkActor;
    idempotencyKey?: string;
  }): Promise<ProjectSpecDetail> {
    return this.write(async (client) => {
      if (input.idempotencyKey) {
        const known = await client.query<{ result_ref: string }>(
          "SELECT result_ref FROM idempotency_keys WHERE key=$1",
          [input.idempotencyKey],
        );
        if (known.rows[0]) {
          const detail = await this.specDetail(
            client,
            known.rows[0].result_ref,
          );
          if (detail) return detail;
        }
      }
      const existing = input.specId
        ? await client.query(
            "SELECT * FROM specs WHERE id=$1 AND project_id=$2 FOR UPDATE",
            [input.specId, input.projectId],
          )
        : undefined;
      const specId = existing?.rows[0]?.id ?? input.specId ?? uuidv7();
      const revisionNumber = existing?.rows[0]
        ? Number(
            (
              await client.query<{ revision: number }>(
                "SELECT max(revision)+1 AS revision FROM spec_revisions WHERE spec_id=$1",
                [specId],
              )
            ).rows[0]!.revision,
          )
        : 1;
      const revision = createSpecRevision({
        specId,
        revision: revisionNumber,
        markdown: input.markdown,
        changeSummary: input.changeSummary,
        affectedScopes: input.affectedScopes,
        createdBy: input.actor.principalId,
      });
      if (!existing?.rows[0]) {
        await client.query(
          `INSERT INTO specs
           (id,organization_id,project_id,title,current_revision_id,related_workstream_ids,status,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,'[]','draft',$6,$6)`,
          [
            specId,
            this.organizationId,
            input.projectId,
            input.title,
            revision.id,
            revision.createdAt,
          ],
        );
      }
      await client.query(
        `INSERT INTO spec_revisions
         (id,organization_id,spec_id,revision,markdown,blocks,change_summary,affected_scopes,created_by,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          revision.id,
          this.organizationId,
          specId,
          revision.revision,
          revision.markdown,
          json(revision.blocks),
          revision.changeSummary,
          json(revision.affectedScopes),
          revision.createdBy,
          revision.createdAt,
        ],
      );
      if (existing?.rows[0]) {
        await client.query(
          `UPDATE specs SET title=$2,current_revision_id=$3,status='draft',
            review_requested_at=NULL,updated_at=$4 WHERE id=$1`,
          [specId, input.title, revision.id, revision.createdAt],
        );
      }
      if (input.idempotencyKey) {
        await client.query(
          `INSERT INTO idempotency_keys (key,organization_id,result_ref,expires_at)
           VALUES ($1,$2,$3,now()+interval '7 days') ON CONFLICT (key) DO NOTHING`,
          [input.idempotencyKey, this.organizationId, specId],
        );
      }
      await this.record(
        client,
        input.projectId,
        input.actor,
        "spec",
        specId,
        "project.spec.version_created",
        { revisionId: revision.id },
      );
      return (await this.specDetail(client, specId))!;
    });
  }

  async revertSpecVersion(input: {
    projectId: ProjectId;
    specId: string;
    revisionId: string;
    actor: WorkActor;
    idempotencyKey?: string;
  }): Promise<ProjectSpecDetail> {
    const detail = (await this.listSpecs(input.projectId)).find(
      (item) => item.spec.id === input.specId,
    );
    const target = detail?.revisions.find(
      (revision) =>
        revision.id === input.revisionId && revision.revokedAt === undefined,
    );
    if (!detail || !target) throw new Error("Spec version was not found.");
    return this.createSpecVersion({
      projectId: input.projectId,
      specId: input.specId,
      title: detail.spec.title,
      markdown: target.markdown,
      changeSummary: `Reverted to version ${target.revision}`,
      affectedScopes: target.affectedScopes,
      actor: input.actor,
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    });
  }

  async revokeSpecVersion(input: {
    projectId: ProjectId;
    specId: string;
    revisionId: string;
    actor: WorkActor;
  }): Promise<ProjectSpecDetail> {
    return this.write(async (client) => {
      const spec = await client.query(
        `SELECT * FROM specs
         WHERE id=$1 AND project_id=$2 FOR UPDATE`,
        [input.specId, input.projectId],
      );
      if (!spec.rows[0]) throw new Error("Spec was not found.");
      if (spec.rows[0].confirmed_revision_id === input.revisionId) {
        throw new Error("A confirmed Spec version cannot be revoked.");
      }
      const revision = await client.query(
        `SELECT revision FROM spec_revisions
         WHERE id=$1 AND spec_id=$2 AND revoked_at IS NULL`,
        [input.revisionId, input.specId],
      );
      if (!revision.rows[0]) throw new Error("Spec version was not found.");
      const replacement = await client.query<{ id: string }>(
        `SELECT id FROM spec_revisions
         WHERE spec_id=$1 AND id<>$2 AND revoked_at IS NULL
         ORDER BY revision DESC LIMIT 1`,
        [input.specId, input.revisionId],
      );
      if (!replacement.rows[0]) {
        throw new Error("The only Spec version cannot be revoked.");
      }
      const now = new Date().toISOString();
      await client.query(
        "UPDATE spec_revisions SET revoked_at=$3 WHERE id=$1 AND spec_id=$2",
        [input.revisionId, input.specId, now],
      );
      if (spec.rows[0].current_revision_id === input.revisionId) {
        await client.query(
          `UPDATE specs SET current_revision_id=$2,status='draft',
            review_requested_at=NULL,updated_at=$3 WHERE id=$1`,
          [input.specId, replacement.rows[0].id, now],
        );
      }
      await this.record(
        client,
        input.projectId,
        input.actor,
        "spec",
        input.specId,
        "project.spec.version_revoked",
        { revisionId: input.revisionId },
      );
      return (await this.specDetail(client, input.specId))!;
    });
  }

  async requestSpecReview(
    projectId: ProjectId,
    specId: string,
    reviewerIds: string[],
    actor: WorkActor,
    idempotencyKey?: string,
  ) {
    return this.write(async (client) => {
      if (idempotencyKey) {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          idempotencyKey,
        ]);
        const known = await client.query(
          "SELECT result_ref FROM idempotency_keys WHERE key=$1 AND organization_id=$2",
          [idempotencyKey, this.organizationId],
        );
        if (known.rows[0]) {
          const detail = await this.specDetail(
            client,
            String(known.rows[0].result_ref),
          );
          if (detail) return detail;
        }
      }
      const spec = await client.query(
        "SELECT current_revision_id, title FROM specs WHERE id=$1 AND project_id=$2",
        [specId, projectId],
      );
      if (!spec.rows[0]) throw new Error("Spec was not found.");
      const now = new Date().toISOString();
      await client.query(
        "UPDATE specs SET status='in_review',review_requested_at=$2,updated_at=$2 WHERE id=$1",
        [specId, now],
      );
      for (const reviewerId of new Set(reviewerIds)) {
        await client.query(
          `INSERT INTO project_spec_reviewer_nominations
           (organization_id,spec_id,revision_id,reviewer_id,created_at)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
          [
            this.organizationId,
            specId,
            spec.rows[0].current_revision_id,
            reviewerId,
            now,
          ],
        );
        await client.query(
          `INSERT INTO action_inbox
            (id,organization_id,principal_id,project_id,kind,title,detail,
             source_ref,dedupe_key)
           VALUES ($1,$2,$3,$4,'review_request',$5,$6,$7,$8)
           ON CONFLICT (organization_id,principal_id,dedupe_key)
             WHERE resolved_at IS NULL
           DO NOTHING`,
          [
            uuidv7(),
            this.organizationId,
            reviewerId,
            projectId,
            `Review requested · ${spec.rows[0].title}`,
            "You were nominated to review the current full Spec version.",
            `spec:${specId}`,
            `spec-review:${spec.rows[0].current_revision_id}:${reviewerId}`,
          ],
        );
      }
      await this.record(
        client,
        projectId,
        actor,
        "spec",
        specId,
        "project.spec.review_requested",
        { reviewerIds },
      );
      await this.rememberResult(client, idempotencyKey, specId);
      return (await this.specDetail(client, specId))!;
    });
  }

  async addSpecComment(input: {
    projectId: ProjectId;
    specId: string;
    revisionId: string;
    threadId?: string;
    parentId?: string;
    lineStart: number;
    lineEnd: number;
    charStart?: number;
    charEnd?: number;
    selection?: string;
    body: string;
    actor: WorkActor;
  }): Promise<ProjectSpecDetail> {
    return this.write(async (client) => {
      const revision = await client.query(
        `SELECT 1 FROM spec_revisions r JOIN specs s ON s.id=r.spec_id
         WHERE r.id=$1 AND r.spec_id=$2 AND s.project_id=$3`,
        [input.revisionId, input.specId, input.projectId],
      );
      if (!revision.rowCount) throw new Error("Spec version was not found.");
      const threadId = input.threadId ?? uuidv7();
      if (!input.threadId) {
        await client.query(
          `INSERT INTO project_spec_comment_threads
           (id,organization_id,spec_id,revision_id,line_start,line_end,
            char_start,char_end,selection)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            threadId,
            this.organizationId,
            input.specId,
            input.revisionId,
            input.lineStart,
            input.lineEnd,
            input.charStart ?? null,
            input.charEnd ?? null,
            input.selection ?? null,
          ],
        );
      } else {
        const thread = await client.query(
          `SELECT 1 FROM project_spec_comment_threads
           WHERE id=$1 AND spec_id=$2 AND revision_id=$3`,
          [input.threadId, input.specId, input.revisionId],
        );
        if (!thread.rowCount) {
          throw new Error("Spec comment replies must stay in one version.");
        }
      }
      if (input.parentId) {
        const parent = await client.query(
          `SELECT 1 FROM project_spec_comments
           WHERE id=$1 AND thread_id=$2`,
          [input.parentId, threadId],
        );
        if (!parent.rowCount) {
          throw new Error("Spec comment replies must stay in one thread.");
        }
      }
      await client.query(
        `INSERT INTO project_spec_comments
         (id,organization_id,thread_id,parent_id,author_id,author_kind,body)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          uuidv7(),
          this.organizationId,
          threadId,
          input.parentId ?? null,
          input.actor.principalId,
          input.actor.kind,
          input.body,
        ],
      );
      return (await this.specDetail(client, input.specId))!;
    });
  }

  async setSpecCommentStatus(input: {
    projectId: ProjectId;
    threadId: string;
    status: "open" | "resolved";
  }) {
    return this.write(async (client) => {
      const result = await client.query(
        `UPDATE project_spec_comment_threads t SET status=$3,resolved_at=CASE WHEN $3='resolved' THEN now() ELSE NULL END
         FROM specs s WHERE t.spec_id=s.id AND t.id=$1 AND s.project_id=$2 RETURNING t.spec_id`,
        [input.threadId, input.projectId, input.status],
      );
      if (!result.rows[0])
        throw new Error("Spec comment thread was not found.");
      return (await this.specDetail(client, result.rows[0].spec_id))!;
    });
  }

  async confirmSpec(
    projectId: ProjectId,
    specId: string,
    actor: WorkActor,
  ): Promise<ProjectSpecDetail> {
    return this.write(async (client) => {
      const detail = await this.specDetail(client, specId);
      if (!detail || detail.spec.projectId !== projectId)
        throw new Error("Spec was not found.");
      const revisionId = detail.spec.currentRevisionId;
      const revision = detail.revisions.find((item) => item.id === revisionId)!;
      if (
        !detail.policy.authorSelfConfirmation &&
        revision.createdBy === actor.principalId
      ) {
        throw new Error("The Spec author cannot confirm this version.");
      }
      if (actor.kind === "agent" && !detail.policy.otherMemberAgentsCount) {
        throw new Error(
          "This Project review policy does not count Agent confirmations.",
        );
      }
      await client.query(
        `INSERT INTO project_spec_confirmations
         (organization_id,spec_id,revision_id,confirmer_id,confirmer_kind)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        [
          this.organizationId,
          specId,
          revisionId,
          actor.principalId,
          actor.kind,
        ],
      );
      await client.query(
        `UPDATE action_inbox
         SET resolved_at=now(), read_at=COALESCE(read_at,now()), updated_at=now()
         WHERE principal_id=$1
           AND dedupe_key=$2
           AND resolved_at IS NULL`,
        [actor.principalId, `spec-review:${revisionId}:${actor.principalId}`],
      );
      const confirmations = await client.query<{ count: string }>(
        "SELECT count(*) FROM project_spec_confirmations WHERE revision_id=$1",
        [revisionId],
      );
      if (
        Number(confirmations.rows[0]!.count) >=
        detail.policy.requiredConfirmations
      ) {
        await client.query(
          "UPDATE specs SET confirmed_revision_id=$2,status='approved',updated_at=now() WHERE id=$1",
          [specId, revisionId],
        );
        await client.query(
          `UPDATE spec_revisions
           SET confirmed_at=COALESCE(confirmed_at,now())
           WHERE id=$1`,
          [revisionId],
        );
      }
      return (await this.specDetail(client, specId))!;
    });
  }

  async updateSpecReviewPolicy(
    projectId: ProjectId,
    input: Pick<
      SpecReviewPolicy,
      | "requiredConfirmations"
      | "otherMemberAgentsCount"
      | "authorSelfConfirmation"
    >,
    actor: WorkActor,
  ): Promise<SpecReviewPolicy> {
    return this.write(async (client) => {
      const updatedAt = new Date().toISOString();
      await client.query(
        `INSERT INTO project_spec_review_policies
         (project_id,organization_id,required_confirmations,
          other_member_agents_count,author_self_confirmation,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (project_id) DO UPDATE SET
           required_confirmations=EXCLUDED.required_confirmations,
           other_member_agents_count=EXCLUDED.other_member_agents_count,
           author_self_confirmation=EXCLUDED.author_self_confirmation,
           updated_at=EXCLUDED.updated_at`,
        [
          projectId,
          this.organizationId,
          input.requiredConfirmations,
          input.otherMemberAgentsCount,
          input.authorSelfConfirmation,
          updatedAt,
        ],
      );
      const policy: SpecReviewPolicy = {
        projectId,
        ...input,
        updatedAt,
      };
      await this.record(
        client,
        projectId,
        actor,
        "spec_review_policy",
        projectId,
        "project.spec.review_policy_updated",
        policy,
      );
      return policy;
    });
  }

  async listConfirmed(
    projectId: ProjectId,
  ): Promise<Array<{ spec: Spec; revision: SpecRevision }>> {
    return this.read(async (client) => {
      const result = await client.query<{ id: string }>(
        `SELECT s.id FROM specs s
         JOIN spec_revisions r ON r.id=s.confirmed_revision_id
         WHERE s.project_id=$1 AND r.revoked_at IS NULL
         ORDER BY s.title`,
        [projectId],
      );
      const items: Array<{ spec: Spec; revision: SpecRevision }> = [];
      for (const row of result.rows) {
        const detail = await this.specDetail(client, row.id);
        const revision = detail?.revisions.find(
          (item) => item.id === detail.spec.confirmedRevisionId,
        );
        if (detail && revision) items.push({ spec: detail.spec, revision });
      }
      return items;
    });
  }

  async getConfirmed(projectId: ProjectId, specId: string) {
    return (await this.listConfirmed(projectId)).find(
      (item) => item.spec.id === specId,
    );
  }

  private async specDetail(
    client: PoolClient,
    specId: string,
  ): Promise<ProjectSpecDetail | undefined> {
    const specResult = await client.query("SELECT * FROM specs WHERE id=$1", [
      specId,
    ]);
    if (!specResult.rows[0]) return undefined;
    const revisions = await client.query(
      "SELECT * FROM spec_revisions WHERE spec_id=$1 ORDER BY revision",
      [specId],
    );
    const threads = await client.query(
      `SELECT * FROM project_spec_comment_threads
       WHERE spec_id=$1 ORDER BY created_at`,
      [specId],
    );
    const comments = await client.query(
      `SELECT c.* FROM project_spec_comments c
       JOIN project_spec_comment_threads t ON t.id=c.thread_id
       WHERE t.spec_id=$1 ORDER BY c.created_at`,
      [specId],
    );
    const confirmations = await client.query(
      `SELECT * FROM project_spec_confirmations
       WHERE spec_id=$1 ORDER BY created_at`,
      [specId],
    );
    const nominations = await client.query(
      `SELECT reviewer_id FROM project_spec_reviewer_nominations
       WHERE spec_id=$1 AND revision_id=$2`,
      [specId, specResult.rows[0].current_revision_id],
    );
    const policy = await client.query(
      "SELECT * FROM project_spec_review_policies WHERE project_id=$1",
      [specResult.rows[0].project_id],
    );
    const defaultPolicy: SpecReviewPolicy = {
      projectId: specResult.rows[0].project_id,
      requiredConfirmations: 1,
      otherMemberAgentsCount: true,
      authorSelfConfirmation: false,
      updatedAt: asIso(specResult.rows[0].updated_at),
    };
    return {
      spec: specFromRow(specResult.rows[0]),
      revisions: revisions.rows.map(revisionFromRow),
      commentThreads: threads.rows.map((row) => ({
        ...specThreadFromRow(row),
        comments: comments.rows
          .filter((comment) => comment.thread_id === row.id)
          .map(specCommentFromRow),
      })),
      confirmations: confirmations.rows.map(confirmationFromRow),
      nominatedReviewerIds: nominations.rows.map((row) => row.reviewer_id),
      policy: policy.rows[0] ? policyFromRow(policy.rows[0]) : defaultPolicy,
    };
  }

  private async idempotent<T>(
    client: PoolClient,
    projectId: ProjectId,
    key?: string,
  ): Promise<T | undefined> {
    if (!key) return undefined;
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [key]);
    const result = await client.query<{ snapshot: T }>(
      `SELECT snapshot FROM project_work_history
       WHERE project_id=$1 AND idempotency_key=$2`,
      [projectId, key],
    );
    return result.rows[0]?.snapshot;
  }

  private async idempotentFeature(
    client: PoolClient,
    projectId: ProjectId,
    key?: string,
  ): Promise<Feature | undefined> {
    if (!key) return undefined;
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [key]);
    const result = await client.query<{ snapshot: unknown }>(
      `SELECT snapshot
       FROM project_feature_history
       WHERE project_id=$1 AND idempotency_key=$2`,
      [projectId, key],
    );
    return result.rows[0] ? Feature.parse(result.rows[0].snapshot) : undefined;
  }

  private async rememberResult(
    client: PoolClient,
    key: string | undefined,
    resultRef: string,
  ): Promise<void> {
    if (!key) return;
    await client.query(
      `INSERT INTO idempotency_keys
        (key,organization_id,result_ref,expires_at)
       VALUES ($1,$2,$3,now()+interval '7 days')
       ON CONFLICT (key) DO NOTHING`,
      [key, this.organizationId, resultRef],
    );
  }

  private async history(
    client: PoolClient,
    item: WorkItem,
    action: string,
    actor: WorkActor,
    key?: string,
    revertedEntryId?: string,
  ) {
    await client.query(
      `INSERT INTO project_work_history
       (id,organization_id,project_id,work_item_id,idempotency_key,action,
        snapshot,actor,reverted_entry_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        uuidv7(),
        this.organizationId,
        item.projectId,
        item.id,
        key ?? null,
        action,
        json(item),
        json(actor),
        revertedEntryId ?? null,
      ],
    );
  }

  private async featureHistory(
    client: PoolClient,
    feature: Feature,
    action: string,
    actor: WorkActor,
    key?: string,
    revertedEntryId?: string,
  ) {
    await client.query(
      `INSERT INTO project_feature_history
       (id,organization_id,project_id,feature_id,idempotency_key,action,
        snapshot,actor,reverted_entry_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        uuidv7(),
        this.organizationId,
        feature.projectId,
        feature.id,
        key ?? null,
        action,
        json(feature),
        json(actor),
        revertedEntryId ?? null,
      ],
    );
  }

  private async createAutomationChoiceAttention(
    client: PoolClient,
    projectId: ProjectId,
    aggregateType: "feature" | "work_item",
    aggregateId: string,
    title: string,
  ): Promise<void> {
    const principals = await client.query<{ principal_id: PrincipalId }>(
      `SELECT DISTINCT principal_id
       FROM (
         SELECT m.principal_id
         FROM memberships m
         WHERE m.organization_id=$1 AND m.role IN ('admin','owner')
         UNION ALL
         SELECT ptm.principal_id
         FROM pilot_project_teams ppt
         JOIN pilot_team_memberships ptm
           ON ptm.organization_id=ppt.organization_id
          AND ptm.team_id=ppt.team_id
         WHERE ppt.project_id=$2 AND ptm.role='leader'
         UNION ALL
         SELECT (settings.data->>'ownerId')::uuid
         FROM pilot_project_settings settings
         WHERE settings.project_id=$2
       ) candidates
       JOIN principals p ON p.id=candidates.principal_id
       WHERE candidates.principal_id IS NOT NULL AND p.kind='human'
       ORDER BY principal_id
       LIMIT 20`,
      [this.organizationId, projectId],
    );
    for (const row of principals.rows) {
      await client.query(
        `INSERT INTO action_inbox
          (id,organization_id,principal_id,project_id,kind,title,detail,
           source_ref,dedupe_key)
         VALUES ($1,$2,$3,$4,'human_decision',$5,$6,$7,$8)
         ON CONFLICT (organization_id,principal_id,dedupe_key)
           WHERE resolved_at IS NULL
         DO NOTHING`,
        [
          uuidv7(),
          this.organizationId,
          row.principal_id,
          projectId,
          `Confirm derived work · ${title}`,
          aggregateType === "work_item"
            ? "A confirmed Spec produced this Work Item. A human must confirm its owner and priority."
            : "A confirmed Spec produced this Feature. A human must confirm its owner.",
          `${aggregateType}:${aggregateId}`,
          `spec-derivation-choice:${aggregateType}:${aggregateId}`,
        ],
      );
    }
  }

  private async resolveAutomationChoiceAttention(
    client: PoolClient,
    aggregateType: "feature" | "work_item",
    aggregateId: string,
  ): Promise<void> {
    await client.query(
      `UPDATE action_inbox
       SET resolved_at=now(),updated_at=now()
       WHERE organization_id=$1
         AND dedupe_key=$2
         AND resolved_at IS NULL`,
      [
        this.organizationId,
        `spec-derivation-choice:${aggregateType}:${aggregateId}`,
      ],
    );
  }

  private async record(
    client: PoolClient,
    projectId: ProjectId,
    actor: WorkActor,
    aggregateType: string,
    aggregateId: string,
    eventType: string,
    payload: unknown,
  ) {
    const operationId = uuidv7();
    await client.query(
      `INSERT INTO activity_events
       (organization_id,operation_id,actor_id,aggregate_type,aggregate_id,event_type,metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        this.organizationId,
        operationId,
        actor.principalId,
        aggregateType,
        aggregateId,
        eventType,
        json({ projectId }),
      ],
    );
    await client.query(
      `INSERT INTO outbox (operation_id,organization_id,topic,payload)
       VALUES ($1,$2,$3,$4)`,
      [
        operationId,
        this.organizationId,
        `project.${projectId}.phase5`,
        json({ eventType, aggregateType, aggregateId, payload }),
      ],
    );
  }

  private async read<T>(
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
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

  private async write<T>(
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
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

async function assertHumanOwner(client: PoolClient, ownerId?: string) {
  if (!ownerId) return;
  const owner = await client.query("SELECT kind FROM principals WHERE id=$1", [
    ownerId,
  ]);
  if (owner.rows[0]?.kind !== "human")
    throw new Error("Work Items may only be assigned to a human.");
}

function assertAgentFeatureMutation(
  actor: WorkActor,
  input: {
    ownerId?: PrincipalId | null | undefined;
    stage?: Feature["stage"] | undefined;
  },
): void {
  if (actor.kind !== "agent") return;
  if (input.ownerId !== undefined) {
    throw new PilotStoreError(
      "AUTOMATION_AUTHORITY_DENIED",
      403,
      "Agent automation cannot assign or change a human Feature owner.",
    );
  }
  if (input.stage === "released") {
    throw new PilotStoreError(
      "AUTOMATION_AUTHORITY_DENIED",
      403,
      "Agent automation cannot make the human Feature release decision.",
    );
  }
}

function assertAgentWorkItemMutation(
  actor: WorkActor,
  input: {
    ownerId?: PrincipalId | null | undefined;
    priority?: WorkItem["priority"] | undefined;
    status?: WorkItem["status"] | undefined;
  },
  creating: boolean,
): void {
  if (actor.kind !== "agent") return;
  if (
    input.ownerId !== undefined ||
    (creating
      ? input.priority !== undefined && input.priority !== "unset"
      : input.priority !== undefined)
  ) {
    throw new PilotStoreError(
      "AUTOMATION_AUTHORITY_DENIED",
      403,
      "Agent automation cannot assign a human owner or set/change priority.",
    );
  }
  if (creating && input.status === "done") {
    throw new PilotStoreError(
      "AUTOMATION_AUTHORITY_DENIED",
      403,
      "Agent automation cannot create work already marked done.",
    );
  }
}

async function assertWorkItem(
  client: PoolClient,
  workItemId: string,
  projectId?: ProjectId,
) {
  const item = await client.query(
    `SELECT 1 FROM project_work_items
     WHERE id = $1 AND revoked_at IS NULL
       AND ($2::uuid IS NULL OR project_id = $2)`,
    [workItemId, projectId ?? null],
  );
  if (!item.rowCount) throw new Error("Work Item was not found.");
}

async function assertEpic(
  client: PoolClient,
  projectId: string,
  epicId?: string,
) {
  if (!epicId) return;
  const epic = await client.query(
    `SELECT 1 FROM project_epics
     WHERE id=$1 AND project_id=$2`,
    [epicId, projectId],
  );
  if (!epic.rowCount) {
    throw new Error("Feature Epic must belong to the same Project.");
  }
}

async function assertWorkLinks(
  client: PoolClient,
  projectId: string,
  featureId?: string,
  specId?: string,
) {
  if (featureId) {
    const feature = await client.query(
      `SELECT 1 FROM project_features
       WHERE id=$1 AND project_id=$2 AND revoked_at IS NULL`,
      [featureId, projectId],
    );
    if (!feature.rowCount) {
      throw new Error("Work Item Feature must belong to the same Project.");
    }
  }
  if (specId) {
    const spec = await client.query(
      `SELECT 1 FROM specs
       WHERE id=$1 AND project_id=$2`,
      [specId, projectId],
    );
    if (!spec.rowCount) {
      throw new Error("Work Item Spec must belong to the same Project.");
    }
  }
}

async function assertConfirmedSpecSource(
  client: PoolClient,
  source: {
    projectId: ProjectId;
    specId?: SpecId | undefined;
    sourceSpecRevisionId?: SpecRevisionId | undefined;
    sourceReferences?: string[] | undefined;
  },
): Promise<void> {
  const references = source.sourceReferences ?? [];
  const hasDerivedSource =
    Boolean(source.sourceSpecRevisionId) || references.length > 0;
  if (!hasDerivedSource) {
    if (source.specId) {
      const linked = await client.query(
        "SELECT 1 FROM specs WHERE id=$1 AND project_id=$2",
        [source.specId, source.projectId],
      );
      if (!linked.rowCount) {
        throw new Error("Feature Spec must belong to the same Project.");
      }
    }
    return;
  }
  if (
    !source.specId ||
    !source.sourceSpecRevisionId ||
    references.length === 0
  ) {
    throw new PilotStoreError(
      "CONFIRMED_SPEC_SOURCE_REQUIRED",
      409,
      "Derived work requires a Spec, its confirmed revision, and at least one source block reference.",
    );
  }
  const revision = await client.query<{
    markdown: string;
    blocks: Array<{ id: string }>;
  }>(
    `SELECT r.markdown,r.blocks
     FROM specs s
     JOIN spec_revisions r
       ON r.id=s.confirmed_revision_id AND r.spec_id=s.id
     WHERE s.id=$1 AND s.project_id=$2
       AND r.id=$3 AND r.revoked_at IS NULL`,
    [source.specId, source.projectId, source.sourceSpecRevisionId],
  );
  if (!revision.rows[0]) {
    throw new PilotStoreError(
      "CONFIRMED_SPEC_SOURCE_REQUIRED",
      409,
      "Derived work may reference only the Project's active confirmed Spec revision.",
    );
  }
  const blockIds = new Set(
    (revision.rows[0].blocks ?? []).map((block) => `block:${block.id}`),
  );
  const invalid = references.find((reference) => !blockIds.has(reference));
  if (invalid) {
    throw new PilotStoreError(
      "INVALID_SPEC_SOURCE_REFERENCE",
      409,
      `Spec source reference "${invalid}" does not identify a block in the confirmed revision.`,
    );
  }
}

async function assertHistoricallyConfirmedSpecSource(
  client: PoolClient,
  source: {
    projectId: ProjectId;
    specId?: SpecId | undefined;
    sourceSpecRevisionId?: SpecRevisionId | undefined;
    sourceReferences?: string[] | undefined;
  },
): Promise<void> {
  const references = source.sourceReferences ?? [];
  if (!source.sourceSpecRevisionId && references.length === 0) {
    return assertConfirmedSpecSource(client, source);
  }
  if (
    !source.specId ||
    !source.sourceSpecRevisionId ||
    references.length === 0
  ) {
    throw new PilotStoreError(
      "CONFIRMED_SPEC_SOURCE_REQUIRED",
      409,
      "Derived work requires a Spec, its confirmed revision, and at least one source block reference.",
    );
  }
  const revision = await client.query<{ blocks: Array<{ id: string }> }>(
    `SELECT r.blocks
     FROM specs s
     JOIN spec_revisions r ON r.spec_id=s.id
     WHERE s.id=$1 AND s.project_id=$2 AND r.id=$3
       AND r.confirmed_at IS NOT NULL AND r.revoked_at IS NULL`,
    [source.specId, source.projectId, source.sourceSpecRevisionId],
  );
  if (!revision.rows[0]) {
    throw new PilotStoreError(
      "CONFIRMED_SPEC_SOURCE_REQUIRED",
      409,
      "Revert may restore only a non-revoked Spec revision that was previously confirmed.",
    );
  }
  const blockIds = new Set(
    (revision.rows[0].blocks ?? []).map((block) => `block:${block.id}`),
  );
  const invalid = references.find((reference) => !blockIds.has(reference));
  if (invalid) {
    throw new PilotStoreError(
      "INVALID_SPEC_SOURCE_REFERENCE",
      409,
      `Spec source reference "${invalid}" does not identify a block in the confirmed revision.`,
    );
  }
}

async function assertPlanning(
  client: PoolClient,
  projectId: string,
  piId?: string,
  sprintId?: string,
) {
  if (piId) {
    const pi = await client.query(
      "SELECT 1 FROM project_program_increments WHERE id=$1 AND project_id=$2",
      [piId, projectId],
    );
    if (!pi.rowCount) {
      throw new Error("Program Increment was not found in this Project.");
    }
  }
  if (!sprintId) return;
  const sprint = await client.query(
    "SELECT pi_id FROM project_sprints WHERE id=$1 AND project_id=$2",
    [sprintId, projectId],
  );
  if (!sprint.rows[0]) throw new Error("Sprint was not found in this Project.");
  if (piId && sprint.rows[0].pi_id !== piId)
    throw new Error("Sprint assignment must imply its parent PI.");
}

async function persistFeature(client: PoolClient, feature: Feature) {
  await client.query(
    `UPDATE project_features SET
       epic_id=$3,spec_id=$4,source_spec_revision_id=$5,
       source_references=$6,automation_policy_version=$7,
       title=$8,description=$9,stage=$10,owner_id=$11,
       pi_id=$12,sprint_id=$13,revoked_at=NULL,updated_at=$14
     WHERE id=$1 AND project_id=$2`,
    [
      feature.id,
      feature.projectId,
      feature.epicId ?? null,
      feature.specId ?? null,
      feature.sourceSpecRevisionId ?? null,
      json(feature.sourceReferences ?? []),
      feature.automationPolicyVersion ?? null,
      feature.title,
      feature.description,
      feature.stage,
      feature.ownerId ?? null,
      feature.piId ?? null,
      feature.sprintId ?? null,
      feature.updatedAt,
    ],
  );
}

async function persistWorkItem(client: PoolClient, item: WorkItem) {
  await client.query(
    `UPDATE project_work_items SET
       feature_id=$3,title=$4,description=$5,status=$6,owner_id=$7,
       spec_id=$8,source_spec_revision_id=$9,source_references=$10,
       automation_policy_version=$11,priority=$12,points=$13,pi_id=$14,
       sprint_id=$15,source_sprint_id=$16,carryover=$17,
       completion_evidence=$18,completed_by=$19,completed_at=$20,
       revoked_at=NULL,coordination_thread_ids=$21,updated_at=$22
     WHERE id=$1 AND project_id=$2`,
    [
      item.id,
      item.projectId,
      item.featureId ?? null,
      item.title,
      item.description,
      item.status,
      item.ownerId ?? null,
      item.specId ?? null,
      item.sourceSpecRevisionId ?? null,
      json(item.sourceReferences ?? []),
      item.automationPolicyVersion ?? null,
      item.priority,
      item.points ?? null,
      item.piId ?? null,
      item.sprintId ?? null,
      item.sourceSprintId ?? null,
      item.carryover,
      item.completionEvidence ?? null,
      item.completedBy ? json(item.completedBy) : null,
      item.completedAt ?? null,
      json(item.coordinationThreadIds),
      item.updatedAt,
    ],
  );
}

function epicFromRow(row: QueryResultRow): Epic {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
  };
}
function featureFromRow(row: QueryResultRow): Feature {
  return {
    id: row.id,
    projectId: row.project_id,
    ...(row.epic_id ? { epicId: row.epic_id } : {}),
    ...(row.spec_id ? { specId: row.spec_id } : {}),
    ...(row.source_spec_revision_id
      ? { sourceSpecRevisionId: row.source_spec_revision_id }
      : {}),
    ...(row.source_references?.length
      ? { sourceReferences: row.source_references }
      : {}),
    ...(row.automation_policy_version
      ? { automationPolicyVersion: row.automation_policy_version }
      : {}),
    title: row.title,
    description: row.description,
    stage: row.stage,
    ...(row.owner_id ? { ownerId: row.owner_id } : {}),
    ...(row.pi_id ? { piId: row.pi_id } : {}),
    ...(row.sprint_id ? { sprintId: row.sprint_id } : {}),
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
    ...(row.revoked_at ? { revokedAt: asIso(row.revoked_at) } : {}),
  };
}
function workItemFromRow(row: QueryResultRow): WorkItem {
  return {
    id: row.id,
    projectId: row.project_id,
    ...(row.feature_id ? { featureId: row.feature_id } : {}),
    title: row.title,
    description: row.description,
    status: row.status,
    ...(row.owner_id ? { ownerId: row.owner_id } : {}),
    ...(row.spec_id ? { specId: row.spec_id } : {}),
    ...(row.source_spec_revision_id
      ? { sourceSpecRevisionId: row.source_spec_revision_id }
      : {}),
    ...(row.source_references?.length
      ? { sourceReferences: row.source_references }
      : {}),
    ...(row.automation_policy_version
      ? { automationPolicyVersion: row.automation_policy_version }
      : {}),
    priority: row.priority,
    ...(row.points === null ? {} : { points: Number(row.points) }),
    ...(row.pi_id ? { piId: row.pi_id } : {}),
    ...(row.sprint_id ? { sprintId: row.sprint_id } : {}),
    ...(row.source_sprint_id ? { sourceSprintId: row.source_sprint_id } : {}),
    carryover: row.carryover,
    ...(row.completion_evidence
      ? { completionEvidence: row.completion_evidence }
      : {}),
    ...(row.completed_by ? { completedBy: row.completed_by } : {}),
    ...(row.completed_at ? { completedAt: asIso(row.completed_at) } : {}),
    coordinationThreadIds: row.coordination_thread_ids ?? [],
    createdBy: row.created_by,
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
    ...(row.revoked_at ? { revokedAt: asIso(row.revoked_at) } : {}),
  };
}
function relationFromRow(row: QueryResultRow): WorkRelation {
  return {
    sourceId: row.source_id,
    targetId: row.target_id,
    kind: row.kind,
    ...(row.spec_id ? { specId: row.spec_id } : {}),
    ...(row.source_spec_revision_id
      ? { sourceSpecRevisionId: row.source_spec_revision_id }
      : {}),
    ...(row.source_references?.length
      ? { sourceReferences: row.source_references }
      : {}),
    ...(row.automation_policy_version
      ? { automationPolicyVersion: row.automation_policy_version }
      : {}),
    ...(row.idempotency_key ? { idempotencyKey: row.idempotency_key } : {}),
    createdBy: row.created_by,
    createdAt: asIso(row.created_at),
    ...(row.revoked_at ? { revokedAt: asIso(row.revoked_at) } : {}),
  };
}
function codeRefFromRow(row: QueryResultRow): WorkCodeReference {
  return {
    id: row.id,
    workItemId: row.work_item_id,
    kind: row.kind,
    label: row.label,
    ...(row.url ? { url: row.url } : {}),
    ...(row.repository ? { repository: row.repository } : {}),
    value: row.value,
    reportedBy: row.reported_by,
    createdAt: asIso(row.created_at),
  };
}
function commentFromRow(row: QueryResultRow): WorkComment {
  return {
    id: row.id,
    workItemId: row.work_item_id,
    ...(row.parent_id ? { parentId: row.parent_id } : {}),
    body: row.body,
    ...(row.spec_id ? { specId: row.spec_id } : {}),
    ...(row.source_spec_revision_id
      ? { sourceSpecRevisionId: row.source_spec_revision_id }
      : {}),
    ...(row.source_references?.length
      ? { sourceReferences: row.source_references }
      : {}),
    ...(row.automation_policy_version
      ? { automationPolicyVersion: row.automation_policy_version }
      : {}),
    ...(row.idempotency_key ? { idempotencyKey: row.idempotency_key } : {}),
    author: row.author,
    createdAt: asIso(row.created_at),
    ...(row.revoked_at ? { revokedAt: asIso(row.revoked_at) } : {}),
  };
}
function historyFromRow(row: QueryResultRow): WorkHistoryEntry {
  return {
    id: row.id,
    workItemId: row.work_item_id,
    action: row.action,
    snapshot: row.snapshot,
    actor: row.actor,
    occurredAt: asIso(row.occurred_at),
    ...(row.idempotency_key ? { idempotencyKey: row.idempotency_key } : {}),
    ...(row.reverted_entry_id
      ? { revertedEntryId: row.reverted_entry_id }
      : {}),
  };
}
function featureHistoryFromRow(row: QueryResultRow): FeatureHistoryEntry {
  return {
    id: row.id,
    featureId: row.feature_id,
    action: row.action,
    snapshot: row.snapshot,
    actor: row.actor,
    occurredAt: asIso(row.occurred_at),
    ...(row.idempotency_key ? { idempotencyKey: row.idempotency_key } : {}),
    ...(row.reverted_entry_id
      ? { revertedEntryId: row.reverted_entry_id }
      : {}),
  };
}
function piFromRow(row: QueryResultRow): ProgramIncrement {
  return {
    id: row.id,
    projectId: row.project_id,
    number: row.number,
    startDate: dateString(row.start_date),
    endDate: dateString(row.end_date),
    timezone: row.timezone,
    ...(row.closed_at ? { closedAt: asIso(row.closed_at) } : {}),
    createdAt: asIso(row.created_at),
  };
}
function sprintFromRow(row: QueryResultRow): Sprint {
  return {
    id: row.id,
    projectId: row.project_id,
    piId: row.pi_id,
    number: row.number,
    startDate: dateString(row.start_date),
    endDate: dateString(row.end_date),
    ...(row.closed_at ? { closedAt: asIso(row.closed_at) } : {}),
  };
}
function specFromRow(row: QueryResultRow): Spec {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    currentRevisionId: row.current_revision_id,
    ...(row.review_thread_id ? { reviewThreadId: row.review_thread_id } : {}),
    relatedWorkstreamIds: row.related_workstream_ids ?? [],
    status: row.status,
    createdAt: asIso(row.created_at),
    ...(row.review_requested_at
      ? { reviewRequestedAt: asIso(row.review_requested_at) }
      : {}),
    ...(row.confirmed_revision_id
      ? { confirmedRevisionId: row.confirmed_revision_id }
      : {}),
  };
}
function revisionFromRow(row: QueryResultRow): SpecRevision {
  return {
    id: row.id,
    specId: row.spec_id,
    revision: row.revision,
    markdown: row.markdown,
    blocks: row.blocks,
    changeSummary: row.change_summary,
    affectedScopes: row.affected_scopes,
    createdBy: row.created_by,
    createdAt: asIso(row.created_at),
    ...(row.revoked_at ? { revokedAt: asIso(row.revoked_at) } : {}),
  };
}
function specThreadFromRow(row: QueryResultRow): SpecCommentThread {
  return {
    id: row.id,
    specId: row.spec_id,
    revisionId: row.revision_id,
    lineStart: row.line_start,
    lineEnd: row.line_end,
    ...(row.char_start === null || row.char_start === undefined
      ? {}
      : { charStart: row.char_start }),
    ...(row.char_end === null || row.char_end === undefined
      ? {}
      : { charEnd: row.char_end }),
    ...(row.selection ? { selection: row.selection } : {}),
    status: row.status,
    createdAt: asIso(row.created_at),
    ...(row.resolved_at ? { resolvedAt: asIso(row.resolved_at) } : {}),
  };
}
function specCommentFromRow(row: QueryResultRow): SpecComment {
  return {
    id: row.id,
    threadId: row.thread_id,
    ...(row.parent_id ? { parentId: row.parent_id } : {}),
    authorId: row.author_id,
    authorKind: row.author_kind,
    body: row.body,
    createdAt: asIso(row.created_at),
  };
}
function confirmationFromRow(row: QueryResultRow): SpecConfirmation {
  return {
    specId: row.spec_id,
    revisionId: row.revision_id,
    confirmerId: row.confirmer_id,
    confirmerKind: row.confirmer_kind,
    createdAt: asIso(row.created_at),
  };
}
function policyFromRow(row: QueryResultRow): SpecReviewPolicy {
  return {
    projectId: row.project_id,
    requiredConfirmations: row.required_confirmations,
    otherMemberAgentsCount: row.other_member_agents_count,
    authorSelfConfirmation: row.author_self_confirmation,
    updatedAt: asIso(row.updated_at),
  };
}
function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}
function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
function dateString(value: Date | string): string {
  if (!(value instanceof Date)) return String(value).slice(0, 10);
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-");
}
function asIso(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}
function json(value: unknown): string {
  return JSON.stringify(value);
}
