use std::fmt::Write;
use std::path::Path;
use std::sync::{Arc, Mutex};

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use keyring::Entry;
use rand::RngCore;
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::Value;
use thiserror::Error;
use uuid::Uuid;

use crate::workspace::Workspace;

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("credential store error: {0}")]
    Credential(#[from] keyring::Error),
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("database mutex is poisoned")]
    LockPoisoned,
    #[error("stored JSON is invalid: {0}")]
    Json(#[from] serde_json::Error),
    #[error("invalid runtime setting: {0}")]
    InvalidSetting(String),
    #[error("multiple active Coding Agent sessions match this MCP process")]
    AmbiguousIntegrationContext,
}

pub trait CredentialStore {
    fn load_or_create_database_key(&self) -> Result<String, StorageError>;
}

pub struct OsCredentialStore {
    service: String,
    account: String,
}

impl OsCredentialStore {
    #[must_use]
    pub fn new(service: impl Into<String>, account: impl Into<String>) -> Self {
        Self {
            service: service.into(),
            account: account.into(),
        }
    }

    pub fn load_or_create_secret(
        &self,
        suffix: &str,
        byte_count: usize,
    ) -> Result<String, StorageError> {
        let entry = Entry::new(&self.service, &format!("{}:{suffix}", self.account))?;
        match entry.get_password() {
            Ok(existing) => Ok(existing),
            Err(keyring::Error::NoEntry) => {
                let mut secret = vec![0_u8; byte_count];
                rand::rng().fill_bytes(&mut secret);
                let encoded = STANDARD.encode(secret);
                entry.set_password(&encoded)?;
                Ok(encoded)
            }
            Err(error) => Err(error.into()),
        }
    }
}

impl CredentialStore for OsCredentialStore {
    fn load_or_create_database_key(&self) -> Result<String, StorageError> {
        let entry = Entry::new(&self.service, &self.account)?;
        match entry.get_password() {
            Ok(existing) => Ok(existing),
            Err(keyring::Error::NoEntry) => {
                let mut key = [0_u8; 32];
                rand::rng().fill_bytes(&mut key);
                let encoded = STANDARD.encode(key);
                entry.set_password(&encoded)?;
                Ok(encoded)
            }
            Err(error) => Err(error.into()),
        }
    }
}

#[derive(Clone)]
pub struct EncryptedStore {
    connection: Arc<Mutex<Connection>>,
}

impl EncryptedStore {
    pub fn open(path: &Path, credential_store: &dyn CredentialStore) -> Result<Self, StorageError> {
        let key = credential_store.load_or_create_database_key()?;
        let connection = Connection::open(path)?;
        connection.pragma_update(None, "key", format!("x'{}'", hex_key(&key)))?;
        connection.pragma_update(None, "cipher_memory_security", "ON")?;
        connection.execute_batch(
            "
            PRAGMA foreign_keys = ON;
            CREATE TABLE IF NOT EXISTS canonical_events (
              id TEXT PRIMARY KEY,
              idempotency_key TEXT NOT NULL UNIQUE,
              workspace_id TEXT NOT NULL,
              event_type TEXT NOT NULL,
              safe_payload TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sync_queue (
              operation_id TEXT PRIMARY KEY,
              public_projection TEXT NOT NULL,
              cursor INTEGER,
              attempts INTEGER NOT NULL DEFAULT 0,
              completed_at TEXT
            );
            CREATE TABLE IF NOT EXISTS workspace_enrollments (
              id TEXT PRIMARY KEY,
              root TEXT NOT NULL UNIQUE,
              repository_identity TEXT NOT NULL,
              excluded_paths TEXT NOT NULL,
              revoked INTEGER NOT NULL DEFAULT 0,
              committed INTEGER NOT NULL DEFAULT 1
            );
            CREATE TABLE IF NOT EXISTS representative_requests (
              request_id TEXT PRIMARY KEY,
              method TEXT NOT NULL,
              params TEXT NOT NULL,
              queued_at INTEGER NOT NULL,
              consumed_at INTEGER,
              completed_at INTEGER,
              result_json TEXT
            );
            CREATE INDEX IF NOT EXISTS representative_requests_pending_idx
              ON representative_requests(consumed_at, queued_at);
            CREATE TABLE IF NOT EXISTS integration_sessions (
              session_key TEXT PRIMARY KEY,
              workspace_id TEXT NOT NULL,
              workstream_id TEXT NOT NULL,
              created_at INTEGER NOT NULL,
              active INTEGER NOT NULL DEFAULT 1,
              last_seen_at INTEGER NOT NULL DEFAULT 0,
              lifecycle_state TEXT NOT NULL DEFAULT 'active'
            );
            CREATE TABLE IF NOT EXISTS runtime_settings (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL,
              updated_at INTEGER NOT NULL
            );
            CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
              object_id UNINDEXED,
              title,
              summary
            );
            CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts_v2 USING fts5(
              workspace_id UNINDEXED,
              object_id UNINDEXED,
              object_type UNINDEXED,
              title,
              summary
            );
            ",
        )?;
        let representative_request_columns = {
            let mut statement = connection.prepare("PRAGMA table_info(representative_requests)")?;
            statement
                .query_map([], |row| row.get::<_, String>(1))?
                .collect::<Result<Vec<_>, _>>()?
        };
        if !representative_request_columns
            .iter()
            .any(|column| column == "completed_at")
        {
            connection.execute(
                "ALTER TABLE representative_requests ADD COLUMN completed_at INTEGER",
                [],
            )?;
        }
        let workspace_columns = {
            let mut statement = connection.prepare("PRAGMA table_info(workspace_enrollments)")?;
            statement
                .query_map([], |row| row.get::<_, String>(1))?
                .collect::<Result<Vec<_>, _>>()?
        };
        if !workspace_columns.iter().any(|column| column == "committed") {
            connection.execute_batch(
                "ALTER TABLE workspace_enrollments
                 ADD COLUMN committed INTEGER NOT NULL DEFAULT 1",
            )?;
        }
        let integration_session_columns = {
            let mut statement = connection.prepare("PRAGMA table_info(integration_sessions)")?;
            statement
                .query_map([], |row| row.get::<_, String>(1))?
                .collect::<Result<Vec<_>, _>>()?
        };
        if !integration_session_columns
            .iter()
            .any(|column| column == "active")
        {
            connection.execute(
                "ALTER TABLE integration_sessions
                 ADD COLUMN active INTEGER NOT NULL DEFAULT 1",
                [],
            )?;
        }
        if !integration_session_columns
            .iter()
            .any(|column| column == "last_seen_at")
        {
            connection.execute(
                "ALTER TABLE integration_sessions
                 ADD COLUMN last_seen_at INTEGER NOT NULL DEFAULT 0",
                [],
            )?;
            connection.execute(
                "UPDATE integration_sessions SET last_seen_at = created_at",
                [],
            )?;
        }
        if !integration_session_columns
            .iter()
            .any(|column| column == "lifecycle_state")
        {
            connection.execute(
                "ALTER TABLE integration_sessions
                 ADD COLUMN lifecycle_state TEXT NOT NULL DEFAULT 'active'",
                [],
            )?;
            connection.execute(
                "UPDATE integration_sessions
                 SET lifecycle_state = CASE WHEN active = 1 THEN 'active' ELSE 'ended' END",
                [],
            )?;
        }
        if !representative_request_columns
            .iter()
            .any(|column| column == "result_json")
        {
            connection.execute(
                "ALTER TABLE representative_requests ADD COLUMN result_json TEXT",
                [],
            )?;
        }
        Ok(Self {
            connection: Arc::new(Mutex::new(connection)),
        })
    }

    pub fn enqueue_event(
        &self,
        id: &str,
        idempotency_key: &str,
        workspace_id: &str,
        event_type: &str,
        safe_payload: &str,
        created_at: &str,
    ) -> Result<bool, StorageError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| StorageError::LockPoisoned)?;
        let inserted = connection.execute(
            "INSERT OR IGNORE INTO canonical_events
             (id, idempotency_key, workspace_id, event_type, safe_payload, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                id,
                idempotency_key,
                workspace_id,
                event_type,
                safe_payload,
                created_at
            ],
        )?;
        Ok(inserted == 1)
    }

    pub fn upsert_workspace(&self, workspace: &Workspace) -> Result<(), StorageError> {
        self.write_workspace(workspace, true)
    }

    pub fn stage_workspace(&self, workspace: &Workspace) -> Result<(), StorageError> {
        self.write_workspace(workspace, false)
    }

    fn write_workspace(&self, workspace: &Workspace, committed: bool) -> Result<(), StorageError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| StorageError::LockPoisoned)?;
        connection.execute(
            "INSERT INTO workspace_enrollments
             (id, root, repository_identity, excluded_paths, revoked, committed)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
               root = excluded.root,
               repository_identity = excluded.repository_identity,
               excluded_paths = excluded.excluded_paths,
               revoked = excluded.revoked,
               committed = excluded.committed",
            params![
                workspace.id.to_string(),
                workspace.root.to_string_lossy(),
                workspace.repository_identity,
                serde_json::to_string(&workspace.excluded_paths)?,
                workspace.revoked,
                committed
            ],
        )?;
        Ok(())
    }

    pub fn commit_workspace(&self, workspace_id: Uuid) -> Result<(), StorageError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| StorageError::LockPoisoned)?;
        let updated = connection.execute(
            "UPDATE workspace_enrollments SET committed = 1 WHERE id = ?1",
            [workspace_id.to_string()],
        )?;
        if updated != 1 {
            return Err(StorageError::InvalidSetting(
                "pending workspace enrollment is missing".into(),
            ));
        }
        Ok(())
    }

    pub fn mark_workspace_pending(&self, workspace_id: Uuid) -> Result<(), StorageError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| StorageError::LockPoisoned)?;
        connection.execute(
            "UPDATE workspace_enrollments SET committed = 0 WHERE id = ?1",
            [workspace_id.to_string()],
        )?;
        Ok(())
    }

    pub fn discard_pending_workspaces(&self) -> Result<(), StorageError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| StorageError::LockPoisoned)?;
        connection.execute("DELETE FROM workspace_enrollments WHERE committed = 0", [])?;
        Ok(())
    }

    pub fn delete_workspace(&self, workspace_id: Uuid) -> Result<(), StorageError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| StorageError::LockPoisoned)?;
        connection.execute(
            "DELETE FROM workspace_enrollments WHERE id = ?1",
            [workspace_id.to_string()],
        )?;
        Ok(())
    }

    pub fn load_workspaces(&self) -> Result<Vec<Workspace>, StorageError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| StorageError::LockPoisoned)?;
        let mut statement = connection.prepare(
            "SELECT id, root, repository_identity, excluded_paths, revoked
             FROM workspace_enrollments
             WHERE committed = 1",
        )?;
        let rows = statement.query_map([], |row| {
            let id: String = row.get(0)?;
            let root: String = row.get(1)?;
            let repository_identity: String = row.get(2)?;
            let excluded_paths: String = row.get(3)?;
            let revoked: bool = row.get(4)?;
            Ok((id, root, repository_identity, excluded_paths, revoked))
        })?;
        let mut workspaces = Vec::new();
        for row in rows {
            let (id, root, repository_identity, excluded_paths, revoked) = row?;
            let Ok(id) = Uuid::parse_str(&id) else {
                continue;
            };
            workspaces.push(Workspace {
                id,
                root: root.into(),
                repository_identity,
                excluded_paths: serde_json::from_str(&excluded_paths)?,
                revoked,
            });
        }
        Ok(workspaces)
    }

    pub fn model_egress_mode(&self) -> Result<String, StorageError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| StorageError::LockPoisoned)?;
        let value = connection
            .query_row(
                "SELECT value FROM runtime_settings WHERE key = 'model_egress'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        Ok(value.unwrap_or_else(|| "disabled".to_owned()))
    }

    pub fn set_model_egress_mode(&self, mode: &str) -> Result<String, StorageError> {
        if !matches!(mode, "managed_api" | "user_provided_api" | "disabled") {
            return Err(StorageError::InvalidSetting(
                "model egress mode is unsupported".to_owned(),
            ));
        }
        let connection = self
            .connection
            .lock()
            .map_err(|_| StorageError::LockPoisoned)?;
        connection.execute(
            "INSERT INTO runtime_settings (key, value, updated_at)
             VALUES ('model_egress', ?1, CAST(strftime('%s', 'now') AS INTEGER) * 1000)
             ON CONFLICT(key) DO UPDATE SET
               value = excluded.value,
               updated_at = excluded.updated_at",
            [mode],
        )?;
        Ok(mode.to_owned())
    }

    pub fn enqueue_representative_request(&self, request: &Value) -> Result<bool, StorageError> {
        let request_id = request
            .get("requestId")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let method = request
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let queued_at = request
            .get("queuedAt")
            .and_then(Value::as_u64)
            .unwrap_or_default();
        let connection = self
            .connection
            .lock()
            .map_err(|_| StorageError::LockPoisoned)?;
        let inserted = connection.execute(
            "INSERT OR IGNORE INTO representative_requests
             (request_id, method, params, queued_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                request_id,
                method,
                serde_json::to_string(&request["params"])?,
                i64::try_from(queued_at).unwrap_or(i64::MAX)
            ],
        )?;
        Ok(inserted == 1)
    }

    pub fn next_representative_request(&self) -> Result<Option<Value>, StorageError> {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| StorageError::LockPoisoned)?;
        let transaction = connection.transaction()?;
        let next = {
            let mut statement = transaction.prepare(
                "SELECT request_id, method, params, queued_at
                 FROM representative_requests
                 WHERE completed_at IS NULL
                   AND (
                     consumed_at IS NULL
                     OR consumed_at < (CAST(strftime('%s', 'now') AS INTEGER) - 30) * 1000
                   )
                 ORDER BY queued_at, request_id
                 LIMIT 1",
            )?;
            statement
                .query_row([], |row| {
                    let request_id: String = row.get(0)?;
                    let method: String = row.get(1)?;
                    let params: String = row.get(2)?;
                    let queued_at: i64 = row.get(3)?;
                    Ok((request_id, method, params, queued_at))
                })
                .optional()?
        };
        let Some((request_id, method, params, queued_at)) = next else {
            transaction.commit()?;
            return Ok(None);
        };
        transaction.execute(
            "UPDATE representative_requests
             SET consumed_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
             WHERE request_id = ?1 AND completed_at IS NULL",
            [&request_id],
        )?;
        transaction.commit()?;
        Ok(Some(serde_json::json!({
            "requestId": request_id,
            "method": method,
            "params": serde_json::from_str::<Value>(&params)?,
            "queuedAt": queued_at,
        })))
    }

    pub fn acknowledge_representative_request(
        &self,
        request_id: &str,
    ) -> Result<bool, StorageError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| StorageError::LockPoisoned)?;
        let updated = connection.execute(
            "UPDATE representative_requests
             SET completed_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
             WHERE request_id = ?1 AND completed_at IS NULL",
            [request_id],
        )?;
        Ok(updated == 1)
    }

    pub fn complete_representative_request(
        &self,
        request_id: &str,
        result: &Value,
    ) -> Result<bool, StorageError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| StorageError::LockPoisoned)?;
        let updated = connection.execute(
            "UPDATE representative_requests
             SET result_json = ?2,
                 completed_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
             WHERE request_id = ?1 AND completed_at IS NULL",
            params![request_id, serde_json::to_string(result)?],
        )?;
        Ok(updated == 1)
    }

    pub fn representative_request_result(
        &self,
        request_id: &str,
    ) -> Result<Option<Value>, StorageError> {
        self.representative_request_result_for_workspace(request_id, None)
    }

    pub fn representative_request_result_for_workspace(
        &self,
        request_id: &str,
        workspace_id: Option<Uuid>,
    ) -> Result<Option<Value>, StorageError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| StorageError::LockPoisoned)?;
        let row = connection
            .query_row(
                "SELECT params, consumed_at, completed_at, result_json
                 FROM representative_requests
                 WHERE request_id = ?1",
                [request_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<i64>>(1)?,
                        row.get::<_, Option<i64>>(2)?,
                        row.get::<_, Option<String>>(3)?,
                    ))
                },
            )
            .optional()?;
        let Some((params_json, consumed_at, completed_at, result_json)) = row else {
            return Ok(None);
        };
        if let Some(workspace_id) = workspace_id {
            let params = serde_json::from_str::<Value>(&params_json)?;
            let expected_workspace_id = workspace_id.to_string();
            if params.get("workspaceId").and_then(Value::as_str)
                != Some(expected_workspace_id.as_str())
            {
                return Ok(None);
            }
        }
        if completed_at.is_some() {
            return Ok(Some(serde_json::json!({
                "status": "completed",
                "result": result_json
                    .map(|value| serde_json::from_str::<Value>(&value))
                    .transpose()?
                    .unwrap_or_else(|| serde_json::json!({ "acknowledged": true })),
            })));
        }
        Ok(Some(serde_json::json!({
            "status": if consumed_at.is_some() { "processing" } else { "queued" },
        })))
    }

    pub fn list_events(&self, limit: usize) -> Result<Vec<Value>, StorageError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| StorageError::LockPoisoned)?;
        let mut statement = connection.prepare(
            "SELECT safe_payload FROM canonical_events
             ORDER BY created_at, id
             LIMIT ?1",
        )?;
        let rows = statement.query_map([i64::try_from(limit).unwrap_or(i64::MAX)], |row| {
            row.get::<_, String>(0)
        })?;
        let mut events = Vec::new();
        for row in rows {
            events.push(serde_json::from_str(&row?)?);
        }
        Ok(events)
    }

    pub fn put_memory(
        &self,
        workspace_id: Uuid,
        object_id: &str,
        object_type: &str,
        title: &str,
        summary: &str,
    ) -> Result<(), StorageError> {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| StorageError::LockPoisoned)?;
        let transaction = connection.transaction()?;
        transaction.execute(
            "DELETE FROM memory_fts_v2
             WHERE workspace_id = ?1 AND object_id = ?2",
            params![workspace_id.to_string(), object_id],
        )?;
        transaction.execute(
            "INSERT INTO memory_fts_v2
             (workspace_id, object_id, object_type, title, summary)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                workspace_id.to_string(),
                object_id,
                object_type,
                title,
                summary
            ],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn search_memory(
        &self,
        workspace_id: Uuid,
        query: &str,
        limit: usize,
    ) -> Result<Vec<Value>, StorageError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| StorageError::LockPoisoned)?;
        let match_query = query
            .split_whitespace()
            .filter(|token| !token.is_empty())
            .map(|token| format!("\"{}\"", token.replace('"', "\"\"")))
            .collect::<Vec<_>>()
            .join(" AND ");
        if match_query.is_empty() {
            return Ok(Vec::new());
        }
        let mut statement = connection.prepare(
            "SELECT object_id, object_type, title, summary
             FROM memory_fts_v2
             WHERE memory_fts_v2 MATCH ?1 AND workspace_id = ?2
             ORDER BY bm25(memory_fts_v2)
             LIMIT ?3",
        )?;
        let rows = statement.query_map(
            params![
                match_query,
                workspace_id.to_string(),
                i64::try_from(limit.min(50)).unwrap_or(50)
            ],
            |row| {
                Ok(serde_json::json!({
                    "objectId": row.get::<_, String>(0)?,
                    "objectType": row.get::<_, String>(1)?,
                    "title": row.get::<_, String>(2)?,
                    "summary": row.get::<_, String>(3)?,
                }))
            },
        )?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn resolve_integration_workstream(
        &self,
        session_key: &str,
        workspace_id: Uuid,
    ) -> Result<Uuid, StorageError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| StorageError::LockPoisoned)?;
        let existing = connection
            .query_row(
                "SELECT workstream_id FROM integration_sessions
                 WHERE session_key = ?1 AND workspace_id = ?2",
                params![session_key, workspace_id.to_string()],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if let Some(existing) = existing.and_then(|value| Uuid::parse_str(&value).ok()) {
            connection.execute(
                "UPDATE integration_sessions
                 SET active = 1,
                     lifecycle_state = 'active',
                     last_seen_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                 WHERE session_key = ?1 AND workspace_id = ?2",
                params![session_key, workspace_id.to_string()],
            )?;
            return Ok(existing);
        }
        let workstream_id = Uuid::now_v7();
        connection.execute(
            "INSERT INTO integration_sessions
             (session_key, workspace_id, workstream_id, created_at, active, last_seen_at, lifecycle_state)
             VALUES (
               ?1, ?2, ?3,
               CAST(strftime('%s', 'now') AS INTEGER) * 1000,
               1,
               CAST(strftime('%s', 'now') AS INTEGER) * 1000,
               'active'
             )
             ON CONFLICT(session_key) DO UPDATE SET
               workspace_id = excluded.workspace_id,
               workstream_id = excluded.workstream_id,
               active = 1,
               lifecycle_state = 'active',
               last_seen_at = excluded.last_seen_at",
            params![
                session_key,
                workspace_id.to_string(),
                workstream_id.to_string()
            ],
        )?;
        Ok(workstream_id)
    }

    pub fn ingest_lifecycle_request(
        &self,
        session_key: &str,
        workspace_id: Uuid,
        lifecycle_state: &str,
        request_id: &str,
        mut request_params: Value,
        queued_at: u64,
    ) -> Result<(Uuid, bool), StorageError> {
        if !matches!(lifecycle_state, "active" | "paused" | "ended") {
            return Err(StorageError::InvalidSetting(
                "integration lifecycle state is unsupported".into(),
            ));
        }
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| StorageError::LockPoisoned)?;
        let transaction = connection.transaction()?;
        let existing = transaction
            .query_row(
                "SELECT workstream_id FROM integration_sessions
                 WHERE session_key = ?1 AND workspace_id = ?2",
                params![session_key, workspace_id.to_string()],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        let fallback = if existing.is_none() && lifecycle_state == "active" {
            let source = session_key
                .split_once(':')
                .map_or(session_key, |(source, _)| source);
            let mcp_prefix = format!("{source}:mcp:%");
            let candidates = {
                let mut statement = transaction.prepare(
                    "SELECT DISTINCT workstream_id
                     FROM integration_sessions
                     WHERE workspace_id = ?1
                       AND lifecycle_state = 'mcp'
                       AND session_key LIKE ?2
                     ORDER BY workstream_id",
                )?;
                statement
                    .query_map(params![workspace_id.to_string(), mcp_prefix], |row| {
                        row.get::<_, String>(0)
                    })?
                    .filter_map(Result::ok)
                    .filter_map(|value| Uuid::parse_str(&value).ok())
                    .collect::<Vec<_>>()
            };
            (candidates.len() == 1).then(|| candidates[0])
        } else {
            None
        };
        let workstream_id = existing
            .and_then(|value| Uuid::parse_str(&value).ok())
            .or(fallback)
            .unwrap_or_else(Uuid::now_v7);
        transaction.execute(
            "INSERT INTO integration_sessions
             (session_key, workspace_id, workstream_id, created_at, active, last_seen_at, lifecycle_state)
             VALUES (
               ?1, ?2, ?3,
               CAST(strftime('%s', 'now') AS INTEGER) * 1000,
               ?4,
               CAST(strftime('%s', 'now') AS INTEGER) * 1000,
               ?5
             )
             ON CONFLICT(session_key) DO UPDATE SET
               workspace_id = excluded.workspace_id,
               active = excluded.active,
               last_seen_at = excluded.last_seen_at,
               lifecycle_state = excluded.lifecycle_state",
            params![
                session_key,
                workspace_id.to_string(),
                workstream_id.to_string(),
                i32::from(lifecycle_state == "active"),
                lifecycle_state,
            ],
        )?;
        if let Some(fallback) = fallback {
            transaction.execute(
                "UPDATE integration_sessions
                 SET lifecycle_state = 'bound_mcp',
                     last_seen_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                 WHERE workspace_id = ?1
                   AND workstream_id = ?2
                   AND lifecycle_state = 'mcp'",
                params![workspace_id.to_string(), fallback.to_string()],
            )?;
        }
        let Some(params_object) = request_params.as_object_mut() else {
            return Err(StorageError::InvalidSetting(
                "lifecycle request params must be an object".into(),
            ));
        };
        params_object.insert(
            "workspaceId".into(),
            Value::String(workspace_id.to_string()),
        );
        params_object.insert(
            "workstreamId".into(),
            Value::String(workstream_id.to_string()),
        );
        let inserted = transaction.execute(
            "INSERT OR IGNORE INTO representative_requests
             (request_id, method, params, queued_at)
             VALUES (?1, 'representative.ingest_adapter_event', ?2, ?3)",
            params![
                request_id,
                serde_json::to_string(&request_params)?,
                i64::try_from(queued_at).unwrap_or(i64::MAX),
            ],
        )?;
        transaction.commit()?;
        Ok((workstream_id, inserted == 1))
    }

    pub fn resolve_mcp_integration_workstream(
        &self,
        source: &str,
        client_session_id: &str,
        workspace_id: Uuid,
    ) -> Result<(String, Uuid), StorageError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| StorageError::LockPoisoned)?;
        let session_key = format!("{source}:mcp:{client_session_id}");
        let vendor_prefix = format!("{source}:%");
        let mcp_prefix = format!("{source}:mcp:%");
        let existing = connection
            .query_row(
                "SELECT workstream_id, lifecycle_state
                 FROM integration_sessions
                 WHERE session_key = ?1 AND workspace_id = ?2",
                params![session_key, workspace_id.to_string()],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?;
        for state in if source == "opencode" {
            ["active", "paused"].as_slice()
        } else {
            ["active"].as_slice()
        } {
            let candidates = {
                let mut statement = connection.prepare(
                    "SELECT DISTINCT workstream_id
                     FROM integration_sessions
                     WHERE workspace_id = ?1
                       AND lifecycle_state = ?2
                       AND session_key LIKE ?3
                       AND session_key NOT LIKE ?4
                     ORDER BY workstream_id",
                )?;
                statement
                    .query_map(
                        params![workspace_id.to_string(), state, vendor_prefix, mcp_prefix],
                        |row| row.get::<_, String>(0),
                    )?
                    .filter_map(Result::ok)
                    .filter_map(|value| Uuid::parse_str(&value).ok())
                    .collect::<Vec<_>>()
            };
            if candidates.len() > 1 {
                return Err(StorageError::AmbiguousIntegrationContext);
            }
            if let Some(workstream_id) = candidates.first().copied() {
                if existing.as_ref().is_some_and(|(existing_id, _)| {
                    Uuid::parse_str(existing_id).ok() == Some(workstream_id)
                }) {
                    connection.execute(
                        "UPDATE integration_sessions
                         SET lifecycle_state = 'bound_mcp',
                             last_seen_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
                         WHERE session_key = ?1 AND workspace_id = ?2",
                        params![session_key, workspace_id.to_string()],
                    )?;
                    return Ok((session_key, workstream_id));
                }
                let already_bound = connection.query_row(
                    "SELECT COUNT(*)
                     FROM integration_sessions
                     WHERE workspace_id = ?1
                       AND workstream_id = ?2
                       AND lifecycle_state = 'bound_mcp'
                       AND session_key LIKE ?3
                       AND session_key != ?4",
                    params![
                        workspace_id.to_string(),
                        workstream_id.to_string(),
                        mcp_prefix,
                        session_key
                    ],
                    |row| row.get::<_, i64>(0),
                )?;
                if already_bound > 0 {
                    return Err(StorageError::AmbiguousIntegrationContext);
                }
                connection.execute(
                    "INSERT INTO integration_sessions
                     (session_key, workspace_id, workstream_id, created_at, active, last_seen_at, lifecycle_state)
                     VALUES (
                       ?1, ?2, ?3,
                       CAST(strftime('%s', 'now') AS INTEGER) * 1000,
                       0,
                       CAST(strftime('%s', 'now') AS INTEGER) * 1000,
                       'bound_mcp'
                     )
                     ON CONFLICT(session_key) DO UPDATE SET
                       workspace_id = excluded.workspace_id,
                       workstream_id = excluded.workstream_id,
                       active = 0,
                       last_seen_at = excluded.last_seen_at,
                       lifecycle_state = 'bound_mcp'",
                    params![
                        session_key,
                        workspace_id.to_string(),
                        workstream_id.to_string()
                    ],
                )?;
                return Ok((session_key, workstream_id));
            }
        }

        if let Some((existing_id, existing_state)) = &existing
            && existing_state == "mcp"
            && let Ok(workstream_id) = Uuid::parse_str(existing_id)
        {
            return Ok((session_key, workstream_id));
        }
        let workstream_id = Uuid::now_v7();
        connection.execute(
            "INSERT INTO integration_sessions
             (session_key, workspace_id, workstream_id, created_at, active, last_seen_at, lifecycle_state)
             VALUES (
               ?1, ?2, ?3,
               CAST(strftime('%s', 'now') AS INTEGER) * 1000,
               0,
               CAST(strftime('%s', 'now') AS INTEGER) * 1000,
               'mcp'
             )
             ON CONFLICT(session_key) DO UPDATE SET
               workspace_id = excluded.workspace_id,
               workstream_id = excluded.workstream_id,
               active = 0,
               last_seen_at = excluded.last_seen_at,
               lifecycle_state = 'mcp'",
            params![
                session_key,
                workspace_id.to_string(),
                workstream_id.to_string()
            ],
        )?;
        Ok((session_key, workstream_id))
    }
}

fn hex_key(encoded: &str) -> String {
    STANDARD
        .decode(encoded)
        .unwrap_or_default()
        .iter()
        .fold(String::new(), |mut output, byte| {
            let _ = write!(output, "{byte:02x}");
            output
        })
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;
    use uuid::Uuid;

    use super::{CredentialStore, EncryptedStore, StorageError};
    use crate::workspace::WorkspaceRegistry;

    struct TestCredentials;

    impl CredentialStore for TestCredentials {
        fn load_or_create_database_key(&self) -> Result<String, StorageError> {
            Ok("dGVzdC1rZXktZm9yLWludGVybw==".into())
        }
    }

    #[test]
    fn restores_workspaces_and_pending_requests_after_reopen() {
        let directory = tempdir().expect("storage fixture");
        let path = directory.path().join("intero.db");
        let workspace_root = directory.path().join("workspace");
        std::fs::create_dir(&workspace_root).expect("workspace root");
        let workspace = WorkspaceRegistry::default()
            .enroll(&workspace_root, "repo:test".into())
            .expect("enroll workspace");
        let operation_id = Uuid::now_v7();

        {
            let store = EncryptedStore::open(&path, &TestCredentials).expect("open database");
            store
                .upsert_workspace(&workspace)
                .expect("persist workspace");
            assert!(
                store
                    .enqueue_representative_request(&serde_json::json!({
                        "requestId": operation_id,
                        "method": "representative.report_checkpoint",
                        "params": { "workspaceId": workspace.id },
                        "queuedAt": 1,
                    }))
                    .expect("persist request")
            );
        }

        let reopened = EncryptedStore::open(&path, &TestCredentials).expect("reopen database");
        let workspaces = reopened.load_workspaces().expect("restore workspaces");
        assert_eq!(workspaces.len(), 1);
        assert_eq!(workspaces[0].id, workspace.id);
        let pending = reopened
            .next_representative_request()
            .expect("read request")
            .expect("pending request");
        assert_eq!(pending["requestId"], operation_id.to_string());
        assert!(
            reopened
                .next_representative_request()
                .expect("queue remains readable")
                .is_none()
        );
        assert!(
            reopened
                .complete_representative_request(
                    &operation_id.to_string(),
                    &serde_json::json!({ "accepted": true }),
                )
                .expect("complete request")
        );
        let result = reopened
            .representative_request_result(&operation_id.to_string())
            .expect("request result")
            .expect("stored request");
        assert_eq!(result["status"], "completed");
        assert_eq!(result["result"]["accepted"], true);
    }

    #[test]
    fn ignores_and_discards_interrupted_workspace_enrollments() {
        let directory = tempdir().expect("storage fixture");
        let path = directory.path().join("intero.db");
        let workspace_root = directory.path().join("pending-workspace");
        std::fs::create_dir(&workspace_root).expect("workspace root");
        let workspace = WorkspaceRegistry::default()
            .prepare_enrollment(&workspace_root, "repo:pending".into())
            .expect("prepare enrollment");
        let store = EncryptedStore::open(&path, &TestCredentials).expect("open database");
        store
            .stage_workspace(&workspace)
            .expect("stage workspace enrollment");

        assert!(store.load_workspaces().expect("load committed").is_empty());
        store
            .discard_pending_workspaces()
            .expect("discard pending enrollment");
        store
            .stage_workspace(&workspace)
            .expect("stage same root again after cleanup");
        store
            .commit_workspace(workspace.id)
            .expect("commit workspace");
        assert_eq!(store.load_workspaces().expect("load committed").len(), 1);
    }

    #[test]
    fn searches_structured_memory_only_inside_its_workspace() {
        let directory = tempdir().expect("storage fixture");
        let path = directory.path().join("intero.db");
        let store = EncryptedStore::open(&path, &TestCredentials).expect("open database");
        let workspace_id = Uuid::now_v7();
        let other_workspace_id = Uuid::now_v7();
        store
            .put_memory(
                workspace_id,
                "decision:cursor",
                "decision",
                "Cursor recovery",
                "Repair missing Centrifugo sequences through the Activity cursor.",
            )
            .expect("index memory");

        let matches = store
            .search_memory(workspace_id, "missing sequences", 10)
            .expect("search memory");
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0]["objectId"], "decision:cursor");
        assert!(
            store
                .search_memory(other_workspace_id, "missing sequence", 10)
                .expect("search other workspace")
                .is_empty()
        );
    }

    #[test]
    fn persists_only_supported_model_egress_modes() {
        let directory = tempdir().expect("storage fixture");
        let path = directory.path().join("intero.db");
        {
            let store = EncryptedStore::open(&path, &TestCredentials).expect("open database");
            assert_eq!(store.model_egress_mode().expect("default mode"), "disabled");
            assert_eq!(
                store
                    .set_model_egress_mode("managed_api")
                    .expect("persist mode"),
                "managed_api"
            );
            assert!(store.set_model_egress_mode("unbounded").is_err());
            assert_eq!(
                store.model_egress_mode().expect("unchanged mode"),
                "managed_api"
            );
        }
        let reopened = EncryptedStore::open(&path, &TestCredentials).expect("reopen database");
        assert_eq!(
            reopened.model_egress_mode().expect("restored mode"),
            "managed_api"
        );
    }

    #[test]
    fn reconciles_a_single_mcp_fallback_when_lifecycle_arrives_late() {
        let directory = tempdir().expect("storage fixture");
        let path = directory.path().join("intero.db");
        let store = EncryptedStore::open(&path, &TestCredentials).expect("open database");
        let workspace_id = Uuid::now_v7();
        let (_, fallback) = store
            .resolve_mcp_integration_workstream("opencode", "mcp-client", workspace_id)
            .expect("create MCP fallback");

        let (lifecycle, inserted) = store
            .ingest_lifecycle_request(
                "opencode:vendor-session",
                workspace_id,
                "active",
                "late-session-start",
                serde_json::json!({}),
                1,
            )
            .expect("ingest lifecycle");

        assert!(inserted);
        assert_eq!(lifecycle, fallback);

        store
            .ingest_lifecycle_request(
                "opencode:vendor-session",
                workspace_id,
                "ended",
                "first-session-end",
                serde_json::json!({}),
                2,
            )
            .expect("end first lifecycle");
        let (_, second_fallback) = store
            .resolve_mcp_integration_workstream("opencode", "mcp-client", workspace_id)
            .expect("rebind the persistent MCP process to a second fallback");
        let (second_lifecycle, _) = store
            .ingest_lifecycle_request(
                "opencode:vendor-session-2",
                workspace_id,
                "active",
                "second-session-start",
                serde_json::json!({}),
                3,
            )
            .expect("ingest second lifecycle");

        assert_ne!(second_fallback, fallback);
        assert_eq!(second_lifecycle, second_fallback);
    }
}
