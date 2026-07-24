use std::fs;
use std::path::Path;
use std::process::Command;

use serde_json::{Value, json};
use thiserror::Error;
use uuid::Uuid;
use walkdir::{DirEntry, WalkDir};

use crate::workspace::{WorkspaceError, WorkspaceRegistry};

const MAX_FILE_BYTES: u64 = 1_048_576;
const MAX_RESULT_BYTES: usize = 65_536;
const MAX_FILES: usize = 500;
const MAX_MATCHES: usize = 100;

#[derive(Debug, Error)]
pub enum WorkspaceToolError {
    #[error(transparent)]
    Workspace(#[from] WorkspaceError),
    #[error("workspace I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("file is not valid UTF-8 text")]
    NotText,
    #[error("query must contain between 2 and 200 characters")]
    InvalidQuery,
    #[error("Git query failed")]
    GitFailed,
}

pub fn read_text(
    registry: &WorkspaceRegistry,
    workspace_id: Uuid,
    path: &Path,
) -> Result<Value, WorkspaceToolError> {
    let authorized = registry.authorize_read(workspace_id, path)?;
    let metadata = fs::metadata(&authorized)?;
    if !metadata.is_file() || metadata.len() > MAX_FILE_BYTES {
        return Err(WorkspaceToolError::NotText);
    }
    let bytes = fs::read(&authorized)?;
    let content = String::from_utf8(bytes).map_err(|_| WorkspaceToolError::NotText)?;
    Ok(json!({
        "path": authorized,
        "content": truncate(&content, MAX_RESULT_BYTES),
        "truncated": content.len() > MAX_RESULT_BYTES,
    }))
}

pub fn list_files(
    registry: &WorkspaceRegistry,
    workspace_id: Uuid,
    path: &Path,
) -> Result<Value, WorkspaceToolError> {
    let root = registry.authorize_read(workspace_id, path)?;
    let workspace = registry.get(workspace_id)?;
    let mut files = Vec::new();
    for entry in WalkDir::new(&root)
        .follow_links(false)
        .max_depth(12)
        .into_iter()
        .filter_entry(is_visible_entry)
        .filter_map(Result::ok)
    {
        if files.len() >= MAX_FILES {
            break;
        }
        if !entry.file_type().is_file() {
            continue;
        }
        let Ok(authorized) = registry.authorize_read(workspace_id, entry.path()) else {
            continue;
        };
        if let Ok(relative) = authorized.strip_prefix(&workspace.root) {
            files.push(relative.to_string_lossy().into_owned());
        }
    }
    Ok(json!({ "files": files, "truncated": files.len() >= MAX_FILES }))
}

pub fn search_literal(
    registry: &WorkspaceRegistry,
    workspace_id: Uuid,
    path: &Path,
    query: &str,
) -> Result<Value, WorkspaceToolError> {
    if !(2..=200).contains(&query.len()) {
        return Err(WorkspaceToolError::InvalidQuery);
    }
    let root = registry.authorize_read(workspace_id, path)?;
    let workspace = registry.get(workspace_id)?;
    let mut matches = Vec::new();
    for entry in WalkDir::new(root)
        .follow_links(false)
        .max_depth(12)
        .into_iter()
        .filter_entry(is_visible_entry)
        .filter_map(Result::ok)
    {
        if matches.len() >= MAX_MATCHES || !entry.file_type().is_file() {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if metadata.len() > MAX_FILE_BYTES {
            continue;
        }
        let Ok(authorized) = registry.authorize_read(workspace_id, entry.path()) else {
            continue;
        };
        let Ok(content) = fs::read_to_string(&authorized) else {
            continue;
        };
        for (line_index, line) in content.lines().enumerate() {
            if line.contains(query) {
                let relative = authorized
                    .strip_prefix(&workspace.root)
                    .unwrap_or(&authorized)
                    .to_string_lossy();
                matches.push(json!({
                    "path": relative,
                    "line": line_index + 1,
                    "preview": truncate(line.trim(), 400),
                }));
                if matches.len() >= MAX_MATCHES {
                    break;
                }
            }
        }
    }
    Ok(json!({ "matches": matches, "truncated": matches.len() >= MAX_MATCHES }))
}

pub fn git_query(
    registry: &WorkspaceRegistry,
    workspace_id: Uuid,
    kind: &str,
) -> Result<Value, WorkspaceToolError> {
    let workspace = registry.get(workspace_id)?;
    let mut command = Command::new("git");
    command
        .current_dir(&workspace.root)
        .args(["-c", "core.pager=cat", "--literal-pathspecs"]);
    match kind {
        "status" => {
            command.args(["status", "--short", "--branch", "--untracked-files=normal"]);
        }
        "diff_summary" => {
            command.args(["diff", "--no-ext-diff", "--no-textconv", "--stat", "--"]);
        }
        _ => return Err(WorkspaceToolError::GitFailed),
    }
    let output = command.output()?;
    if !output.status.success() {
        return Err(WorkspaceToolError::GitFailed);
    }
    let stdout = String::from_utf8(output.stdout).map_err(|_| WorkspaceToolError::NotText)?;
    Ok(json!({
        "output": truncate(&stdout, MAX_RESULT_BYTES),
        "truncated": stdout.len() > MAX_RESULT_BYTES,
    }))
}

fn is_visible_entry(entry: &DirEntry) -> bool {
    if entry.depth() == 0 {
        return true;
    }
    let name = entry.file_name().to_string_lossy();
    !matches!(
        name.as_ref(),
        ".git"
            | ".env"
            | ".env.local"
            | ".ssh"
            | ".aws"
            | ".gnupg"
            | "node_modules"
            | "target"
            | "dist"
            | "out"
    )
}

fn truncate(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_owned();
    }
    let mut boundary = max_bytes;
    while !value.is_char_boundary(boundary) {
        boundary -= 1;
    }
    value[..boundary].to_owned()
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;

    use tempfile::tempdir;

    use super::{list_files, read_text, search_literal};
    use crate::workspace::WorkspaceRegistry;

    #[test]
    fn exposes_bounded_text_tools_without_sensitive_files() {
        let root = tempdir().expect("workspace");
        fs::write(root.path().join("safe.txt"), "semantic checkpoint\n").expect("safe fixture");
        fs::write(root.path().join(".env"), "TOKEN=secret\n").expect("secret fixture");
        let registry = WorkspaceRegistry::default();
        let workspace = registry
            .enroll(root.path(), "repo:test".into())
            .expect("enroll workspace");

        let listed = list_files(&registry, workspace.id, Path::new(".")).expect("list files");
        assert_eq!(listed["files"], serde_json::json!(["safe.txt"]));
        let read = read_text(&registry, workspace.id, Path::new("safe.txt")).expect("read file");
        assert_eq!(read["content"], "semantic checkpoint\n");
        let matches =
            search_literal(&registry, workspace.id, Path::new("."), "checkpoint").expect("search");
        assert_eq!(matches["matches"].as_array().map_or(0, Vec::len), 1);
        assert!(read_text(&registry, workspace.id, Path::new(".env")).is_err());
    }
}
