use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex, RwLock};

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
    allowlist_path: Arc<RwLock<Option<PathBuf>>>,
    mutation_lock: Arc<Mutex<()>>,
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
            allowlist_path: Arc::new(RwLock::new(None)),
            mutation_lock: Arc::new(Mutex::new(())),
        }
    }

    pub fn with_allowlist_path(self, path: PathBuf) -> Result<Self, WorkspaceError> {
        {
            let _mutation = self
                .mutation_lock
                .lock()
                .map_err(|_| WorkspaceError::LockPoisoned)?;
            *self
                .allowlist_path
                .write()
                .map_err(|_| WorkspaceError::LockPoisoned)? = Some(path);
            self.write_allowlist()?;
        }
        Ok(self)
    }

    pub fn enroll(
        &self,
        root: &Path,
        repository_identity: String,
    ) -> Result<Workspace, WorkspaceError> {
        let workspace = self.prepare_enrollment(root, repository_identity)?;
        self.commit_enrollment(&workspace)?;
        Ok(workspace)
    }

    pub fn prepare_enrollment(
        &self,
        root: &Path,
        repository_identity: String,
    ) -> Result<Workspace, WorkspaceError> {
        let canonical_root = fs::canonicalize(root)?;
        let repository_identity =
            if let Some((identity, top_level)) = derive_git_repository(&canonical_root)? {
                if canonical_root != top_level {
                    return Err(WorkspaceError::OutsideWorkspace);
                }
                identity
            } else {
                repository_identity
            };
        let workspace = Workspace {
            id: Uuid::now_v7(),
            root: canonical_root,
            repository_identity,
            excluded_paths: Vec::new(),
            revoked: false,
        };
        Ok(workspace)
    }

    pub fn commit_enrollment(&self, workspace: &Workspace) -> Result<(), WorkspaceError> {
        let _mutation = self
            .mutation_lock
            .lock()
            .map_err(|_| WorkspaceError::LockPoisoned)?;
        self.entries
            .write()
            .map_err(|_| WorkspaceError::LockPoisoned)?
            .insert(workspace.id, workspace.clone());
        if let Err(reason) = self.write_allowlist() {
            self.entries
                .write()
                .map_err(|_| WorkspaceError::LockPoisoned)?
                .remove(&workspace.id);
            let _ = self.write_allowlist();
            return Err(reason);
        }
        Ok(())
    }

    pub fn remove_enrollment(&self, id: Uuid) -> Result<(), WorkspaceError> {
        let _mutation = self
            .mutation_lock
            .lock()
            .map_err(|_| WorkspaceError::LockPoisoned)?;
        self.entries
            .write()
            .map_err(|_| WorkspaceError::LockPoisoned)?
            .remove(&id);
        self.write_allowlist()
    }

    pub fn revoke(&self, id: Uuid) -> Result<(), WorkspaceError> {
        let _mutation = self
            .mutation_lock
            .lock()
            .map_err(|_| WorkspaceError::LockPoisoned)?;
        let mut entries = self
            .entries
            .write()
            .map_err(|_| WorkspaceError::LockPoisoned)?;
        let workspace = entries.get_mut(&id).ok_or(WorkspaceError::NotEnrolled)?;
        workspace.revoked = true;
        drop(entries);
        self.write_allowlist()?;
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
        let direct = entries
            .values()
            .filter(|workspace| !workspace.revoked && canonical.starts_with(&workspace.root))
            .max_by_key(|workspace| workspace.root.components().count())
            .cloned();
        if direct.is_some() {
            return direct.ok_or(WorkspaceError::NotEnrolled);
        }

        let Some((identity, _)) = derive_git_repository(&canonical)? else {
            return Err(WorkspaceError::NotEnrolled);
        };
        let mut matches = entries
            .values()
            .filter(|workspace| {
                !workspace.revoked
                    && workspace.repository_identity == identity
                    && workspace.repository_identity.starts_with("git-common-dir:")
            })
            .cloned();
        let selected_workspace = matches.next().ok_or(WorkspaceError::NotEnrolled)?;
        if matches.next().is_some() {
            return Err(WorkspaceError::NotEnrolled);
        }
        Ok(selected_workspace)
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

    fn write_allowlist(&self) -> Result<(), WorkspaceError> {
        let path = self
            .allowlist_path
            .read()
            .map_err(|_| WorkspaceError::LockPoisoned)?
            .clone();
        let Some(path) = path else {
            return Ok(());
        };
        let entries = self
            .entries
            .read()
            .map_err(|_| WorkspaceError::LockPoisoned)?;
        let mut workspaces = entries
            .values()
            .filter(|workspace| !workspace.revoked)
            .map(|workspace| {
                serde_json::json!({
                    "root": workspace.root,
                    "repositoryIdentity": workspace.repository_identity,
                })
            })
            .collect::<Vec<_>>();
        workspaces.sort_by(|left, right| left["root"].as_str().cmp(&right["root"].as_str()));
        let bytes = serde_json::to_vec_pretty(&serde_json::json!({
            "schemaVersion": 1,
            "workspaces": workspaces,
        }))
        .map_err(std::io::Error::other)?;
        let temporary = path.with_extension(format!("json.{}.tmp", Uuid::now_v7()));
        fs::write(&temporary, bytes)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&temporary, fs::Permissions::from_mode(0o600))?;
        }
        fs::rename(temporary, path)?;
        Ok(())
    }
}

fn derive_git_repository(path: &Path) -> Result<Option<(String, PathBuf)>, WorkspaceError> {
    let common_output = git_output(
        path,
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )?;
    let Some(common_output) = common_output else {
        return Ok(None);
    };
    let common = String::from_utf8_lossy(&common_output.stdout);
    let common = common.trim();
    if common.is_empty() {
        return Ok(None);
    }
    let canonical_common = fs::canonicalize(common)?;

    let top_level_output = git_output(
        path,
        &["rev-parse", "--path-format=absolute", "--show-toplevel"],
    )?
    .ok_or(WorkspaceError::NotEnrolled)?;
    let top_level = String::from_utf8_lossy(&top_level_output.stdout);
    let canonical_top_level = fs::canonicalize(top_level.trim())?;

    let worktrees_output = git_output(path, &["worktree", "list", "--porcelain"])?
        .ok_or(WorkspaceError::NotEnrolled)?;
    let listed = String::from_utf8_lossy(&worktrees_output.stdout)
        .lines()
        .filter_map(|line| line.strip_prefix("worktree "))
        .filter_map(|listed| fs::canonicalize(listed).ok())
        .any(|listed| listed == canonical_top_level);
    if !listed {
        return Ok(None);
    }

    Ok(Some((
        format!("git-common-dir:{}", canonical_common.to_string_lossy()),
        canonical_top_level,
    )))
}

fn git_output(
    path: &Path,
    arguments: &[&str],
) -> Result<Option<std::process::Output>, WorkspaceError> {
    let output = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(arguments)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output();
    match output {
        Ok(output) if output.status.success() => Ok(Some(output)),
        Ok(_) => Ok(None),
        Err(reason) if reason.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(reason) => Err(WorkspaceError::Resolve(reason)),
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
    use std::process::Command;

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

    #[test]
    fn resolves_only_linked_worktrees_by_git_common_directory() {
        let container = tempdir().expect("container");
        let repository = container.path().join("repository");
        let linked = container.path().join("linked");
        let clone = container.path().join("clone");
        let forged = container.path().join("forged");
        fs::create_dir(&repository).expect("repository");
        run_git(&repository, &["init"]);
        run_git(
            &repository,
            &["config", "user.email", "intero@example.test"],
        );
        run_git(&repository, &["config", "user.name", "Intero Test"]);
        fs::write(repository.join("README.md"), "intero").expect("fixture");
        run_git(&repository, &["add", "README.md"]);
        run_git(&repository, &["commit", "-m", "initial"]);
        run_git(
            &repository,
            &[
                "worktree",
                "add",
                "--detach",
                linked.to_str().expect("linked path"),
            ],
        );
        let clone_result = Command::new("git")
            .args([
                "clone",
                repository.to_str().expect("repository path"),
                clone.to_str().expect("clone path"),
            ])
            .output()
            .expect("clone");
        assert!(clone_result.status.success());
        fs::create_dir(&forged).expect("forged directory");
        fs::write(
            forged.join(".git"),
            format!("gitdir: {}\n", repository.join(".git").display()),
        )
        .expect("forged git pointer");

        let registry = WorkspaceRegistry::default();
        let workspace = registry
            .enroll(&repository, "caller-controlled".into())
            .expect("enrollment");
        assert!(workspace.repository_identity.starts_with("git-common-dir:"));
        assert_eq!(
            registry
                .resolve_for_path(&linked)
                .expect("linked worktree")
                .id,
            workspace.id
        );
        assert!(matches!(
            registry.resolve_for_path(&clone),
            Err(WorkspaceError::NotEnrolled)
        ));
        assert!(matches!(
            registry.resolve_for_path(&forged),
            Err(WorkspaceError::NotEnrolled)
        ));
        fs::create_dir(repository.join("nested")).expect("nested directory");
        assert!(matches!(
            WorkspaceRegistry::default()
                .enroll(&repository.join("nested"), "caller-controlled".into()),
            Err(WorkspaceError::OutsideWorkspace)
        ));
    }

    fn run_git(directory: &Path, arguments: &[&str]) {
        let output = Command::new("git")
            .arg("-C")
            .arg(directory)
            .args(arguments)
            .output()
            .expect("git command");
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            arguments,
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
