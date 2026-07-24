use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::mls::{OpenMlsDevice, OpenMlsInvitation};
use crate::storage::EncryptedStore;
use crate::workspace::WorkspaceRegistry;
use crate::workspace_tools;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RpcRole {
    Administrator,
    HookIngress,
    Mcp,
    Sidecar,
}

#[derive(Clone)]
pub struct RpcTokens {
    pub administrator: String,
    pub hook_ingress: String,
    pub mcp: String,
    pub sidecar: String,
}

impl RpcTokens {
    #[must_use]
    pub fn administrator_only(token: String) -> Self {
        Self {
            administrator: token.clone(),
            hook_ingress: token.clone(),
            mcp: token.clone(),
            sidecar: token,
        }
    }

    fn role_for(&self, token: &str) -> Option<RpcRole> {
        if token == self.administrator {
            Some(RpcRole::Administrator)
        } else if token == self.hook_ingress {
            Some(RpcRole::HookIngress)
        } else if token == self.mcp {
            Some(RpcRole::Mcp)
        } else if token == self.sidecar {
            Some(RpcRole::Sidecar)
        } else {
            None
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub id: Value,
    pub method: String,
    #[serde(default)]
    pub params: Value,
    pub auth_token: String,
}

#[derive(Debug, Serialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: &'static str,
    pub id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
}

#[derive(Debug, Serialize)]
pub struct JsonRpcError {
    pub code: i32,
    pub message: String,
}

fn role_allows(role: RpcRole, method: &str) -> bool {
    match role {
        RpcRole::Administrator => true,
        RpcRole::HookIngress => matches!(method, "system.health" | "integration.ingest_lifecycle"),
        RpcRole::Mcp => matches!(
            method,
            "system.health"
                | "integration.current_context"
                | "representative.lookup_team_context"
                | "representative.request_coordination"
                | "representative.request_spec_review"
                | "representative.lookup_decision"
                | "representative.check_scope"
                | "representative.report_checkpoint"
                | "representative.request_result"
        ),
        RpcRole::Sidecar => matches!(
            method,
            "system.health"
                | "settings.get"
                | "state.list_events"
                | "state.persist_event"
                | "representative.next_request"
                | "representative.ack_request"
                | "representative.complete_request"
        ),
    }
}

fn is_integration_source(source: &str) -> bool {
    matches!(source, "codex" | "claude-code" | "opencode")
}

fn valid_adapter_event_request(params: &Value) -> bool {
    const ALLOWED_FIELDS: &[&str] = &[
        "workspaceId",
        "workstreamId",
        "source",
        "sourceEvent",
        "sessionId",
        "eventId",
        "occurredAt",
        "metadata",
    ];
    let Some(object) = params.as_object() else {
        return false;
    };
    if object
        .keys()
        .any(|key| !ALLOWED_FIELDS.contains(&key.as_str()))
    {
        return false;
    }
    let source = object.get("source").and_then(Value::as_str);
    let source_event = object.get("sourceEvent").and_then(Value::as_str);
    let valid_event = match source {
        Some("codex" | "claude-code") => {
            matches!(source_event, Some("SessionStart" | "SessionEnd"))
        }
        Some("opencode") => matches!(
            source_event,
            Some("session.created" | "session.idle" | "session.deleted")
        ),
        _ => false,
    };
    if !valid_event
        || parse_workspace_id(params).is_none()
        || object
            .get("workstreamId")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
            .is_none()
        || object
            .get("occurredAt")
            .and_then(Value::as_str)
            .is_none_or(|value| value.len() > 40)
    {
        return false;
    }
    match object.get("metadata") {
        None => true,
        Some(Value::Object(metadata)) => {
            let checkpoint = metadata.get("checkpointKind").and_then(Value::as_str);
            let expected_checkpoint = match source_event {
                Some("SessionEnd" | "session.idle" | "session.deleted") => Some("pause"),
                _ => None,
            };
            metadata.len() <= 2
                && metadata
                    .keys()
                    .all(|key| key == "phase" || key == "checkpointKind")
                && metadata.values().all(|value| {
                    value
                        .as_str()
                        .is_some_and(|value| !value.is_empty() && value.len() <= 80)
                })
                && checkpoint == expected_checkpoint
        }
        Some(_) => false,
    }
}

fn valid_lifecycle_ingress_request(params: &Value) -> bool {
    const ALLOWED_FIELDS: &[&str] = &[
        "cwd",
        "source",
        "sourceEvent",
        "sessionId",
        "eventId",
        "occurredAt",
        "metadata",
    ];
    let Some(object) = params.as_object() else {
        return false;
    };
    if object
        .keys()
        .any(|key| !ALLOWED_FIELDS.contains(&key.as_str()))
    {
        return false;
    }
    let bounded_string = |field: &str, maximum: usize| {
        object
            .get(field)
            .and_then(Value::as_str)
            .is_some_and(|value| !value.is_empty() && value.len() <= maximum)
    };
    if !bounded_string("cwd", 4_096)
        || !bounded_string("source", 32)
        || !bounded_string("sourceEvent", 80)
        || !bounded_string("sessionId", 240)
        || !bounded_string("occurredAt", 40)
        || object
            .get("eventId")
            .is_some_and(|_| !bounded_string("eventId", 240))
    {
        return false;
    }
    let mut internal = object.clone();
    internal.remove("cwd");
    internal.insert("workspaceId".into(), Value::String(Uuid::nil().to_string()));
    internal.insert(
        "workstreamId".into(),
        Value::String(Uuid::nil().to_string()),
    );
    valid_adapter_event_request(&Value::Object(internal))
}

fn lifecycle_session_state(source_event: &str) -> &'static str {
    match source_event {
        "SessionStart" | "session.created" => "active",
        "session.idle" => "paused",
        _ => "ended",
    }
}

#[derive(Clone)]
pub struct RpcService {
    auth_tokens: RpcTokens,
    workspaces: WorkspaceRegistry,
    pending_requests: Arc<Mutex<VecDeque<Value>>>,
    durable_store: Option<EncryptedStore>,
    mls_device: Arc<Mutex<Option<OpenMlsDevice>>>,
}

impl RpcService {
    #[must_use]
    pub fn new(auth_token: String, workspaces: WorkspaceRegistry) -> Self {
        Self {
            auth_tokens: RpcTokens::administrator_only(auth_token),
            workspaces,
            pending_requests: Arc::new(Mutex::new(VecDeque::new())),
            durable_store: None,
            mls_device: Arc::new(Mutex::new(None)),
        }
    }

    #[must_use]
    pub fn new_durable(
        auth_token: String,
        workspaces: WorkspaceRegistry,
        durable_store: EncryptedStore,
    ) -> Self {
        Self::new_durable_with_tokens(
            RpcTokens::administrator_only(auth_token),
            workspaces,
            durable_store,
        )
    }

    #[must_use]
    pub fn new_durable_with_tokens(
        auth_tokens: RpcTokens,
        workspaces: WorkspaceRegistry,
        durable_store: EncryptedStore,
    ) -> Self {
        Self {
            auth_tokens,
            workspaces,
            pending_requests: Arc::new(Mutex::new(VecDeque::new())),
            durable_store: Some(durable_store),
            mls_device: Arc::new(Mutex::new(None)),
        }
    }

    #[must_use]
    pub fn auth_token(&self) -> &str {
        &self.auth_tokens.administrator
    }

    #[must_use]
    pub fn auth_tokens(&self) -> &RpcTokens {
        &self.auth_tokens
    }

    pub fn handle(&self, request: JsonRpcRequest) -> JsonRpcResponse {
        if request.jsonrpc != "2.0" {
            return error(request.id, -32600, "Only JSON-RPC 2.0 is supported");
        }
        let Some(role) = self.auth_tokens.role_for(&request.auth_token) else {
            return error(request.id, -32001, "Local authentication failed");
        };
        if !role_allows(role, &request.method) {
            return error(
                request.id,
                -32002,
                "Local capability does not allow this method",
            );
        }
        match request.method.as_str() {
            "system.health" => success(
                request.id,
                json!({
                    "status": "ok",
                    "version": env!("CARGO_PKG_VERSION"),
                    "protocolVersion": 1,
                    "encryptedStorage": self.durable_store.is_some(),
                }),
            ),
            "workspace.list" => match self.workspaces.list() {
                Ok(workspaces) => success(
                    request.id,
                    json!({
                        "workspaces": workspaces.into_iter().map(|workspace| json!({
                            "id": workspace.id,
                            "root": workspace.root,
                            "repositoryIdentity": workspace.repository_identity,
                            "revoked": workspace.revoked,
                        })).collect::<Vec<_>>()
                    }),
                ),
                Err(reason) => error(request.id, -32050, &reason.to_string()),
            },
            "workspace.enroll" => {
                let root = request.params.get("root").and_then(Value::as_str);
                let identity = request
                    .params
                    .get("repositoryIdentity")
                    .and_then(Value::as_str);
                match (root, identity) {
                    (Some(root), Some(identity)) => match self
                        .workspaces
                        .prepare_enrollment(&PathBuf::from(root), identity.to_owned())
                    {
                        Ok(workspace) => {
                            if let Some(store) = &self.durable_store
                                && let Err(reason) = store.stage_workspace(&workspace)
                            {
                                return error(request.id, -32050, &reason.to_string());
                            }
                            if let Some(store) = &self.durable_store
                                && let Err(reason) = store.commit_workspace(workspace.id)
                            {
                                let _ = store.delete_workspace(workspace.id);
                                return error(request.id, -32050, &reason.to_string());
                            }
                            if let Err(reason) = self.workspaces.commit_enrollment(&workspace) {
                                if let Some(store) = &self.durable_store {
                                    let _ = store.mark_workspace_pending(workspace.id);
                                    let _ = store.delete_workspace(workspace.id);
                                }
                                return error(request.id, -32010, &reason.to_string());
                            }
                            success(
                                request.id,
                                json!({ "workspaceId": workspace.id, "root": workspace.root }),
                            )
                        }
                        Err(reason) => error(request.id, -32010, &reason.to_string()),
                    },
                    _ => error(
                        request.id,
                        -32602,
                        "root and repositoryIdentity are required",
                    ),
                }
            }
            "workspace.authorize_read" => {
                let workspace_id = request
                    .params
                    .get("workspaceId")
                    .and_then(Value::as_str)
                    .and_then(|value| Uuid::parse_str(value).ok());
                let path = request.params.get("path").and_then(Value::as_str);
                match (workspace_id, path) {
                    (Some(workspace_id), Some(path)) => match self
                        .workspaces
                        .authorize_read(workspace_id, &PathBuf::from(path))
                    {
                        Ok(authorized) => success(request.id, json!({ "path": authorized })),
                        Err(reason) => error(request.id, -32011, &reason.to_string()),
                    },
                    _ => error(request.id, -32602, "workspaceId and path are required"),
                }
            }
            "workspace.read_text" => self.workspace_path_call(request, workspace_tools::read_text),
            "workspace.list_files" => {
                self.workspace_path_call(request, workspace_tools::list_files)
            }
            "workspace.search_literal" => {
                let workspace_id = parse_workspace_id(&request.params);
                let path = request
                    .params
                    .get("path")
                    .and_then(Value::as_str)
                    .unwrap_or(".");
                let query = request.params.get("query").and_then(Value::as_str);
                match (workspace_id, query) {
                    (Some(workspace_id), Some(query)) => match workspace_tools::search_literal(
                        &self.workspaces,
                        workspace_id,
                        &PathBuf::from(path),
                        query,
                    ) {
                        Ok(result) => success(request.id, result),
                        Err(reason) => error(request.id, -32011, &reason.to_string()),
                    },
                    _ => error(request.id, -32602, "workspaceId and query are required"),
                }
            }
            "integration.ingest_lifecycle" => {
                if !valid_lifecycle_ingress_request(&request.params) {
                    return error(
                        request.id,
                        -32602,
                        "Lifecycle event does not match the closed ingress schema",
                    );
                }
                let (Some(cwd), Some(source), Some(source_event), Some(session_id)) = (
                    request.params.get("cwd").and_then(Value::as_str),
                    request.params.get("source").and_then(Value::as_str),
                    request.params.get("sourceEvent").and_then(Value::as_str),
                    request.params.get("sessionId").and_then(Value::as_str),
                ) else {
                    return error(request.id, -32602, "Lifecycle event fields are required");
                };
                let cwd = cwd.to_owned();
                let source = source.to_owned();
                let source_event = source_event.to_owned();
                let session_id = session_id.to_owned();
                let Some(store) = &self.durable_store else {
                    return error(request.id, -32050, "Durable state is unavailable");
                };
                let workspace = match self.workspaces.resolve_for_path(&PathBuf::from(cwd)) {
                    Ok(workspace) => workspace,
                    Err(reason) => return error(request.id, -32012, &reason.to_string()),
                };
                let session_key = format!("{source}:{session_id}");
                let mut params = request.params;
                let Some(object) = params.as_object_mut() else {
                    return error(request.id, -32602, "Lifecycle params must be an object");
                };
                object.remove("cwd");
                if contains_forbidden_field(&params) {
                    return error(
                        request.id,
                        -32602,
                        "Lifecycle event contains a forbidden raw-content field",
                    );
                }
                let request_id = Uuid::now_v7().to_string();
                let queued_at = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_or(0, |duration| duration.as_millis())
                    .try_into()
                    .unwrap_or(u64::MAX);
                match store.ingest_lifecycle_request(
                    &session_key,
                    workspace.id,
                    lifecycle_session_state(&source_event),
                    &request_id,
                    params,
                    queued_at,
                ) {
                    Ok((_workstream_id, inserted)) => success(
                        request.id,
                        json!({
                            "accepted": true,
                            "queued": true,
                            "duplicate": !inserted,
                            "requestId": request_id,
                        }),
                    ),
                    Err(reason) => error(request.id, -32050, &reason.to_string()),
                }
            }
            "integration.current_context" => {
                let cwd = request.params.get("cwd").and_then(Value::as_str);
                let source = request.params.get("source").and_then(Value::as_str);
                let client_session_id = request
                    .params
                    .get("clientSessionId")
                    .and_then(Value::as_str);
                match (&self.durable_store, cwd, source, client_session_id) {
                    (Some(store), Some(cwd), Some(source), Some(client_session_id))
                        if is_integration_source(source)
                            && !client_session_id.is_empty()
                            && client_session_id.len() <= 240 =>
                    {
                        match self.workspaces.resolve_for_path(&PathBuf::from(cwd)) {
                            Ok(workspace) => match store.resolve_mcp_integration_workstream(
                                source,
                                client_session_id,
                                workspace.id,
                            ) {
                                Ok((_session_key, workstream_id)) => success(
                                    request.id,
                                    json!({
                                        "workspaceId": workspace.id,
                                        "workstreamId": workstream_id,
                                        "source": source,
                                        "sessionId": client_session_id,
                                    }),
                                ),
                                Err(reason) => error(request.id, -32050, &reason.to_string()),
                            },
                            Err(reason) => error(request.id, -32012, &reason.to_string()),
                        }
                    }
                    (None, _, _, _) => error(request.id, -32050, "Durable state is unavailable"),
                    _ => error(
                        request.id,
                        -32602,
                        "cwd, a supported source, and clientSessionId are required",
                    ),
                }
            }
            "git.status" => self.git_call(request, "status"),
            "git.diff_summary" => self.git_call(request, "diff_summary"),
            "state.persist_event" => self.persist_event(request),
            "state.list_events" => {
                let limit = request
                    .params
                    .get("limit")
                    .and_then(Value::as_u64)
                    .unwrap_or(10_000)
                    .min(10_000) as usize;
                match &self.durable_store {
                    Some(store) => match store.list_events(limit) {
                        Ok(events) => success(request.id, json!({ "events": events })),
                        Err(reason) => error(request.id, -32050, &reason.to_string()),
                    },
                    None => error(request.id, -32050, "Durable state is unavailable"),
                }
            }
            "settings.get" => match &self.durable_store {
                Some(store) => match store.model_egress_mode() {
                    Ok(mode) => success(request.id, json!({ "modelEgress": mode })),
                    Err(reason) => error(request.id, -32050, &reason.to_string()),
                },
                None => error(request.id, -32050, "Durable state is unavailable"),
            },
            "settings.set_model_egress" => {
                let mode = request.params.get("mode").and_then(Value::as_str);
                match (&self.durable_store, mode) {
                    (Some(store), Some(mode)) => match store.set_model_egress_mode(mode) {
                        Ok(mode) => success(request.id, json!({ "modelEgress": mode })),
                        Err(reason) => error(request.id, -32602, &reason.to_string()),
                    },
                    (None, _) => error(request.id, -32050, "Durable state is unavailable"),
                    (_, None) => error(request.id, -32602, "mode is required"),
                }
            }
            "mls.initialize" => self.mls_initialize(request),
            "mls.key_package" => self.mls_key_package(request),
            "mls.create_group" => self.mls_create_group(request),
            "mls.add_member" => self.mls_add_member(request),
            "mls.join_group" => self.mls_join_group(request),
            "mls.encrypt" => self.mls_encrypt(request),
            "mls.decrypt" => self.mls_decrypt(request),
            "memory.put" => self.put_memory(request),
            "memory.search" => self.search_memory(request),
            "representative.next_request" => {
                if let Some(store) = &self.durable_store {
                    match store.next_representative_request() {
                        Ok(next) => success(request.id, next.unwrap_or(Value::Null)),
                        Err(reason) => error(request.id, -32050, &reason.to_string()),
                    }
                } else {
                    match self.pending_requests.lock() {
                        Ok(mut queue) => {
                            success(request.id, queue.pop_front().unwrap_or(Value::Null))
                        }
                        Err(_) => error(request.id, -32050, "Representative queue is unavailable"),
                    }
                }
            }
            "representative.ack_request" => {
                let request_id = request.params.get("requestId").and_then(Value::as_str);
                match (&self.durable_store, request_id) {
                    (Some(store), Some(request_id)) => {
                        match store.acknowledge_representative_request(request_id) {
                            Ok(acknowledged) => {
                                success(request.id, json!({ "acknowledged": acknowledged }))
                            }
                            Err(reason) => error(request.id, -32050, &reason.to_string()),
                        }
                    }
                    (None, _) => error(request.id, -32050, "Durable state is unavailable"),
                    (_, None) => error(request.id, -32602, "requestId is required"),
                }
            }
            "representative.complete_request" => {
                let request_id = request.params.get("requestId").and_then(Value::as_str);
                let result = request.params.get("result");
                match (&self.durable_store, request_id, result) {
                    (Some(store), Some(request_id), Some(result))
                        if !contains_forbidden_field(result) =>
                    {
                        match store.complete_representative_request(request_id, result) {
                            Ok(completed) => success(request.id, json!({ "completed": completed })),
                            Err(reason) => error(request.id, -32050, &reason.to_string()),
                        }
                    }
                    (None, _, _) => error(request.id, -32050, "Durable state is unavailable"),
                    (_, _, Some(_)) if request_id.is_some() => error(
                        request.id,
                        -32602,
                        "Result contains a forbidden raw-content field",
                    ),
                    _ => error(request.id, -32602, "requestId and result are required"),
                }
            }
            "representative.request_result" => {
                let request_id = request.params.get("requestId").and_then(Value::as_str);
                match (&self.durable_store, request_id) {
                    (Some(store), Some(request_id)) => {
                        let workspace_id = if role == RpcRole::Mcp {
                            let Some(workspace_id) = parse_workspace_id(&request.params) else {
                                return error(
                                    request.id,
                                    -32602,
                                    "workspaceId is required for MCP result lookup",
                                );
                            };
                            Some(workspace_id)
                        } else {
                            None
                        };
                        match store
                            .representative_request_result_for_workspace(request_id, workspace_id)
                        {
                            Ok(Some(result)) => success(request.id, result),
                            Ok(None) => {
                                error(request.id, -32013, "Representative request was not found")
                            }
                            Err(reason) => error(request.id, -32050, &reason.to_string()),
                        }
                    }
                    (None, _) => error(request.id, -32050, "Durable state is unavailable"),
                    (_, None) => error(request.id, -32602, "requestId is required"),
                }
            }
            "representative.ingest_adapter_event" => {
                if valid_adapter_event_request(&request.params) {
                    self.queue_representative_request(request)
                } else {
                    error(
                        request.id,
                        -32602,
                        "Adapter event does not match the closed lifecycle schema",
                    )
                }
            }
            method if method.starts_with("representative.") => {
                self.queue_representative_request(request)
            }
            _ => error(request.id, -32601, "Method not found"),
        }
    }

    fn queue_representative_request(&self, request: JsonRpcRequest) -> JsonRpcResponse {
        let workspace_id = parse_workspace_id(&request.params);
        let Some(workspace_id) = workspace_id else {
            return error(request.id, -32602, "A valid workspaceId is required");
        };
        match self.workspaces.is_active(workspace_id) {
            Ok(true) => {}
            Ok(false) => {
                return error(
                    request.id,
                    -32012,
                    "Workspace is not enrolled or has been revoked",
                );
            }
            Err(reason) => return error(request.id, -32050, &reason.to_string()),
        }
        if contains_forbidden_field(&request.params) {
            return error(
                request.id,
                -32602,
                "Request contains a forbidden raw-content field",
            );
        }

        let request_id = request
            .params
            .get("operationId")
            .or_else(|| request.params.get("requestId"))
            .and_then(Value::as_str)
            .filter(|value| Uuid::parse_str(value).is_ok())
            .map_or_else(|| Uuid::now_v7().to_string(), ToOwned::to_owned);
        let queued = json!({
            "requestId": request_id,
            "method": request.method,
            "params": request.params,
            "queuedAt": std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |duration| duration.as_millis()),
        });
        let persisted = if let Some(store) = &self.durable_store {
            store
                .enqueue_representative_request(&queued)
                .map_err(|reason| reason.to_string())
        } else {
            self.pending_requests
                .lock()
                .map_err(|_| "Representative queue is unavailable".to_owned())
                .map(|mut queue| {
                    queue.push_back(queued.clone());
                    true
                })
        };
        match persisted {
            Ok(inserted) => success(
                request.id,
                json!({
                    "accepted": true,
                    "queued": true,
                    "duplicate": !inserted,
                    "requestId": queued["requestId"],
                }),
            ),
            Err(reason) => error(request.id, -32050, &reason),
        }
    }

    fn workspace_path_call(
        &self,
        request: JsonRpcRequest,
        operation: impl Fn(
            &WorkspaceRegistry,
            Uuid,
            &std::path::Path,
        ) -> Result<Value, workspace_tools::WorkspaceToolError>,
    ) -> JsonRpcResponse {
        let workspace_id = parse_workspace_id(&request.params);
        let path = request.params.get("path").and_then(Value::as_str);
        match (workspace_id, path) {
            (Some(workspace_id), Some(path)) => {
                match operation(&self.workspaces, workspace_id, &PathBuf::from(path)) {
                    Ok(result) => success(request.id, result),
                    Err(reason) => error(request.id, -32011, &reason.to_string()),
                }
            }
            _ => error(request.id, -32602, "workspaceId and path are required"),
        }
    }

    fn git_call(&self, request: JsonRpcRequest, kind: &str) -> JsonRpcResponse {
        let Some(workspace_id) = parse_workspace_id(&request.params) else {
            return error(request.id, -32602, "workspaceId is required");
        };
        match workspace_tools::git_query(&self.workspaces, workspace_id, kind) {
            Ok(result) => success(request.id, result),
            Err(reason) => error(request.id, -32011, &reason.to_string()),
        }
    }

    fn persist_event(&self, request: JsonRpcRequest) -> JsonRpcResponse {
        let Some(event) = request.params.get("event") else {
            return error(request.id, -32602, "event is required");
        };
        if contains_forbidden_field(event) {
            return error(
                request.id,
                -32602,
                "Event contains a forbidden raw-content field",
            );
        }
        let workspace_id = event
            .get("workspaceId")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok());
        let Some(workspace_id) = workspace_id else {
            return error(request.id, -32602, "Event workspaceId is invalid");
        };
        match self.workspaces.is_active(workspace_id) {
            Ok(true) => {}
            Ok(false) => return error(request.id, -32012, "Workspace is not enrolled"),
            Err(reason) => return error(request.id, -32050, &reason.to_string()),
        }
        let required = |field: &str| event.get(field).and_then(Value::as_str);
        let (Some(id), Some(idempotency_key), Some(event_type), Some(created_at)) = (
            required("id"),
            required("idempotencyKey"),
            required("type"),
            required("occurredAt"),
        ) else {
            return error(
                request.id,
                -32602,
                "Event id, idempotencyKey, type, and occurredAt are required",
            );
        };
        let Some(store) = &self.durable_store else {
            return error(request.id, -32050, "Durable state is unavailable");
        };
        let serialized = match serde_json::to_string(event) {
            Ok(serialized) if serialized.len() <= 1_048_576 => serialized,
            Ok(_) => return error(request.id, -32602, "Event exceeds the 1 MiB state limit"),
            Err(reason) => return error(request.id, -32602, &reason.to_string()),
        };
        match store.enqueue_event(
            id,
            idempotency_key,
            &workspace_id.to_string(),
            event_type,
            &serialized,
            created_at,
        ) {
            Ok(inserted) => success(request.id, json!({ "inserted": inserted })),
            Err(reason) => error(request.id, -32050, &reason.to_string()),
        }
    }

    fn put_memory(&self, request: JsonRpcRequest) -> JsonRpcResponse {
        if contains_forbidden_field(&request.params) {
            return error(
                request.id,
                -32602,
                "Memory contains a forbidden raw-content field",
            );
        }
        let workspace_id = parse_workspace_id(&request.params);
        let object_id = request.params.get("objectId").and_then(Value::as_str);
        let object_type = request.params.get("objectType").and_then(Value::as_str);
        let title = request.params.get("title").and_then(Value::as_str);
        let summary = request.params.get("summary").and_then(Value::as_str);
        let (Some(workspace_id), Some(object_id), Some(object_type), Some(title), Some(summary)) =
            (workspace_id, object_id, object_type, title, summary)
        else {
            return error(
                request.id,
                -32602,
                "workspaceId, objectId, objectType, title, and summary are required",
            );
        };
        if object_id.len() > 300
            || object_type.len() > 80
            || title.len() > 500
            || summary.len() > 4_000
        {
            return error(request.id, -32602, "Structured memory exceeds field limits");
        }
        match self.workspaces.is_active(workspace_id) {
            Ok(true) => {}
            Ok(false) => return error(request.id, -32012, "Workspace is not enrolled"),
            Err(reason) => return error(request.id, -32050, &reason.to_string()),
        }
        match &self.durable_store {
            Some(store) => {
                match store.put_memory(workspace_id, object_id, object_type, title, summary) {
                    Ok(()) => success(request.id, json!({ "indexed": true })),
                    Err(reason) => error(request.id, -32050, &reason.to_string()),
                }
            }
            None => error(request.id, -32050, "Durable state is unavailable"),
        }
    }

    fn mls_initialize(&self, request: JsonRpcRequest) -> JsonRpcResponse {
        let identity = request.params.get("deviceIdentity").and_then(Value::as_str);
        let Some(identity) = identity.filter(|value| !value.is_empty() && value.len() <= 200)
        else {
            return error(request.id, -32602, "deviceIdentity must be 1 to 200 bytes");
        };
        let device = match OpenMlsDevice::new(identity.as_bytes()) {
            Ok(device) => device,
            Err(reason) => return error(request.id, -32060, &reason.to_string()),
        };
        match self.mls_device.lock() {
            Ok(mut current) => {
                *current = Some(device);
                success(request.id, json!({ "initialized": true }))
            }
            Err(_) => error(request.id, -32060, "MLS device state is unavailable"),
        }
    }

    fn mls_key_package(&self, request: JsonRpcRequest) -> JsonRpcResponse {
        self.with_mls(request.id, |device| {
            device
                .key_package()
                .map(|key_package| json!({ "keyPackage": STANDARD.encode(key_package) }))
        })
    }

    fn mls_create_group(&self, request: JsonRpcRequest) -> JsonRpcResponse {
        let Some(group_id) = group_id(&request.params) else {
            return error(request.id, -32602, "groupId is required");
        };
        self.with_mls(request.id, |device| {
            device
                .create_group(group_id.as_bytes())
                .map(|()| json!({ "created": true, "groupId": group_id }))
        })
    }

    fn mls_add_member(&self, request: JsonRpcRequest) -> JsonRpcResponse {
        let Some(group_id) = group_id(&request.params) else {
            return error(request.id, -32602, "groupId is required");
        };
        let key_package = request
            .params
            .get("keyPackage")
            .and_then(Value::as_str)
            .and_then(|value| STANDARD.decode(value).ok());
        let Some(key_package) = key_package else {
            return error(request.id, -32602, "keyPackage must be valid base64");
        };
        self.with_mls(request.id, |device| {
            device
                .add_member(group_id.as_bytes(), &key_package)
                .map(|invitation| {
                    json!({
                        "welcome": STANDARD.encode(invitation.welcome),
                        "ratchetTree": STANDARD.encode(invitation.ratchet_tree),
                    })
                })
        })
    }

    fn mls_join_group(&self, request: JsonRpcRequest) -> JsonRpcResponse {
        let welcome = request
            .params
            .get("welcome")
            .and_then(Value::as_str)
            .and_then(|value| STANDARD.decode(value).ok());
        let ratchet_tree = request
            .params
            .get("ratchetTree")
            .and_then(Value::as_str)
            .and_then(|value| STANDARD.decode(value).ok());
        let (Some(welcome), Some(ratchet_tree)) = (welcome, ratchet_tree) else {
            return error(
                request.id,
                -32602,
                "welcome and ratchetTree must be valid base64",
            );
        };
        self.with_mls(request.id, |device| {
            device
                .join_group(&OpenMlsInvitation {
                    welcome,
                    ratchet_tree,
                })
                .map(|group_id| json!({ "groupId": String::from_utf8_lossy(&group_id) }))
        })
    }

    fn mls_encrypt(&self, request: JsonRpcRequest) -> JsonRpcResponse {
        let Some(group_id) = group_id(&request.params) else {
            return error(request.id, -32602, "groupId is required");
        };
        let plaintext = request.params.get("plaintext").and_then(Value::as_str);
        let Some(plaintext) = plaintext.filter(|value| value.len() <= 16_000) else {
            return error(request.id, -32602, "plaintext exceeds the message limit");
        };
        self.with_mls(request.id, |device| {
            device
                .encrypt(group_id.as_bytes(), plaintext.as_bytes())
                .map(|ciphertext| json!({ "ciphertext": STANDARD.encode(ciphertext) }))
        })
    }

    fn mls_decrypt(&self, request: JsonRpcRequest) -> JsonRpcResponse {
        let Some(group_id) = group_id(&request.params) else {
            return error(request.id, -32602, "groupId is required");
        };
        let ciphertext = request
            .params
            .get("ciphertext")
            .and_then(Value::as_str)
            .and_then(|value| STANDARD.decode(value).ok());
        let Some(ciphertext) = ciphertext else {
            return error(request.id, -32602, "ciphertext must be valid base64");
        };
        self.with_mls(request.id, |device| {
            let plaintext = device.decrypt(group_id.as_bytes(), &ciphertext)?;
            let plaintext = String::from_utf8(plaintext)
                .map_err(|reason| anyhow::anyhow!("MLS plaintext is not UTF-8: {reason}"))?;
            Ok(json!({ "plaintext": plaintext }))
        })
    }

    fn with_mls(
        &self,
        id: Value,
        operation: impl FnOnce(&mut OpenMlsDevice) -> anyhow::Result<Value>,
    ) -> JsonRpcResponse {
        let Ok(mut state) = self.mls_device.lock() else {
            return error(id, -32060, "MLS device state is unavailable");
        };
        let Some(device) = state.as_mut() else {
            return error(id, -32061, "MLS device is not initialized");
        };
        match operation(device) {
            Ok(result) => success(id, result),
            Err(reason) => error(id, -32060, &reason.to_string()),
        }
    }

    fn search_memory(&self, request: JsonRpcRequest) -> JsonRpcResponse {
        let workspace_id = parse_workspace_id(&request.params);
        let query = request.params.get("query").and_then(Value::as_str);
        let limit = request
            .params
            .get("limit")
            .and_then(Value::as_u64)
            .unwrap_or(10)
            .min(50) as usize;
        let (Some(workspace_id), Some(query)) = (workspace_id, query) else {
            return error(request.id, -32602, "workspaceId and query are required");
        };
        if query.is_empty() || query.len() > 500 {
            return error(request.id, -32602, "Memory query must be 1 to 500 bytes");
        }
        match self.workspaces.is_active(workspace_id) {
            Ok(true) => {}
            Ok(false) => return error(request.id, -32012, "Workspace is not enrolled"),
            Err(reason) => return error(request.id, -32050, &reason.to_string()),
        }
        match &self.durable_store {
            Some(store) => match store.search_memory(workspace_id, query, limit) {
                Ok(items) => success(request.id, json!({ "items": items })),
                Err(reason) => error(request.id, -32050, &reason.to_string()),
            },
            None => error(request.id, -32050, "Durable state is unavailable"),
        }
    }
}

fn parse_workspace_id(params: &Value) -> Option<Uuid> {
    params
        .get("workspaceId")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
}

fn group_id(params: &Value) -> Option<String> {
    params
        .get("groupId")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty() && value.len() <= 300)
        .map(ToOwned::to_owned)
}

fn contains_forbidden_field(value: &Value) -> bool {
    const FORBIDDEN: &[&str] = &[
        "prompt",
        "prompttext",
        "assistantresponse",
        "chainofthought",
        "toolinput",
        "tooloutput",
        "toolresponse",
        "terminaloutput",
        "stdout",
        "stderr",
        "filecontent",
        "accesstoken",
        "authorization",
        "apikey",
        "command",
        "toolresult",
        "secret",
    ];
    match value {
        Value::Array(values) => values.iter().any(contains_forbidden_field),
        Value::Object(map) => map.iter().any(|(key, value)| {
            let normalized = key
                .chars()
                .filter(char::is_ascii_alphanumeric)
                .flat_map(char::to_lowercase)
                .collect::<String>();
            FORBIDDEN.contains(&normalized.as_str()) || contains_forbidden_field(value)
        }),
        Value::String(value) => looks_like_secret(value),
        _ => false,
    }
}

fn looks_like_secret(value: &str) -> bool {
    value.split_whitespace().any(|word| {
        (word.starts_with("sk-") && word.len() >= 19)
            || (word.starts_with("AKIA") && word.len() == 20)
            || (word.starts_with("ghp_") && word.len() >= 24)
    }) || value
        .split_once("Bearer ")
        .is_some_and(|(_, token)| token.trim().len() >= 16)
}

fn success(id: Value, result: Value) -> JsonRpcResponse {
    JsonRpcResponse {
        jsonrpc: "2.0",
        id,
        result: Some(result),
        error: None,
    }
}

fn error(id: Value, code: i32, message: &str) -> JsonRpcResponse {
    JsonRpcResponse {
        jsonrpc: "2.0",
        id,
        result: None,
        error: Some(JsonRpcError {
            code,
            message: message.to_owned(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::Value;
    use tempfile::tempdir;
    use uuid::Uuid;

    use super::{JsonRpcRequest, RpcService, RpcTokens, contains_forbidden_field};
    use crate::storage::{CredentialStore, EncryptedStore, StorageError};
    use crate::workspace::WorkspaceRegistry;

    struct TestCredentials;

    impl CredentialStore for TestCredentials {
        fn load_or_create_database_key(&self) -> Result<String, StorageError> {
            Ok("dGVzdC1rZXktZm9yLWludGVybw==".into())
        }
    }

    #[test]
    fn enforces_local_capability_method_boundaries() {
        let directory = tempdir().expect("database directory");
        let store = EncryptedStore::open(&directory.path().join("intero.db"), &TestCredentials)
            .expect("database");
        let service = RpcService::new_durable_with_tokens(
            RpcTokens {
                administrator: "administrator-token".into(),
                hook_ingress: "hook-ingress-token".into(),
                mcp: "mcp-capability-token".into(),
                sidecar: "sidecar-capability-token".into(),
            },
            WorkspaceRegistry::default(),
            store,
        );

        for (token, method) in [
            ("hook-ingress-token", "workspace.list"),
            ("hook-ingress-token", "settings.get"),
            ("mcp-capability-token", "workspace.enroll"),
            ("mcp-capability-token", "state.list_events"),
            ("sidecar-capability-token", "workspace.list"),
            ("sidecar-capability-token", "settings.set_model_egress"),
        ] {
            let response = service.handle(JsonRpcRequest {
                jsonrpc: "2.0".into(),
                id: serde_json::json!(1),
                method: method.into(),
                params: serde_json::json!({}),
                auth_token: token.into(),
            });
            assert_eq!(
                response.error.expect("capability should be denied").code,
                -32002,
                "{token} unexpectedly called {method}"
            );
        }

        let administrator = service.handle(JsonRpcRequest {
            jsonrpc: "2.0".into(),
            id: serde_json::json!(2),
            method: "workspace.list".into(),
            params: serde_json::json!({}),
            auth_token: "administrator-token".into(),
        });
        assert!(administrator.error.is_none());
    }

    #[test]
    fn binds_mcp_to_the_only_active_workspace_session() {
        let directory = tempdir().expect("database directory");
        let workspace_root = directory.path().join("workspace");
        std::fs::create_dir(&workspace_root).expect("workspace");
        let registry = WorkspaceRegistry::default();
        let workspace = registry
            .enroll(&workspace_root, "repo:test".into())
            .expect("enrollment");
        let store = EncryptedStore::open(&directory.path().join("intero.db"), &TestCredentials)
            .expect("database");
        store
            .upsert_workspace(&workspace)
            .expect("workspace storage");
        let workstream_id = store
            .resolve_integration_workstream("codex:session-1", workspace.id)
            .expect("integration session");
        let service = RpcService::new_durable_with_tokens(
            RpcTokens {
                administrator: "administrator-token".into(),
                hook_ingress: "hook-ingress-token".into(),
                mcp: "mcp-capability-token".into(),
                sidecar: "sidecar-capability-token".into(),
            },
            registry,
            store,
        );

        let response = service.handle(JsonRpcRequest {
            jsonrpc: "2.0".into(),
            id: serde_json::json!(1),
            method: "integration.current_context".into(),
            params: serde_json::json!({
                "cwd": workspace_root,
                "source": "codex",
                "clientSessionId": "mcp-process-1",
            }),
            auth_token: "mcp-capability-token".into(),
        });
        let expected_workstream_id = workstream_id.to_string();
        assert_eq!(
            response
                .result
                .expect("context")
                .get("workstreamId")
                .and_then(Value::as_str),
            Some(expected_workstream_id.as_str())
        );
    }

    #[test]
    fn refuses_to_guess_between_concurrent_agent_sessions() {
        let directory = tempdir().expect("database directory");
        let workspace_root = directory.path().join("workspace");
        std::fs::create_dir(&workspace_root).expect("workspace");
        let registry = WorkspaceRegistry::default();
        let workspace = registry
            .enroll(&workspace_root, "repo:test".into())
            .expect("enrollment");
        let store = EncryptedStore::open(&directory.path().join("intero.db"), &TestCredentials)
            .expect("database");
        store
            .resolve_integration_workstream("codex:session-1", workspace.id)
            .expect("first session");
        store
            .resolve_integration_workstream("codex:session-2", workspace.id)
            .expect("second session");
        let service = RpcService::new_durable_with_tokens(
            RpcTokens {
                administrator: "administrator-token".into(),
                hook_ingress: "hook-ingress-token".into(),
                mcp: "mcp-capability-token".into(),
                sidecar: "sidecar-capability-token".into(),
            },
            registry,
            store,
        );

        let response = service.handle(JsonRpcRequest {
            jsonrpc: "2.0".into(),
            id: serde_json::json!(1),
            method: "integration.current_context".into(),
            params: serde_json::json!({
                "cwd": workspace_root,
                "source": "codex",
                "clientSessionId": "mcp-process-1",
            }),
            auth_token: "mcp-capability-token".into(),
        });
        assert_eq!(
            response.error.expect("ambiguous context should fail").code,
            -32050
        );
    }

    #[test]
    fn rejects_representative_requests_outside_enrolled_workspaces() {
        let service = RpcService::new("token".into(), WorkspaceRegistry::default());
        let response = service.handle(JsonRpcRequest {
            jsonrpc: "2.0".into(),
            id: serde_json::json!(1),
            method: "representative.report_checkpoint".into(),
            params: serde_json::json!({
                "workspaceId": Uuid::now_v7(),
                "summary": "Should not persist"
            }),
            auth_token: "token".into(),
        });
        assert_eq!(
            response.error.expect("request should be denied").code,
            -32012
        );
    }

    #[test]
    fn queues_a_bounded_request_for_an_enrolled_workspace() {
        let root = tempdir().expect("workspace fixture");
        let registry = WorkspaceRegistry::default();
        let workspace = registry
            .enroll(root.path(), "repo:test".into())
            .expect("workspace enrollment");
        let service = RpcService::new("token".into(), registry);
        let accepted = service.handle(JsonRpcRequest {
            jsonrpc: "2.0".into(),
            id: serde_json::json!(1),
            method: "representative.report_checkpoint".into(),
            params: serde_json::json!({
                "workspaceId": workspace.id,
                "workstreamId": Uuid::now_v7(),
                "kind": "decision",
                "summary": "Use append-only correction events"
            }),
            auth_token: "token".into(),
        });
        assert_eq!(accepted.result.expect("accepted result")["queued"], true);

        let next = service.handle(JsonRpcRequest {
            jsonrpc: "2.0".into(),
            id: serde_json::json!(2),
            method: "representative.next_request".into(),
            params: serde_json::json!({}),
            auth_token: "token".into(),
        });
        assert_eq!(
            next.result.expect("queued request")["method"],
            "representative.report_checkpoint"
        );
        let workspaces = rpc(&service, "workspace.list", serde_json::json!({}));
        assert_eq!(workspaces["workspaces"][0]["id"], workspace.id.to_string());
    }

    #[test]
    fn persists_model_policy_through_bounded_local_rpc() {
        let directory = tempdir().expect("runtime fixture");
        let store = EncryptedStore::open(&directory.path().join("intero.db"), &TestCredentials)
            .expect("open encrypted store");
        let service = RpcService::new_durable("token".into(), WorkspaceRegistry::default(), store);

        let updated = rpc(
            &service,
            "settings.set_model_egress",
            serde_json::json!({ "mode": "user_provided_api" }),
        );
        assert_eq!(updated["modelEgress"], "user_provided_api");
        assert_eq!(
            rpc(&service, "settings.get", serde_json::json!({}))["modelEgress"],
            "user_provided_api"
        );
        let rejected = service.handle(JsonRpcRequest {
            jsonrpc: "2.0".into(),
            id: serde_json::json!(2),
            method: "settings.set_model_egress".into(),
            params: serde_json::json!({ "mode": "unbounded" }),
            auth_token: "token".into(),
        });
        assert_eq!(rejected.error.expect("invalid mode").code, -32602);
    }

    #[test]
    fn rejects_raw_content_in_completed_results() {
        assert!(contains_forbidden_field(&serde_json::json!({
            "result": {
                "nested": [{ "toolOutput": "raw transcript" }]
            }
        })));
        assert!(!contains_forbidden_field(&serde_json::json!({
            "result": {
                "summary": "Validation passed",
                "evidenceRefs": ["check:unit"]
            }
        })));
    }

    #[test]
    fn exposes_openmls_membership_and_message_encryption_over_local_rpc() {
        let alice = RpcService::new("token".into(), WorkspaceRegistry::default());
        let bob = RpcService::new("token".into(), WorkspaceRegistry::default());
        rpc(
            &alice,
            "mls.initialize",
            serde_json::json!({
                "deviceIdentity": "alice-device"
            }),
        );
        rpc(
            &bob,
            "mls.initialize",
            serde_json::json!({
                "deviceIdentity": "bob-device"
            }),
        );
        rpc(
            &alice,
            "mls.create_group",
            serde_json::json!({
                "groupId": "thread:human-only"
            }),
        );
        let bob_package = rpc(&bob, "mls.key_package", serde_json::json!({}));
        let invitation = rpc(
            &alice,
            "mls.add_member",
            serde_json::json!({
                "groupId": "thread:human-only",
                "keyPackage": bob_package["keyPackage"]
            }),
        );
        rpc(&bob, "mls.join_group", invitation);
        let encrypted = rpc(
            &alice,
            "mls.encrypt",
            serde_json::json!({
                "groupId": "thread:human-only",
                "plaintext": "Only enrolled devices can read this."
            }),
        );
        let decrypted = rpc(
            &bob,
            "mls.decrypt",
            serde_json::json!({
                "groupId": "thread:human-only",
                "ciphertext": encrypted["ciphertext"]
            }),
        );
        assert_eq!(
            decrypted["plaintext"],
            "Only enrolled devices can read this."
        );
        assert_ne!(
            encrypted["ciphertext"],
            "Only enrolled devices can read this."
        );
    }

    fn rpc(service: &RpcService, method: &str, params: Value) -> Value {
        let response = service.handle(JsonRpcRequest {
            jsonrpc: "2.0".into(),
            id: serde_json::json!(1),
            method: method.into(),
            params,
            auth_token: "token".into(),
        });
        if let Some(error) = response.error {
            panic!("RPC failed: {}", error.message);
        }
        response.result.expect("RPC result")
    }
}
