use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, RwLock};

use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Workspace {
    pub id: Uuid,
    pub root: PathBuf,
    pub repository_identity: String,
    pub excluded_paths: Vec<PathBuf>,
    pub revoked: bool,
}

#[derive(Debug, Error)]
pub enum WorkspaceError {
    #[error("workspace is not enrolled")]
    NotEnrolled,
    #[error("workspace enrollment is revoked")]
    Revoked,
    #[error("path is outside the enrolled workspace")]
    OutsideWorkspace,
    #[error("path is sensitive or explicitly excluded")]
    SensitivePath,
    #[error("path could not be resolved: {0}")]
    Resolve(#[from] std::io::Error),
    #[error("workspace registry lock is poisoned")]
    LockPoisoned,
}

#[derive(Clone, Default)]
pub struct WorkspaceRegistry {
    entries: Arc<RwLock<HashMap<Uuid, Workspace>>>,
}

impl WorkspaceRegistry {
    #[must_use]
    pub fn from_workspaces(workspaces: impl IntoIterator<Item = Workspace>) -> Self {
        Self {
            entries: Arc::new(RwLock::new(
                workspaces
                    .into_iter()
                    .map(|workspace| (workspace.id, workspace))
                    .collect(),
            )),
        }
    }

    pub fn enroll(
        &self,
        root: &Path,
        repository_identity: String,
    ) -> Result<Workspace, WorkspaceError> {
        let canonical_root = fs::canonicalize(root)?;
        let workspace = Workspace {
            id: Uuid::now_v7(),
            root: canonical_root,
            repository_identity,
            excluded_paths: Vec::new(),
            revoked: false,
        };
        self.entries
            .write()
            .map_err(|_| WorkspaceError::LockPoisoned)?
            .insert(workspace.id, workspace.clone());
        Ok(workspace)
    }

    pub fn revoke(&self, id: Uuid) -> Result<(), WorkspaceError> {
        let mut entries = self
            .entries
            .write()
            .map_err(|_| WorkspaceError::LockPoisoned)?;
        let workspace = entries.get_mut(&id).ok_or(WorkspaceError::NotEnrolled)?;
        workspace.revoked = true;
        Ok(())
    }

    pub fn is_active(&self, id: Uuid) -> Result<bool, WorkspaceError> {
        let entries = self
            .entries
            .read()
            .map_err(|_| WorkspaceError::LockPoisoned)?;
        Ok(entries.get(&id).is_some_and(|workspace| !workspace.revoked))
    }

    pub fn get(&self, id: Uuid) -> Result<Workspace, WorkspaceError> {
        let entries = self
            .entries
            .read()
            .map_err(|_| WorkspaceError::LockPoisoned)?;
        let workspace = entries.get(&id).ok_or(WorkspaceError::NotEnrolled)?;
        if workspace.revoked {
            return Err(WorkspaceError::Revoked);
        }
        Ok(workspace.clone())
    }

    pub fn list(&self) -> Result<Vec<Workspace>, WorkspaceError> {
        let entries = self
            .entries
            .read()
            .map_err(|_| WorkspaceError::LockPoisoned)?;
        let mut workspaces = entries.values().cloned().collect::<Vec<_>>();
        workspaces.sort_by(|left, right| left.root.cmp(&right.root));
        Ok(workspaces)
    }

    pub fn resolve_for_path(&self, requested: &Path) -> Result<Workspace, WorkspaceError> {
        let canonical = fs::canonicalize(requested)?;
        let entries = self
            .entries
            .read()
            .map_err(|_| WorkspaceError::LockPoisoned)?;
        entries
            .values()
            .filter(|workspace| !workspace.revoked && canonical.starts_with(&workspace.root))
            .max_by_key(|workspace| workspace.root.components().count())
            .cloned()
            .ok_or(WorkspaceError::NotEnrolled)
    }

    pub fn authorize_read(&self, id: Uuid, requested: &Path) -> Result<PathBuf, WorkspaceError> {
        let entries = self
            .entries
            .read()
            .map_err(|_| WorkspaceError::LockPoisoned)?;
        let workspace = entries.get(&id).ok_or(WorkspaceError::NotEnrolled)?;
        if workspace.revoked {
            return Err(WorkspaceError::Revoked);
        }
        let candidate = if requested.is_absolute() {
            requested.to_path_buf()
        } else {
            workspace.root.join(requested)
        };
        let canonical = fs::canonicalize(candidate)?;
        if !canonical.starts_with(&workspace.root) {
            return Err(WorkspaceError::OutsideWorkspace);
        }
        if is_sensitive(&workspace.root, &canonical)
            || workspace
                .excluded_paths
                .iter()
                .any(|excluded| canonical.starts_with(workspace.root.join(excluded)))
        {
            return Err(WorkspaceError::SensitivePath);
        }
        Ok(canonical)
    }
}

fn is_sensitive(root: &Path, candidate: &Path) -> bool {
    const SENSITIVE_NAMES: &[&str] = &[
        ".aws",
        ".env",
        ".env.local",
        ".git",
        ".gnupg",
        ".npmrc",
        ".pypirc",
        ".ssh",
        ".netrc",
        "credentials",
        "id_rsa",
        "id_ed25519",
        "secrets",
    ];

    candidate.strip_prefix(root).map_or(true, |relative| {
        relative.components().any(|component| {
            let Component::Normal(name) = component else {
                return false;
            };
            SENSITIVE_NAMES
                .iter()
                .any(|sensitive| name.eq_ignore_ascii_case(sensitive))
        })
    })
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;

    use tempfile::tempdir;

    use super::{WorkspaceError, WorkspaceRegistry};

    #[test]
    fn denies_sensitive_files_and_symlink_escape() {
        let root = tempdir().expect("workspace tempdir");
        let outside = tempdir().expect("outside tempdir");
        fs::write(root.path().join("safe.rs"), "fn safe() {}").expect("safe fixture");
        fs::write(root.path().join(".env"), "TOKEN=private").expect("secret fixture");
        fs::write(outside.path().join("outside.rs"), "private").expect("outside fixture");
        #[cfg(unix)]
        std::os::unix::fs::symlink(
            outside.path().join("outside.rs"),
            root.path().join("escape.rs"),
        )
        .expect("symlink fixture");

        let registry = WorkspaceRegistry::default();
        let workspace = registry
            .enroll(root.path(), "repo:test".into())
            .expect("enrollment");
        assert!(
            registry
                .authorize_read(workspace.id, Path::new("safe.rs"))
                .is_ok()
        );
        assert!(matches!(
            registry.authorize_read(workspace.id, Path::new(".env")),
            Err(WorkspaceError::SensitivePath)
        ));
        #[cfg(unix)]
        assert!(matches!(
            registry.authorize_read(workspace.id, Path::new("escape.rs")),
            Err(WorkspaceError::OutsideWorkspace)
        ));
    }
}
