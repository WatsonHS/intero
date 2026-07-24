use std::path::PathBuf;

use anyhow::Context;
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use directories::BaseDirs;
use interod::ipc;
use interod::rpc::RpcService;
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
    let auth_token = match std::env::var("INTERO_LOCAL_TOKEN") {
        Ok(token) => token,
        Err(_) => credentials.os.load_or_create_secret("ipc-token", 32)?,
    };
    let workspaces = WorkspaceRegistry::from_workspaces(store.load_workspaces()?);
    let service = RpcService::new_durable(auth_token, workspaces, store);
    write_connection_descriptor(
        &data_directory.join("connection.json"),
        &socket_path,
        service.auth_token(),
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
    auth_token: &str,
) -> anyhow::Result<()> {
    let temporary = path.with_extension("json.tmp");
    std::fs::write(
        &temporary,
        serde_json::to_vec_pretty(&serde_json::json!({
            "schemaVersion": 1,
            "socketPath": socket_path,
            "authToken": auth_token,
        }))?,
    )?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&temporary, std::fs::Permissions::from_mode(0o600))?;
    }
    std::fs::rename(temporary, path)?;
    Ok(())
}
