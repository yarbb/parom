//! Local git access for server sync (libgit2 through git2, no network).
//!
//! A site's local folder may be a repository or a folder inside one (the
//! server's files moved into `serverFiles/`). Sync then sees only that
//! folder: paths are relative to it, as if it were the repository's root.

use git2::{Delta, ObjectType, Oid, Repository, Status, StatusOptions, TreeWalkMode, TreeWalkResult};
use serde::Serialize;
use std::path::{Path, PathBuf};

/// The repository holding `dir`, and where `dir` sits in it: "" at the
/// root, else e.g. "serverFiles/" (with "/").
fn open(dir: &str) -> Result<(Repository, String), String> {
    let repo = Repository::discover(dir).map_err(|e| format!("{dir}: {}", e.message()))?;
    let prefix = repo
        .workdir()
        .and_then(|w| Some((w.canonicalize().ok()?, Path::new(dir).canonicalize().ok()?)))
        .and_then(|(w, d)| d.strip_prefix(&w).ok().map(|rel| rel.to_string_lossy().replace('\\', "/")))
        .filter(|rel| !rel.is_empty())
        .map(|rel| format!("{}/", rel.trim_end_matches('/')))
        .unwrap_or_default();
    Ok((repo, prefix))
}

#[derive(Serialize)]
pub struct Location {
    /// The repository's folder, written like `dir`.
    root: String,
    /// `dir` inside it, "/" separated; "" for the root.
    sub: String,
}

/// Which repository a site's local folder belongs to.
pub fn locate(dir: &str) -> Result<Location, String> {
    let (_, prefix) = open(dir)?;
    let mut root = PathBuf::from(dir.trim_end_matches(['/', '\\']));
    for _ in prefix.split('/').filter(|s| !s.is_empty()) {
        root.pop();
    }
    Ok(Location { root: root.to_string_lossy().into_owned(), sub: prefix.trim_end_matches('/').to_owned() })
}

/// The tree sync sees in a commit: the folder's own tree, or the whole tree
/// of a commit made before the folder existed (its files were moved into it
/// later, so they sat at the root then, where the server has them).
fn scoped_tree<'r>(repo: &'r Repository, prefix: &str, rev: &str) -> Result<git2::Tree<'r>, String> {
    let commit = repo.find_commit(commit_oid(repo, rev)?).map_err(|e| e.message().to_string())?;
    let tree = commit.tree().map_err(|e| e.message().to_string())?;
    if prefix.is_empty() {
        return Ok(tree);
    }
    match tree.get_path(Path::new(prefix.trim_end_matches('/'))) {
        Ok(e) if e.kind() == Some(ObjectType::Tree) => repo.find_tree(e.id()).map_err(|e| e.message().to_string()),
        _ => Ok(tree),
    }
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

/// Errors if `dir` is not in a repository, or is a folder the last commit
/// does not have yet (sync deploys commits).
pub fn status(dir: &str) -> Result<RepoStatus, String> {
    let (repo, prefix) = open(dir)?;
    let head = repo.head().ok();
    let commit = head.as_ref().and_then(|h| h.peel_to_commit().ok());
    let mut opts = StatusOptions::new();
    opts.include_untracked(false).include_ignored(false);
    let head_tree = commit.as_ref().and_then(|c| c.tree().ok());
    let folder = prefix.trim_end_matches('/');
    if let (false, Some(tree)) = (folder.is_empty(), head_tree.as_ref()) {
        if tree.get_path(Path::new(folder)).is_err() {
            return Err(format!("{folder}: this folder is not in the last commit yet; commit it first"));
        }
    }
    let dirty = repo
        .statuses(Some(&mut opts))
        .map(|st| {
            st.iter()
                .filter(|e| e.status() != Status::CURRENT)
                .filter_map(|e| e.path().ok().map(str::to_owned).map(|p| (p, e.status())))
                .filter(|(path, status)| !only_line_endings(&repo, head_tree.as_ref(), path, *status))
                .filter_map(|(path, _)| path.strip_prefix(prefix.as_str()).map(str::to_owned))
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

/// True for a file libgit2 calls modified although its content equals the
/// committed blob once CRLF is turned into LF (or as is). git with
/// `core.autocrlf` treats these as clean, so GitHub Desktop shows nothing.
pub(crate) fn only_line_endings(repo: &Repository, head: Option<&git2::Tree<'_>>, path: &str, status: Status) -> bool {
    if status != Status::WT_MODIFIED {
        return false;
    }
    let (Some(head), Some(workdir)) = (head, repo.workdir()) else {
        return false;
    };
    let Ok(entry) = head.get_path(std::path::Path::new(path)) else {
        return false;
    };
    let Ok(bytes) = std::fs::read(workdir.join(path)) else {
        return false;
    };
    blob_ids(&bytes).contains(&Some(entry.id()))
}

/// Blob ids of a working file's bytes: as they are, and with CRLF turned
/// into LF (what git stores with `core.autocrlf`).
pub(crate) fn blob_ids(bytes: &[u8]) -> [Option<Oid>; 2] {
    let hash = |data: &[u8]| Oid::hash_object(ObjectType::Blob, data).ok();
    let mut lf = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\r' && bytes.get(i + 1) == Some(&b'\n') {
            i += 1;
            continue;
        }
        lf.push(bytes[i]);
        i += 1;
    }
    [hash(bytes), hash(&lf)]
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
    let (repo, prefix) = open(dir)?;
    let tree = scoped_tree(&repo, &prefix, rev)?;
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
    let (repo, _) = open(dir)?;
    let found = Oid::from_str(sha).ok().and_then(|oid| repo.find_commit(oid).ok()).is_some();
    Ok(found)
}

/// True if `ancestor` is reachable from `descendant` (or the same commit).
pub fn is_ancestor(dir: &str, ancestor: &str, descendant: &str) -> Result<bool, String> {
    let (repo, _) = open(dir)?;
    let a = commit_oid(&repo, ancestor)?;
    let d = commit_oid(&repo, descendant)?;
    Ok(a == d || repo.graph_descendant_of(d, a).map_err(|e| e.message().to_string())?)
}

/// Number of commits in `to` that `from` does not have.
pub fn commits_between(dir: &str, from: &str, to: &str) -> Result<usize, String> {
    let (repo, _) = open(dir)?;
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
    let (repo, prefix) = open(dir)?;
    let (a, b) = (scoped_tree(&repo, &prefix, from)?, scoped_tree(&repo, &prefix, to)?);
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

/// Contents of a file in a commit, for `.parom-ignore` (empty if missing).
/// In a folder inside the repository, a top-level file missing there is
/// read from the repository's root (one `.parom-ignore` for the repository).
pub fn read_file(dir: &str, rev: &str, path: &str) -> Result<String, String> {
    let (repo, prefix) = open(dir)?;
    let tree = scoped_tree(&repo, &prefix, rev)?;
    let root = || repo.find_commit(commit_oid(&repo, rev).ok()?).ok()?.tree().ok();
    let entry = match tree.get_path(Path::new(path)) {
        Ok(entry) => entry,
        Err(_) if !prefix.is_empty() && !path.contains('/') => match root().and_then(|t| t.get_path(Path::new(path)).ok()) {
            Some(entry) => entry,
            None => return Ok(String::new()),
        },
        Err(_) => return Ok(String::new()),
    };
    let blob = repo.find_blob(entry.id()).map_err(|e| e.message().to_string())?;
    Ok(String::from_utf8_lossy(blob.content()).into_owned())
}

/// Writes the committed version of `paths` below `dest` (same relative
/// layout), so a sync deploys exactly the commit, whatever is on disk.
pub fn export(dir: &str, rev: &str, paths: &[String], dest: &str) -> Result<(), String> {
    let (repo, prefix) = open(dir)?;
    let tree = scoped_tree(&repo, &prefix, rev)?;
    for path in paths {
        let entry = tree.get_path(Path::new(path)).map_err(|e| format!("{path}: {}", e.message()))?;
        let blob = repo.find_blob(entry.id()).map_err(|e| format!("{path}: {}", e.message()))?;
        let target = Path::new(dest).join(path);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
        }
        std::fs::write(&target, blob.content()).map_err(|e| format!("{}: {e}", target.display()))?;
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use git2::Signature;
    use std::fs;

    fn commit_all(repo: &Repository, message: &str) -> String {
        let mut index = repo.index().unwrap();
        index.add_all(["*"], git2::IndexAddOption::DEFAULT, None).unwrap();
        index.update_all(["*"], None).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let sig = Signature::now("Test", "test@example.com").unwrap();
        let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
        let parents: Vec<&git2::Commit<'_>> = parent.iter().collect();
        repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parents).unwrap().to_string()
    }

    #[test]
    fn a_folder_inside_the_repository_is_its_own_root() {
        let root = std::env::temp_dir().join(format!("parom-test-scoped-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("lua")).unwrap();
        let repo = Repository::init(&root).unwrap();
        fs::write(root.join("lua/a.lua"), "a\n").unwrap();
        fs::write(root.join(".parom-ignore"), "data/\n").unwrap();
        let before = commit_all(&repo, "server files at the root");
        // The server's files move into server/, and one of them changes.
        fs::create_dir_all(root.join("server/lua")).unwrap();
        fs::rename(root.join("lua/a.lua"), root.join("server/lua/a.lua")).unwrap();
        fs::write(root.join("server/lua/b.lua"), "b\n").unwrap();
        let after = commit_all(&repo, "move into server/");
        let sub = root.join("server");
        let dir = sub.to_str().unwrap();

        let at = locate(dir).unwrap();
        assert_eq!((at.root.as_str(), at.sub.as_str()), (root.to_str().unwrap(), "server"));
        let paths = |files: Vec<TreeFile>| files.into_iter().map(|f| f.path).collect::<Vec<_>>();
        assert_eq!(paths(tree(dir, &after).unwrap()), vec!["lua/a.lua", "lua/b.lua"]);
        // The commit before the move has no server/: its root is what was deployed.
        assert_eq!(paths(tree(dir, &before).unwrap()), vec![".parom-ignore", "lua/a.lua"]);
        let changed: Vec<(String, &str)> = diff(dir, &before, &after).unwrap().into_iter().map(|c| (c.path, c.status)).collect();
        assert_eq!(changed, vec![(".parom-ignore".to_owned(), "deleted"), ("lua/b.lua".to_owned(), "added")]);
        // .parom-ignore at the repository's root still counts.
        assert_eq!(read_file(dir, &after, ".parom-ignore").unwrap(), "data/\n");

        fs::write(root.join("server/lua/a.lua"), "edited\n").unwrap();
        fs::write(root.join("README.md"), "outside\n").unwrap();
        assert_eq!(status(dir).unwrap().dirty, vec!["lua/a.lua"]);

        let out = root.join("out");
        export(dir, &after, &["lua/b.lua".to_owned()], out.to_str().unwrap()).unwrap();
        assert_eq!(fs::read_to_string(out.join("lua/b.lua")).unwrap(), "b\n");

        // A folder the last commit does not have yet is refused.
        fs::create_dir_all(root.join("later")).unwrap();
        assert!(status(root.join("later").to_str().unwrap()).is_err());
        let _ = fs::remove_dir_all(root);
    }
}
