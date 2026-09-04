import {
  type ActionInboxItem,
  type AuthorizedSearchResult,
  defaultNotificationPreferences,
  type MessageNotificationMode,
  type NotificationPreferences,
  type OrganizationId,
  type PreferredLanguage,
  type PrincipalId,
  type ProjectId,
  uuidv7,
} from "@intero/domain";
import type { Pool, PoolClient } from "pg";

export interface CreateAttentionInput {
  principalId: PrincipalId;
  projectId?: ProjectId;
  kind: ActionInboxItem["kind"];
  title: string;
  detail: string;
  sourceRef: string;
  dedupeKey: string;
}

export class PostgresInformationStore {
  constructor(
    private readonly pool: Pool,
    private readonly organizationId: OrganizationId,
  ) {}

  async createAttention(input: CreateAttentionInput): Promise<void> {
    await this.write(async (client) => {
      await client.query(
        `INSERT INTO action_inbox
          (id, organization_id, principal_id, project_id, kind, title, detail,
           source_ref, dedupe_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (organization_id, principal_id, dedupe_key)
           WHERE resolved_at IS NULL
         DO NOTHING`,
        [
          uuidv7(),
          this.organizationId,
          input.principalId,
          input.projectId ?? null,
          input.kind,
          input.title,
          input.detail,
          input.sourceRef,
          input.dedupeKey,
        ],
      );
    });
  }

  async listAttention(
    principalId: PrincipalId,
    includeDismissed = false,
  ): Promise<ActionInboxItem[]> {
    return this.read(async (client) => {
      const result = await client.query(
        `SELECT * FROM action_inbox
         WHERE principal_id = $1
           AND resolved_at IS NULL
           AND ($2::boolean OR dismissed_at IS NULL)
         ORDER BY created_at DESC`,
        [principalId, includeDismissed],
      );
      return result.rows.map(attentionFromRow);
    });
  }

  async updateAttention(
    principalId: PrincipalId,
    itemId: string,
    action: "read" | "unread" | "dismiss" | "restore" | "resolve",
  ): Promise<ActionInboxItem> {
    return this.write(async (client) => {
      const expression = {
        read: "read_at = now()",
        unread: "read_at = NULL",
        dismiss: "dismissed_at = now(), read_at = COALESCE(read_at, now())",
        restore: "dismissed_at = NULL",
        resolve: "resolved_at = now(), read_at = COALESCE(read_at, now())",
      }[action];
      const result = await client.query(
        `UPDATE action_inbox SET ${expression}, updated_at = now()
         WHERE id = $1 AND principal_id = $2
         RETURNING *`,
        [itemId, principalId],
      );
      if (!result.rows[0]) throw new Error("Inbox item was not found.");
      return attentionFromRow(result.rows[0]);
    });
  }

  async resolveAttention(
    principalId: PrincipalId,
    dedupeKey: string,
  ): Promise<void> {
    await this.write(async (client) => {
      await client.query(
        `UPDATE action_inbox
         SET resolved_at=now(), read_at=COALESCE(read_at,now()), updated_at=now()
         WHERE principal_id=$1 AND dedupe_key=$2 AND resolved_at IS NULL`,
        [principalId, dedupeKey],
      );
    });
  }

  async getPreferences(
    principalId: PrincipalId,
  ): Promise<NotificationPreferences> {
    return this.read(async (client) => {
      const result = await client.query(
        `SELECT * FROM notification_preferences WHERE principal_id = $1`,
        [principalId],
      );
      return result.rows[0]
        ? preferencesFromRow(result.rows[0])
        : defaultNotificationPreferences(principalId);
    });
  }

  async setPreferences(
    principalId: PrincipalId,
    input: {
      mutedKinds: ActionInboxItem["kind"][];
      muteUntil?: string;
      messages?: MessageNotificationMode;
      locale?: PreferredLanguage;
    },
  ): Promise<NotificationPreferences> {
    return this.write(async (client) => {
      const result = await client.query(
        `INSERT INTO notification_preferences
          (organization_id, principal_id, muted_kinds, mute_until, messages, locale)
         VALUES ($1,$2,$3::jsonb,$4,COALESCE($5,'mentions'),$6)
         ON CONFLICT (organization_id, principal_id) DO UPDATE SET
           muted_kinds = EXCLUDED.muted_kinds,
           mute_until = EXCLUDED.mute_until,
           messages = COALESCE($5, notification_preferences.messages),
           locale = COALESCE($6, notification_preferences.locale),
           updated_at = now()
         RETURNING *`,
        [
          this.organizationId,
          principalId,
          JSON.stringify([...new Set(input.mutedKinds)]),
          input.muteUntil ?? null,
          input.messages ?? null,
          input.locale ?? null,
        ],
      );
      return preferencesFromRow(result.rows[0]);
    });
  }

  async search(
    principalId: PrincipalId,
    input: {
      query: string;
      projectId?: ProjectId;
      types?: AuthorizedSearchResult["type"][];
      limit: number;
    },
  ): Promise<AuthorizedSearchResult[]> {
    return this.read(async (client) => {
      const result = await client.query<SearchRow>(
        `WITH accessible_projects AS (
           SELECT DISTINCT p.id, p.name
           FROM projects p
           WHERE p.organization_id = $1
             AND (
               EXISTS (
                 SELECT 1
                 FROM memberships m
                 WHERE m.organization_id = $1
                   AND m.principal_id = $2
                   AND m.role = 'admin'
               )
               OR EXISTS (
                 SELECT 1
                 FROM pilot_project_teams ppt
                 JOIN pilot_team_memberships ptm
                   ON ptm.team_id = ppt.team_id
                  AND ptm.organization_id = ppt.organization_id
                 WHERE ppt.project_id = p.id
                   AND ptm.principal_id = $2
               )
             )
             AND ($3::uuid IS NULL OR p.id = $3)
         ),
         candidates AS (
           SELECT wi.id::text AS id, wi.project_id, ap.name AS project_name,
                  'work_item'::text AS type, wi.title,
                  concat_ws(' ', wi.title, wi.description) AS search_text,
                  'work-item:' || wi.id::text AS source_ref, wi.updated_at
           FROM project_work_items wi
           JOIN accessible_projects ap ON ap.id = wi.project_id
           WHERE wi.revoked_at IS NULL
           UNION ALL
           SELECT s.id::text, s.project_id, ap.name, 'spec', s.title,
                  concat_ws(' ', s.title, r.markdown), 'spec:' || s.id::text,
                  s.updated_at
           FROM specs s
           JOIN accessible_projects ap ON ap.id = s.project_id
           LEFT JOIN spec_revisions r ON r.id = s.current_revision_id
           UNION ALL
           SELECT r.id::text, s.project_id, ap.name, 'spec_version',
                  s.title || ' · v' || r.revision::text,
                  concat_ws(' ', s.title, r.change_summary, r.markdown),
                  'spec-version:' || r.id::text, r.updated_at
           FROM spec_revisions r
           JOIN specs s ON s.id = r.spec_id
           JOIN accessible_projects ap ON ap.id = s.project_id
           WHERE r.revoked_at IS NULL
           UNION ALL
           SELECT c.id::text, wi.project_id, ap.name, 'comment',
                  'Comment · ' || wi.title, c.body,
                  'work-comment:' || c.id::text, c.created_at
           FROM project_work_comments c
           JOIN project_work_items wi ON wi.id = c.work_item_id
           JOIN accessible_projects ap ON ap.id = wi.project_id
           WHERE c.revoked_at IS NULL
           UNION ALL
           SELECT c.id::text, s.project_id, ap.name, 'comment',
                  'Spec comment · ' || s.title, c.body,
                  'spec-comment:' || c.id::text, c.created_at
           FROM project_spec_comments c
           JOIN project_spec_comment_threads t ON t.id = c.thread_id
           JOIN specs s ON s.id = t.spec_id
           JOIN accessible_projects ap ON ap.id = s.project_id
           UNION ALL
           SELECT r.id::text, wi.project_id, ap.name, 'code_reference',
                  r.label, concat_ws(' ', r.label, r.repository, r.value, r.url),
                  'code-reference:' || r.id::text, r.created_at
           FROM project_work_code_refs r
           JOIN project_work_items wi ON wi.id = r.work_item_id
           JOIN accessible_projects ap ON ap.id = wi.project_id
           UNION ALL
           SELECT c.id::text, c.project_id, ap.name, 'coordination',
                  COALESCE(c.data->>'title', c.data->>'trigger', 'Coordination'),
                  concat_ws(' ', c.data->>'title', c.data->>'trigger',
                    c.data->>'safeContext', c.data->>'candidateNextStep',
                    c.data->>'conclusion'),
                  'coordination:' || c.id::text, c.updated_at
           FROM pilot_coordination_threads c
           JOIN accessible_projects ap ON ap.id = c.project_id
           UNION ALL
           SELECT e.id::text, e.project_id, ap.name, 'stand_in_activity',
                  'Stand-in answer',
                  concat_ws(' ', e.data->>'question', e.data->>'answer'),
                  'stand-in-exchange:' || e.id::text, e.created_at
           FROM pilot_stand_in_exchanges e
           JOIN accessible_projects ap ON ap.id = e.project_id
           WHERE e.principal_id = $2
         )
         SELECT id, project_id, project_name, type, title,
                left(regexp_replace(search_text, '\\s+', ' ', 'g'), 500) AS snippet,
                source_ref, updated_at
         FROM candidates
         WHERE search_text ILIKE '%' || $4 || '%'
           AND ($5::text[] IS NULL OR type = ANY($5))
         ORDER BY
           CASE WHEN title ILIKE $4 || '%' THEN 0 ELSE 1 END,
           similarity(search_text, $4) DESC,
           updated_at DESC
         LIMIT $6`,
        [
          this.organizationId,
          principalId,
          input.projectId ?? null,
          input.query,
          input.types?.length ? input.types : null,
          input.limit,
        ],
      );
      return result.rows.map((row) => ({
        id: row.id,
        projectId: row.project_id as ProjectId,
        projectName: row.project_name,
        type: row.type,
        title: row.title,
        snippet: row.snippet,
        sourceRef: row.source_ref,
        updatedAt: row.updated_at.toISOString(),
      }));
    });
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

interface SearchRow {
  id: string;
  project_id: string;
  project_name: string;
  type: AuthorizedSearchResult["type"];
  title: string;
  snippet: string;
  source_ref: string;
  updated_at: Date;
}

function attentionFromRow(row: Record<string, unknown>): ActionInboxItem {
  return {
    id: String(row.id),
    principalId: String(row.principal_id) as PrincipalId,
    ...(row.project_id ? { projectId: String(row.project_id) } : {}),
    kind: String(row.kind) as ActionInboxItem["kind"],
    title: String(row.title),
    detail: String(row.detail),
    sourceRef: String(row.source_ref),
    createdAt: new Date(String(row.created_at)).toISOString(),
    ...(row.read_at
      ? { readAt: new Date(String(row.read_at)).toISOString() }
      : {}),
    ...(row.dismissed_at
      ? { dismissedAt: new Date(String(row.dismissed_at)).toISOString() }
      : {}),
    ...(row.resolved_at
      ? { resolvedAt: new Date(String(row.resolved_at)).toISOString() }
      : {}),
  };
}

function preferencesFromRow(
  row: Record<string, unknown>,
): NotificationPreferences {
  const messages = row.messages;
  return {
    principalId: String(row.principal_id) as PrincipalId,
    mutedKinds: Array.isArray(row.muted_kinds)
      ? (row.muted_kinds as NotificationPreferences["mutedKinds"])
      : [],
    ...(row.mute_until
      ? { muteUntil: new Date(String(row.mute_until)).toISOString() }
      : {}),
    messages:
      messages === "all" || messages === "mentions" || messages === "none"
        ? messages
        : "mentions",
    ...(row.locale === "zh-CN" || row.locale === "en-US"
      ? { locale: row.locale }
      : {}),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}
