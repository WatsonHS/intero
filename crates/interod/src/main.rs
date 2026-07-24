use std::collections::HashSet;
use std::path::PathBuf;

use anyhow::Context;
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use directories::BaseDirs;
use interod::ipc;
use interod::rpc::{RpcService, RpcTokens};
use interod::storage::{CredentialStore, EncryptedStore, OsCredentialStore, StorageError};
use interod::workspace::WorkspaceRegistry;
use tracing::info;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(EnvFilter::from_default_env())
        .with_current_span(false)
        .with_span_list(false)
        .init();

    let data_directory = std::env::var_os("INTERO_DATA_DIR")
        .map(PathBuf::from)
        .or_else(|| BaseDirs::new().map(|directories| directories.home_dir().join(".intero")))
        .unwrap_or_else(|| std::env::temp_dir().join("intero"));
    std::fs::create_dir_all(&data_directory)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&data_directory, std::fs::Permissions::from_mode(0o700))?;
    }
    let socket_path = std::env::var_os("INTERO_SOCKET")
        .map_or_else(|| default_socket_path(&data_directory), PathBuf::from);
    let credentials = StartupCredentialStore {
        override_key: database_key_override()?,
        os: OsCredentialStore::new("com.intero.local", "default"),
    };
    let store = EncryptedStore::open(&data_directory.join("intero.db"), &credentials)?;
    store.discard_pending_workspaces()?;
    let auth_tokens = RpcTokens {
        administrator: load_capability_token(
            "INTERO_LOCAL_TOKEN",
            "ipc-token-administrator",
            &credentials.os,
        )?,
        hook_ingress: load_capability_token(
            "INTERO_HOOK_TOKEN",
            "ipc-token-hook",
            &credentials.os,
        )?,
        mcp: load_capability_token("INTERO_MCP_TOKEN", "ipc-token-mcp", &credentials.os)?,
        sidecar: load_capability_token(
            "INTERO_SIDECAR_TOKEN",
            "ipc-token-sidecar",
            &credentials.os,
        )?,
    };
    validate_capability_tokens(&auth_tokens)?;
    let workspace_allowlist_path = data_directory.join("workspace-allowlist.json");
    let workspaces = WorkspaceRegistry::from_workspaces(store.load_workspaces()?)
        .with_allowlist_path(workspace_allowlist_path.clone())?;
    let service = RpcService::new_durable_with_tokens(auth_tokens, workspaces, store);
    write_connection_descriptor(
        &data_directory.join("connection.json"),
        &socket_path,
        "administrator",
        &service.auth_tokens().administrator,
        None,
    )?;
    write_connection_descriptor(
        &data_directory.join("connection-hook.json"),
        &socket_path,
        "hook",
        &service.auth_tokens().hook_ingress,
        Some(&workspace_allowlist_path),
    )?;
    write_connection_descriptor(
        &data_directory.join("connection-mcp.json"),
        &socket_path,
        "mcp",
        &service.auth_tokens().mcp,
        None,
    )?;
    write_connection_descriptor(
        &data_directory.join("connection-sidecar.json"),
        &socket_path,
        "sidecar",
        &service.auth_tokens().sidecar,
        None,
    )?;
    info!(
        operation = "ipc.listen",
        status = "starting",
        "interod listening"
    );
    ipc::serve(&socket_path, service)
        .await
        .with_context(|| format!("failed to serve {}", socket_path.display()))
}

struct StartupCredentialStore {
    override_key: Option<String>,
    os: OsCredentialStore,
}

impl CredentialStore for StartupCredentialStore {
    fn load_or_create_database_key(&self) -> Result<String, StorageError> {
        match &self.override_key {
            Some(key) => Ok(key.clone()),
            None => self.os.load_or_create_database_key(),
        }
    }
}

fn database_key_override() -> anyhow::Result<Option<String>> {
    let Ok(key) = std::env::var("INTERO_DATABASE_KEY") else {
        return Ok(None);
    };
    let decoded = STANDARD
        .decode(&key)
        .context("INTERO_DATABASE_KEY must be valid base64")?;
    anyhow::ensure!(
        decoded.len() == 32,
        "INTERO_DATABASE_KEY must decode to exactly 32 bytes"
    );
    Ok(Some(key))
}

fn load_capability_token(
    environment_name: &str,
    credential_name: &str,
    credentials: &OsCredentialStore,
) -> anyhow::Result<String> {
    match std::env::var(environment_name) {
        Ok(token) => Ok(token),
        Err(_) => Ok(credentials.load_or_create_secret(credential_name, 32)?),
    }
}

fn validate_capability_tokens(tokens: &RpcTokens) -> anyhow::Result<()> {
    let values = [
        tokens.administrator.as_str(),
        tokens.hook_ingress.as_str(),
        tokens.mcp.as_str(),
        tokens.sidecar.as_str(),
    ];
    anyhow::ensure!(
        values.iter().all(|token| token.len() >= 20),
        "Intero capability tokens must each contain at least 20 characters"
    );
    anyhow::ensure!(
        values.into_iter().collect::<HashSet<_>>().len() == 4,
        "Intero capability tokens must be pairwise distinct"
    );
    Ok(())
}

#[cfg(unix)]
fn default_socket_path(data_directory: &std::path::Path) -> PathBuf {
    data_directory.join("interod.sock")
}

#[cfg(windows)]
fn default_socket_path(_data_directory: &std::path::Path) -> PathBuf {
    PathBuf::from(r"\\.\pipe\interod")
}

fn write_connection_descriptor(
    path: &std::path::Path,
    socket_path: &std::path::Path,
    capability: &str,
    auth_token: &str,
    workspace_allowlist_path: Option<&std::path::Path>,
) -> anyhow::Result<()> {
    let temporary = path.with_extension("json.tmp");
    let mut descriptor = serde_json::json!({
        "schemaVersion": 2,
        "capability": capability,
        "socketPath": socket_path,
        "authToken": auth_token,
    });
    if let Some(workspace_allowlist_path) = workspace_allowlist_path {
        descriptor["workspaceAllowlistPath"] =
            serde_json::Value::String(workspace_allowlist_path.to_string_lossy().into_owned());
    }
    std::fs::write(&temporary, serde_json::to_vec_pretty(&descriptor)?)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&temporary, std::fs::Permissions::from_mode(0o600))?;
    }
    std::fs::rename(temporary, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use interod::rpc::RpcTokens;

    use super::validate_capability_tokens;

    #[test]
    fn rejects_duplicate_capability_tokens() {
        let tokens = RpcTokens {
            administrator: "same-token-value-for-tests".into(),
            hook_ingress: "same-token-value-for-tests".into(),
            mcp: "different-mcp-token-for-tests".into(),
            sidecar: "different-sidecar-token-tests".into(),
        };
        assert!(validate_capability_tokens(&tokens).is_err());
    }
}
