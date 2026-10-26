//! Local git access for server sync (libgit2 through git2, no network).

use git2::{Delta, ObjectType, Oid, Repository, Status, StatusOptions, TreeWalkMode, TreeWalkResult};
use serde::Serialize;

fn open(dir: &str) -> Result<Repository, String> {
    Repository::open(dir).map_err(|e| format!("{dir}: {}", e.message()))
}

fn commit_oid(repo: &Repository, rev: &str) -> Result<Oid, String> {
    let obj = repo.revparse_single(rev).map_err(|e| format!("{rev}: {}", e.message()))?;
    obj.peel_to_commit().map(|c| c.id()).map_err(|e| format!("{rev}: {}", e.message()))
}

#[derive(Serialize)]
pub struct RepoStatus {
    head: Option<String>,
    branch: Option<String>,
    /// Committed time of HEAD, seconds since the epoch.
    head_time: Option<i64>,
    head_summary: Option<String>,
    /// Tracked files with uncommitted changes (relative, "/").
    dirty: Vec<String>,
}

/// Errors only if `dir` is not a repository.
pub fn status(dir: &str) -> Result<RepoStatus, String> {
    let repo = open(dir)?;
    let head = repo.head().ok();
    let commit = head.as_ref().and_then(|h| h.peel_to_commit().ok());
    let mut opts = StatusOptions::new();
    opts.include_untracked(false).include_ignored(false);
    let dirty = repo
        .statuses(Some(&mut opts))
        .map(|st| {
            st.iter()
                .filter(|e| e.status() != Status::CURRENT)
                .filter_map(|e| e.path().ok().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default();
    Ok(RepoStatus {
        head: commit.as_ref().map(|c| c.id().to_string()),
        branch: head.as_ref().and_then(|h| h.shorthand().ok().map(str::to_owned)),
        head_time: commit.as_ref().map(|c| c.time().seconds()),
        head_summary: commit.as_ref().and_then(|c| c.summary().ok().flatten().map(str::to_owned)),
        dirty,
    })
}

#[derive(Serialize)]
pub struct TreeFile {
    path: String,
    size: u64,
    /// Git blob id; identical content has the same id.
    oid: String,
}

/// Every file in the commit's tree (symlinks and submodules skipped).
pub fn tree(dir: &str, rev: &str) -> Result<Vec<TreeFile>, String> {
    let repo = open(dir)?;
    let commit = repo.find_commit(commit_oid(&repo, rev)?).map_err(|e| e.message().to_string())?;
    let tree = commit.tree().map_err(|e| e.message().to_string())?;
    let odb = repo.odb().map_err(|e| e.message().to_string())?;
    let mut files = Vec::new();
    tree.walk(TreeWalkMode::PreOrder, |root, entry| {
        // 0o100644 / 0o100755 are regular files; 0o120000 links, 0o160000 submodules.
        let mode = entry.filemode();
        if entry.kind() == Some(ObjectType::Blob) && (mode == 0o100644 || mode == 0o100755) {
            if let Ok(name) = entry.name() {
                let size = odb.read_header(entry.id()).map(|(len, _)| len as u64).unwrap_or(0);
                files.push(TreeFile { path: format!("{root}{name}"), size, oid: entry.id().to_string() });
            }
        }
        TreeWalkResult::Ok
    })
    .map_err(|e| e.message().to_string())?;
    Ok(files)
}

/// Whether the commit exists in this repository.
pub fn has_commit(dir: &str, sha: &str) -> Result<bool, String> {
    let repo = open(dir)?;
    let found = Oid::from_str(sha).ok().and_then(|oid| repo.find_commit(oid).ok()).is_some();
    Ok(found)
}

/// True if `ancestor` is reachable from `descendant` (or the same commit).
pub fn is_ancestor(dir: &str, ancestor: &str, descendant: &str) -> Result<bool, String> {
    let repo = open(dir)?;
    let a = commit_oid(&repo, ancestor)?;
    let d = commit_oid(&repo, descendant)?;
    Ok(a == d || repo.graph_descendant_of(d, a).map_err(|e| e.message().to_string())?)
}

/// Number of commits in `to` that `from` does not have.
pub fn commits_between(dir: &str, from: &str, to: &str) -> Result<usize, String> {
    let repo = open(dir)?;
    let (ahead, _) = repo
        .graph_ahead_behind(commit_oid(&repo, to)?, commit_oid(&repo, from)?)
        .map_err(|e| e.message().to_string())?;
    Ok(ahead)
}

#[derive(Serialize)]
pub struct Change {
    path: String,
    /// "added", "modified", "deleted" (renames are split into deleted + added).
    status: &'static str,
}

/// Files that differ between two commits.
pub fn diff(dir: &str, from: &str, to: &str) -> Result<Vec<Change>, String> {
    let repo = open(dir)?;
    let tree_of = |rev: &str| -> Result<git2::Tree<'_>, String> {
        let commit = repo.find_commit(commit_oid(&repo, rev)?).map_err(|e| e.message().to_string())?;
        commit.tree().map_err(|e| e.message().to_string())
    };
    let (a, b) = (tree_of(from)?, tree_of(to)?);
    let diff = repo.diff_tree_to_tree(Some(&a), Some(&b), None).map_err(|e| e.message().to_string())?;
    let mut changes = Vec::new();
    for d in diff.deltas() {
        let old = d.old_file().path().map(|p| p.to_string_lossy().replace('\\', "/"));
        let new = d.new_file().path().map(|p| p.to_string_lossy().replace('\\', "/"));
        match d.status() {
            Delta::Added | Delta::Copied => changes.extend(new.map(|path| Change { path, status: "added" })),
            Delta::Deleted => changes.extend(old.map(|path| Change { path, status: "deleted" })),
            Delta::Renamed => {
                changes.extend(old.map(|path| Change { path, status: "deleted" }));
                changes.extend(new.map(|path| Change { path, status: "added" }));
            }
            Delta::Modified | Delta::Typechange => changes.extend(new.map(|path| Change { path, status: "modified" })),
            _ => {}
        }
    }
    Ok(changes)
}

/// Contents of a file in a commit, for `.totzilla-ignore` (empty if missing).
pub fn read_file(dir: &str, rev: &str, path: &str) -> Result<String, String> {
    let repo = open(dir)?;
    let commit = repo.find_commit(commit_oid(&repo, rev)?).map_err(|e| e.message().to_string())?;
    let tree = commit.tree().map_err(|e| e.message().to_string())?;
    let Ok(entry) = tree.get_path(std::path::Path::new(path)) else {
        return Ok(String::new());
    };
    let blob = repo.find_blob(entry.id()).map_err(|e| e.message().to_string())?;
    Ok(String::from_utf8_lossy(blob.content()).into_owned())
}
