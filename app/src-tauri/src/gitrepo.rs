//! Repository work for the GitHub tab: changes, diffs, commits, history,
//! fetch, pull and push (libgit2 through git2; HTTPS remotes only).

use git2::{
    BranchType, Oid, Cred, CredentialType, Delta, DiffOptions, ErrorCode, FetchOptions, ProxyOptions, PushOptions,
    Rebase, RemoteCallbacks, Repository, RepositoryState, Signature, Status, StatusOptions,
};
use serde::Serialize;
use std::path::Path;

fn open(dir: &str) -> Result<Repository, String> {
    Repository::open(dir).map_err(|e| format!("{dir}: {}", e.message()))
}

fn msg(e: git2::Error) -> String {
    e.message().to_string()
}

#[derive(Serialize)]
pub struct BranchInfo {
    branch: Option<String>,
    head: Option<String>,
    /// Remote the current branch pushes to and pulls from (its upstream's
    /// remote, else "origin", else the only remote).
    remote: Option<String>,
    /// e.g. "origin/main"; None when the branch has never been pushed.
    upstream: Option<String>,
    ahead: usize,
    behind: usize,
    remote_url: Option<String>,
    /// "owner/name" when that remote is on github.com.
    github: Option<String>,
}

/// "owner/name" from an HTTPS or SSH github.com URL.
pub fn github_slug(url: &str) -> Option<String> {
    let rest = url
        .strip_prefix("https://github.com/")
        .or_else(|| url.strip_prefix("http://github.com/"))
        .or_else(|| url.strip_prefix("git@github.com:"))
        .or_else(|| url.strip_prefix("ssh://git@github.com/"))
        .or_else(|| url.split_once("@github.com/").map(|(_, r)| r))?;
    let rest = rest.trim_end_matches('/');
    let rest = rest.strip_suffix(".git").unwrap_or(rest);
    let mut parts = rest.split('/');
    let (owner, name) = (parts.next()?, parts.next()?);
    (!owner.is_empty() && !name.is_empty() && parts.next().is_none()).then(|| format!("{owner}/{name}"))
}

/// The remote of the branch's upstream; without one, "origin" or the only remote.
fn branch_remote(repo: &Repository, branch: Option<&str>) -> Option<String> {
    let configured = branch.and_then(|b| {
        repo.branch_upstream_remote(&format!("refs/heads/{b}"))
            .ok()
            .and_then(|r| r.as_str().ok().map(str::to_owned))
    });
    if configured.is_some() {
        return configured;
    }
    let names = repo.remotes().ok()?;
    let names: Vec<String> = names.iter().filter_map(|r| r.ok().flatten().map(str::to_owned)).collect();
    if names.iter().any(|n| n == "origin") {
        Some("origin".into())
    } else if names.len() == 1 {
        names.into_iter().next()
    } else {
        None
    }
}

/// The upstream ref of the current branch, or <remote>/<branch> when none is set.
fn upstream_ref(repo: &Repository, branch: &str) -> Option<String> {
    let configured = repo
        .branch_upstream_name(&format!("refs/heads/{branch}"))
        .ok()
        .and_then(|b| b.as_str().ok().map(str::to_owned));
    if configured.is_some() {
        return configured;
    }
    let fallback = format!("refs/remotes/{}/{branch}", branch_remote(repo, Some(branch))?);
    repo.find_reference(&fallback).ok().map(|_| fallback)
}

/// The current branch's remote, opened; an error names what is missing.
fn current_remote(repo: &Repository) -> Result<git2::Remote<'_>, String> {
    let head = repo.head().ok();
    let branch = head.as_ref().filter(|h| h.is_branch()).and_then(|h| h.shorthand().ok().map(str::to_owned));
    let name = branch_remote(repo, branch.as_deref()).ok_or("This repository has no remote to use (add one named origin)")?;
    repo.find_remote(&name).map_err(|e| format!("{name}: {}", e.message()))
}

pub fn branch_info(dir: &str) -> Result<BranchInfo, String> {
    let repo = open(dir)?;
    let head = repo.head().ok();
    let branch = head.as_ref().filter(|h| h.is_branch()).and_then(|h| h.shorthand().ok().map(str::to_owned));
    let head_oid = head.as_ref().and_then(|h| h.target());
    let upstream = branch.as_deref().and_then(|b| upstream_ref(&repo, b));
    let (mut ahead, mut behind) = (0, 0);
    if let (Some(local), Some(up)) = (head_oid, upstream.as_deref()) {
        if let Ok(remote) = repo.refname_to_id(up) {
            (ahead, behind) = repo.graph_ahead_behind(local, remote).unwrap_or((0, 0));
        }
    }
    let remote = branch_remote(&repo, branch.as_deref());
    let remote_url = remote.as_deref().and_then(|n| repo.find_remote(n).ok()).and_then(|r| r.url().ok().map(str::to_owned));
    Ok(BranchInfo {
        github: remote_url.as_deref().and_then(github_slug),
        branch,
        head: head_oid.map(|o| o.to_string()),
        upstream: upstream.map(|u| u.trim_start_matches("refs/remotes/").to_owned()),
        ahead,
        behind,
        remote,
        remote_url,
    })
}

#[derive(Serialize)]
pub struct FileChange {
    path: String,
    /// "new", "modified", "deleted".
    status: &'static str,
}

/// Uncommitted changes, untracked files included (line-ending-only changes
/// are left out, like the sync bar does).
pub fn changes(dir: &str) -> Result<Vec<FileChange>, String> {
    let repo = open(dir)?;
    let mut opts = StatusOptions::new();
    opts.include_untracked(true).recurse_untracked_dirs(true).include_ignored(false);
    let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
    let statuses = repo.statuses(Some(&mut opts)).map_err(msg)?;
    let mut out = Vec::new();
    for e in statuses.iter() {
        let st = e.status();
        let Ok(path) = e.path() else { continue };
        if st.is_conflicted() || st == Status::CURRENT || st.is_ignored() {
            continue;
        }
        if crate::git::only_line_endings(&repo, head_tree.as_ref(), path, st) {
            continue;
        }
        let status = if st.intersects(Status::WT_NEW | Status::INDEX_NEW) && !st.intersects(Status::WT_DELETED) {
            "new"
        } else if st.intersects(Status::WT_DELETED | Status::INDEX_DELETED) {
            "deleted"
        } else {
            "modified"
        };
        out.push(FileChange { path: path.to_owned(), status });
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

#[derive(Serialize)]
pub struct DiffLine {
    /// '+', '-', ' ' or '@' (hunk header).
    kind: char,
    old: Option<u32>,
    new: Option<u32>,
    text: String,
}

#[derive(Serialize, Default)]
pub struct FileDiff {
    binary: bool,
    lines: Vec<DiffLine>,
    /// More lines than the viewer shows.
    truncated: bool,
}

const MAX_DIFF_LINES: usize = 5000;

/// The diff of one file: the working tree against HEAD, or (with `rev`)
/// that commit against its first parent.
pub fn file_diff(dir: &str, path: &str, rev: Option<&str>) -> Result<FileDiff, String> {
    let repo = open(dir)?;
    let mut opts = DiffOptions::new();
    opts.pathspec(path).disable_pathspec_match(true).context_lines(3);
    let diff = match rev {
        Some(rev) => {
            let commit = repo.revparse_single(rev).and_then(|o| o.peel_to_commit()).map_err(msg)?;
            let new_tree = commit.tree().map_err(msg)?;
            let old_tree = commit.parent(0).ok().and_then(|p| p.tree().ok());
            repo.diff_tree_to_tree(old_tree.as_ref(), Some(&new_tree), Some(&mut opts)).map_err(msg)?
        }
        None => {
            opts.include_untracked(true).recurse_untracked_dirs(true).show_untracked_content(true);
            let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
            repo.diff_tree_to_workdir_with_index(head_tree.as_ref(), Some(&mut opts)).map_err(msg)?
        }
    };
    let mut out = FileDiff::default();
    diff.print(git2::DiffFormat::Patch, |delta, _hunk, line| {
        if delta.flags().is_binary() {
            out.binary = true;
            return true;
        }
        let kind = match line.origin() {
            '+' | '>' => '+',
            '-' | '<' => '-',
            ' ' | '=' => ' ',
            'H' => '@',
            _ => return true,
        };
        if out.lines.len() >= MAX_DIFF_LINES {
            out.truncated = true;
            return false;
        }
        let text = String::from_utf8_lossy(line.content()).trim_end_matches(['\n', '\r']).to_owned();
        out.lines.push(DiffLine { kind, old: line.old_lineno(), new: line.new_lineno(), text });
        true
    })
    .or_else(|e| if out.truncated { Ok(()) } else { Err(msg(e)) })?;
    Ok(out)
}

/// The author for new commits: git's user.name / user.email, else the
/// fallback (the signed-in GitHub account).
fn signature<'a>(repo: &Repository, name: Option<&str>, email: Option<&str>) -> Result<Signature<'a>, String> {
    if let Ok(sig) = repo.signature() {
        return Ok(sig);
    }
    match (name, email) {
        (Some(n), Some(e)) if !n.is_empty() && !e.is_empty() => Signature::now(n, e).map_err(msg),
        _ => Err("Set user.name and user.email in git, or sign in to GitHub".into()),
    }
}

/// Commits exactly `paths` (added, changed or deleted in the working tree);
/// other changes stay uncommitted. Returns the new commit id.
pub fn commit(dir: &str, paths: &[String], message: &str, name: Option<&str>, email: Option<&str>) -> Result<String, String> {
    if message.trim().is_empty() {
        return Err("Write a commit summary".into());
    }
    if paths.is_empty() {
        return Err("Select at least one file".into());
    }
    let repo = open(dir)?;
    busy_check(&repo)?;
    let sig = signature(&repo, name, email)?;
    let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    // Anything staged elsewhere but not selected here is unstaged first, so
    // the commit holds only what the user ticked.
    if let Some(p) = parent.as_ref() {
        let selected: std::collections::HashSet<&str> = paths.iter().map(String::as_str).collect();
        let staged: Vec<String> = changes(dir)?.into_iter().map(|c| c.path).filter(|p| !selected.contains(p.as_str())).collect();
        if !staged.is_empty() {
            repo.reset_default(Some(p.as_object()), staged.iter().map(String::as_str)).map_err(msg)?;
        }
    }
    let workdir = repo.workdir().ok_or("Bare repositories are not supported")?.to_path_buf();
    let mut index = repo.index().map_err(msg)?;
    for path in paths {
        let rel = Path::new(path);
        if workdir.join(rel).exists() {
            index.add_path(rel).map_err(|e| format!("{path}: {}", e.message()))?;
        } else {
            index.remove_path(rel).map_err(|e| format!("{path}: {}", e.message()))?;
        }
    }
    let tree_id = index.write_tree().map_err(msg)?;
    // Ticked files whose changes are gone (a new file deleted again) leave
    // nothing to commit: no empty commits.
    let unchanged = match parent.as_ref() {
        Some(p) => p.tree_id() == tree_id,
        None => repo.find_tree(tree_id).map(|t| t.is_empty()).unwrap_or(false),
    };
    if unchanged {
        return Err("Nothing to commit: the selected files have no changes any more".into());
    }
    index.write().map_err(msg)?;
    let tree = repo.find_tree(tree_id).map_err(msg)?;
    let parents: Vec<&git2::Commit<'_>> = parent.iter().collect();
    let oid = repo.commit(Some("HEAD"), &sig, &sig, message.trim(), &tree, &parents).map_err(msg)?;
    Ok(oid.to_string())
}

/// Discards the changes of `paths` ("Discard changes" in the GitHub tab):
/// files known to HEAD get its version back; the others (new files) are
/// returned, for the caller to move to the Recycle Bin.
pub fn discard(dir: &str, paths: &[String]) -> Result<Vec<String>, String> {
    let repo = open(dir)?;
    let head = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    let tree = head.as_ref().and_then(|c| c.tree().ok());
    let (tracked, untracked): (Vec<&String>, Vec<&String>) =
        paths.iter().partition(|p| tree.as_ref().is_some_and(|t| t.get_path(Path::new(p.as_str())).is_ok()));
    if let (Some(commit), false) = (head.as_ref(), tracked.is_empty()) {
        repo.reset_default(Some(commit.as_object()), tracked.iter().map(|p| p.as_str())).map_err(msg)?;
        let mut co = git2::build::CheckoutBuilder::new();
        co.force().disable_pathspec_match(true);
        for p in &tracked {
            co.path(p.as_str());
        }
        repo.checkout_head(Some(&mut co)).map_err(msg)?;
    }
    if !untracked.is_empty() {
        // Staged new files leave the index too.
        let mut index = repo.index().map_err(msg)?;
        for p in &untracked {
            let _ = index.remove_path(Path::new(p.as_str()));
        }
        index.write().map_err(msg)?;
    }
    Ok(untracked.into_iter().cloned().collect())
}

#[derive(Serialize)]
pub struct LogEntry {
    sha: String,
    summary: String,
    body: String,
    author: String,
    email: String,
    time: i64,
}

/// Commits reachable from HEAD, newest first.
pub fn log(dir: &str, limit: usize) -> Result<Vec<LogEntry>, String> {
    let repo = open(dir)?;
    let mut walk = repo.revwalk().map_err(msg)?;
    if walk.push_head().is_err() {
        return Ok(Vec::new()); // no commits yet
    }
    walk.set_sorting(git2::Sort::TIME).map_err(msg)?;
    let mut out = Vec::new();
    for oid in walk.take(limit) {
        let Ok(c) = oid.and_then(|o| repo.find_commit(o)) else { continue };
        let author = c.author();
        out.push(LogEntry {
            sha: c.id().to_string(),
            summary: c.summary().ok().flatten().unwrap_or("").to_owned(),
            body: c.body().ok().flatten().unwrap_or("").trim().to_owned(),
            author: String::from_utf8_lossy(author.name_bytes()).into_owned(),
            email: String::from_utf8_lossy(author.email_bytes()).into_owned(),
            time: c.time().seconds(),
        });
    }
    Ok(out)
}

#[derive(Serialize)]
pub struct CommitFile {
    path: String,
    status: &'static str,
    additions: usize,
    deletions: usize,
}

/// Files a commit changed against its first parent, with line counts.
pub fn commit_files(dir: &str, rev: &str) -> Result<Vec<CommitFile>, String> {
    let repo = open(dir)?;
    let commit = repo.revparse_single(rev).and_then(|o| o.peel_to_commit()).map_err(msg)?;
    let new_tree = commit.tree().map_err(msg)?;
    let old_tree = commit.parent(0).ok().and_then(|p| p.tree().ok());
    let diff = repo.diff_tree_to_tree(old_tree.as_ref(), Some(&new_tree), None).map_err(msg)?;
    let mut out = Vec::new();
    for (i, d) in diff.deltas().enumerate() {
        let (path, status) = match d.status() {
            Delta::Added | Delta::Copied => (d.new_file().path(), "new"),
            Delta::Deleted => (d.old_file().path(), "deleted"),
            _ => (d.new_file().path(), "modified"),
        };
        let Some(path) = path else { continue };
        let (_, additions, deletions) = git2::Patch::from_diff(&diff, i)
            .ok()
            .flatten()
            .and_then(|p| p.line_stats().ok())
            .unwrap_or((0, 0, 0));
        out.push(CommitFile { path: path.to_string_lossy().replace('\\', "/"), status, additions, deletions });
    }
    Ok(out)
}

/// Credentials for HTTPS remotes: the GitHub token for github.com, else the
/// git credential helper (e.g. Git Credential Manager). Gives up after a
/// rejected attempt instead of letting libgit2 ask forever.
fn callbacks<'a>(repo: &'a Repository, token: Option<&'a str>) -> RemoteCallbacks<'a> {
    let mut cb = RemoteCallbacks::new();
    let mut tries = 0;
    cb.credentials(move |url, username, allowed| {
        tries += 1;
        if tries > 2 || !allowed.contains(CredentialType::USER_PASS_PLAINTEXT) {
            return Err(git2::Error::from_str("authentication failed (only HTTPS remotes are supported)"));
        }
        match token {
            Some(t) if tries == 1 && url.contains("github.com") => Cred::userpass_plaintext("x-access-token", t),
            _ => {
                let config = repo.config()?;
                Cred::credential_helper(&config, url, username)
            }
        }
    });
    cb
}

/// GitHub answered 401/403: the token may not write (or read) this repository.
fn refused(e: &git2::Error) -> bool {
    let m = e.message();
    e.code() == ErrorCode::Auth || m.contains("403") || m.contains("401")
}

/// Runs a network operation with the GitHub token, then once more with the
/// git credential helper if GitHub refused the token (a repository the app is
/// not installed on, or a token without write access).
fn with_credentials<T>(token: Option<&str>, url: &str, mut op: impl FnMut(Option<&str>) -> Result<T, git2::Error>) -> Result<T, String> {
    let result = match op(token) {
        Err(e) if token.is_some() && refused(&e) => op(None),
        other => other,
    };
    result.map_err(|e| {
        if refused(&e) {
            let repo = github_slug(url).unwrap_or_else(|| url.to_owned());
            format!(
                "GitHub refused access to {repo} ({}). Install the GitHub App on that repository's owner, sign in with a token that can write to it, or sign in to git (Git Credential Manager).",
                e.message()
            )
        } else {
            msg(e)
        }
    })
}

fn proxy<'a>() -> ProxyOptions<'a> {
    let mut p = ProxyOptions::new();
    p.auto();
    p
}

/// Fetches the branch's remote (all branches, like "Fetch origin" in GitHub Desktop).
pub fn fetch(dir: &str, token: Option<&str>) -> Result<BranchInfo, String> {
    {
        let repo = open(dir)?;
        let mut remote = current_remote(&repo)?;
        let url = remote.url().unwrap_or("").to_owned();
        with_credentials(token, &url, |t| {
            let mut opts = FetchOptions::new();
            opts.remote_callbacks(callbacks(&repo, t)).proxy_options(proxy());
            remote.fetch::<&str>(&[], Some(&mut opts), None)
        })?;
    }
    branch_info(dir)
}

/// Brings the current branch up to date with its upstream: a fast-forward,
/// or, when both sides have new commits, the local (unpushed) commits replayed
/// on top of the upstream (`rebase`, no merge commit) or a merge commit.
/// Refuses on conflicts or when local uncommitted changes would be
/// overwritten, leaving everything as it was.
pub fn pull(dir: &str, token: Option<&str>, name: Option<&str>, email: Option<&str>, rebase: bool) -> Result<BranchInfo, String> {
    busy_check(&open(dir)?)?;
    fetch(dir, token)?;
    let repo = open(dir)?;
    let head = repo.head().map_err(msg)?;
    let branch = head.shorthand().map_err(msg)?.to_owned();
    let up = upstream_ref(&repo, &branch).ok_or("This branch has no upstream branch on its remote")?;
    let target = repo.refname_to_id(&up).map_err(msg)?;
    let local = head.target().ok_or("HEAD is not a branch")?;
    let (ahead, behind) = repo.graph_ahead_behind(local, target).map_err(msg)?;
    if behind == 0 {
        return branch_info(dir);
    }
    if ahead > 0 {
        let sig = signature(&repo, name, email)?;
        let upstream = up.trim_start_matches("refs/remotes/");
        if rebase {
            rebase_onto(dir, &repo, &branch, target, upstream, &sig)?;
        } else {
            merge(&repo, &branch, local, target, &up, &sig)?;
        }
        return branch_info(dir);
    }
    let object = repo.find_object(target, None).map_err(msg)?;
    let mut checkout = git2::build::CheckoutBuilder::new();
    checkout.safe();
    repo.checkout_tree(&object, Some(&mut checkout))
        .map_err(|e| if e.code() == ErrorCode::Conflict { "Local changes would be overwritten; commit them first".into() } else { msg(e) })?;
    let mut reference = repo.find_reference(&format!("refs/heads/{branch}")).map_err(msg)?;
    reference.set_target(target, "pull: fast-forward").map_err(msg)?;
    drop(reference);
    branch_info(dir)
}

/// Replays the branch's own commits on top of `onto` in memory; only when
/// every commit applies is the result checked out and the branch moved.
/// Authors are kept; the one pulling becomes the committer, as with
/// `git pull --rebase`. On conflicting lines the rebase starts again in the
/// working tree and stops at the conflict for the user to resolve
/// (`conflicts`, `resolve`, `conflict_continue`, `conflict_abort`).
fn rebase_onto(dir: &str, repo: &Repository, branch: &str, onto: Oid, upstream: &str, sig: &Signature<'_>) -> Result<(), String> {
    let head = repo.head().map_err(msg)?;
    let ours = repo.reference_to_annotated_commit(&head).map_err(msg)?;
    let theirs = repo.find_annotated_commit(onto).map_err(msg)?;
    let mut opts = git2::RebaseOptions::new();
    opts.inmemory(true);
    let mut rebase = repo.rebase(Some(&ours), Some(&theirs), None, Some(&mut opts)).map_err(msg)?;
    let mut last = onto;
    while let Some(op) = rebase.next() {
        let op = op.map_err(msg)?;
        let index = rebase.inmemory_index().map_err(msg)?;
        if index.has_conflicts() {
            let files: Vec<String> = index
                .conflicts()
                .map_err(msg)?
                .filter_map(Result::ok)
                .filter_map(|c| c.our.or(c.their).map(|e| String::from_utf8_lossy(&e.path).into_owned()))
                .take(8)
                .collect();
            let _ = rebase.abort();
            drop(rebase);
            // A rebase in the working tree needs a clean one (new files aside).
            let own = local_edits(dir)?;
            if !own.is_empty() {
                return Err(format!(
                    "{branch} and {upstream} both changed the same lines in {}. To resolve that here, first commit or discard your uncommitted changes ({}), then pull again",
                    files.join(", "),
                    own.join(", ")
                ));
            }
            let mut disk = repo.rebase(Some(&ours), Some(&theirs), None, None).map_err(msg)?;
            return replay(repo, &mut disk, sig);
        }
        let original = repo.find_commit(op.id()).map_err(msg)?;
        let author = original.author();
        let committed = rebase.commit(Some(&author), sig, None);
        match committed {
            Ok(id) => last = id,
            // Already on the upstream (e.g. the same change pushed from elsewhere): nothing to replay.
            Err(e) if e.code() == ErrorCode::Applied => {}
            Err(e) => {
                let _ = rebase.abort();
                return Err(msg(e));
            }
        }
    }
    rebase.finish(None).map_err(msg)?;
    // The working tree first: a safe checkout stops before changing anything
    // if uncommitted local edits are in the way.
    let commit = repo.find_commit(last).map_err(msg)?;
    let mut checkout = git2::build::CheckoutBuilder::new();
    checkout.safe();
    repo.checkout_tree(commit.as_object(), Some(&mut checkout))
        .map_err(|e| if e.code() == ErrorCode::Conflict { "Local changes would be overwritten; commit them first".into() } else { msg(e) })?;
    let mut reference = repo.find_reference(&format!("refs/heads/{branch}")).map_err(msg)?;
    reference.set_target(last, &format!("pull: rebase onto {upstream}")).map_err(msg)?;
    Ok(())
}

/// Merges `theirs` into the current branch without touching anything when
/// local edits are in the way of the result. On conflicting lines the merge
/// is written to the working tree (conflict markers, MERGE_HEAD) for the
/// user to resolve.
fn merge(repo: &Repository, branch: &str, ours: Oid, theirs: Oid, up_ref: &str, sig: &Signature<'_>) -> Result<(), String> {
    let upstream = up_ref.trim_start_matches("refs/remotes/");
    let our_commit = repo.find_commit(ours).map_err(msg)?;
    let their_commit = repo.find_commit(theirs).map_err(msg)?;
    let mut index = repo.merge_commits(&our_commit, &their_commit, None).map_err(msg)?;
    if index.has_conflicts() {
        let reference = repo.find_reference(up_ref).map_err(msg)?;
        let annotated = repo.reference_to_annotated_commit(&reference).map_err(msg)?;
        let mut checkout = git2::build::CheckoutBuilder::new();
        checkout.safe().allow_conflicts(true).conflict_style_merge(true);
        // libgit2 refuses before writing anything when uncommitted edits are in the way.
        return repo.merge(&[&annotated], None, Some(&mut checkout)).map_err(|e| {
            let _ = repo.cleanup_state();
            if e.code() == ErrorCode::Conflict {
                format!("{branch} and {upstream} both changed the same lines, and your uncommitted changes are in the way. Commit or discard them first, then pull again")
            } else {
                msg(e)
            }
        });
    }
    let tree = repo.find_tree(index.write_tree_to(repo).map_err(msg)?).map_err(msg)?;
    // The working tree first: a safe checkout stops before changing anything
    // if uncommitted local edits are in the way.
    let mut checkout = git2::build::CheckoutBuilder::new();
    checkout.safe();
    repo.checkout_tree(tree.as_object(), Some(&mut checkout))
        .map_err(|e| if e.code() == ErrorCode::Conflict { "Local changes would be overwritten; commit them first".into() } else { msg(e) })?;
    repo.commit(Some("HEAD"), sig, sig, &format!("Merge {upstream} into {branch}"), &tree, &[&our_commit, &their_commit])
        .map_err(msg)?;
    Ok(())
}

/// Uncommitted changes to tracked files (new files do not count).
fn local_edits(dir: &str) -> Result<Vec<String>, String> {
    Ok(changes(dir)?.into_iter().filter(|c| c.status != "new").map(|c| c.path).take(8).collect())
}

/// Refuses commits and pulls while a merge or rebase waits for its conflicts.
fn busy_check(repo: &Repository) -> Result<(), String> {
    match repo.state() {
        RepositoryState::Clean => Ok(()),
        RepositoryState::Merge => Err("A merge is waiting for its conflicts to be resolved. Finish or abort it first".into()),
        RepositoryState::RebaseMerge => Err("A rebase is waiting for its conflicts to be resolved. Finish or abort it first".into()),
        _ => Err("Another git operation is in progress in this repository; finish it in git first".into()),
    }
}

/// Commits the rebase's current step, keeping the original author; a step
/// with nothing left to apply (already upstream) is skipped.
fn commit_step(repo: &Repository, rebase: &mut Rebase<'_>, id: Oid, sig: &Signature<'_>) -> Result<(), String> {
    let original = repo.find_commit(id).map_err(msg)?;
    let author = original.author();
    let committed = rebase.commit(Some(&author), sig, None);
    match committed {
        Ok(_) => Ok(()),
        Err(e) if e.code() == ErrorCode::Applied => Ok(()),
        Err(e) => Err(msg(e)),
    }
}

/// Applies a rebase's remaining steps in the working tree: stops at the
/// first conflict (left for the user), or finishes and moves the branch.
fn replay(repo: &Repository, rebase: &mut Rebase<'_>, sig: &Signature<'_>) -> Result<(), String> {
    while let Some(op) = rebase.next() {
        let id = op.map_err(msg)?.id();
        let mut index = repo.index().map_err(msg)?;
        index.read(true).map_err(msg)?;
        if index.has_conflicts() {
            return Ok(());
        }
        commit_step(repo, rebase, id, sig)?;
    }
    rebase.finish(Some(sig)).map_err(msg)
}

#[derive(Serialize)]
pub struct ConflictFile {
    path: String,
    /// Conflict blocks ("<<<<<<<" lines) still in the file; 0 = resolved.
    markers: usize,
    /// The user's side deleted the file.
    mine_deleted: bool,
    /// The other side (the remote) deleted the file.
    theirs_deleted: bool,
}

#[derive(Serialize)]
pub struct Conflicts {
    /// "merge" or "rebase".
    op: &'static str,
    branch: Option<String>,
    /// What the branch is being joined with, e.g. "origin/main".
    upstream: Option<String>,
    files: Vec<ConflictFile>,
    /// Rebase: the summary of the commit being replayed, and its place among all of them.
    commit: Option<String>,
    step: usize,
    steps: usize,
}

fn markers_in(path: &Path) -> usize {
    std::fs::read(path)
        .map(|b| b.split(|c| *c == b'\n').filter(|l| l.starts_with(b"<<<<<<< ")).count())
        .unwrap_or(0)
}

/// Paths of the index's conflicted files.
fn conflicted_paths(index: &git2::Index) -> Result<Vec<String>, String> {
    Ok(index
        .conflicts()
        .map_err(msg)?
        .filter_map(Result::ok)
        .filter_map(|c| c.our.or(c.their).or(c.ancestor).map(|e| String::from_utf8_lossy(&e.path).into_owned()))
        .collect())
}

/// The merge or rebase waiting for its conflicts to be resolved, if any.
pub fn conflicts(dir: &str) -> Result<Option<Conflicts>, String> {
    let repo = open(dir)?;
    let rebasing = match repo.state() {
        RepositoryState::Merge => false,
        RepositoryState::RebaseMerge => true,
        _ => return Ok(None),
    };
    let workdir = repo.workdir().ok_or("Bare repositories are not supported")?.to_path_buf();
    let mut index = repo.index().map_err(msg)?;
    index.read(true).map_err(msg)?;
    let mut files = Vec::new();
    for c in index.conflicts().map_err(msg)?.filter_map(Result::ok) {
        let Some(path) = [&c.our, &c.their, &c.ancestor].into_iter().flatten().next().map(|e| String::from_utf8_lossy(&e.path).into_owned())
        else {
            continue;
        };
        // In a rebase "ours" is the remote's side and "theirs" the commit being replayed.
        let (mine, theirs) = if rebasing { (&c.their, &c.our) } else { (&c.our, &c.their) };
        files.push(ConflictFile {
            markers: markers_in(&workdir.join(&path)),
            mine_deleted: mine.is_none(),
            theirs_deleted: theirs.is_none(),
            path,
        });
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    let (mut branch, mut commit, mut step, mut steps) = (None, None, 0, 0);
    if rebasing {
        if let Ok(mut rebase) = repo.open_rebase(None) {
            branch = rebase.orig_head_name().ok().flatten().map(|n| n.trim_start_matches("refs/heads/").to_owned());
            steps = rebase.len();
            if let Some(cur) = rebase.operation_current() {
                step = cur + 1;
                let id = rebase.nth(cur).map(|o| o.id());
                commit = id.and_then(|id| repo.find_commit(id).ok()).and_then(|c| c.summary().ok().flatten().map(str::to_owned));
            }
        }
    } else {
        branch = repo.head().ok().and_then(|h| h.shorthand().ok().map(str::to_owned));
    }
    let upstream = branch.as_deref().and_then(|b| upstream_ref(&repo, b)).map(|u| u.trim_start_matches("refs/remotes/").to_owned());
    Ok(Some(Conflicts { op: if rebasing { "rebase" } else { "merge" }, branch, upstream, files, commit, step, steps }))
}

/// Resolves one conflicted file with one side's whole version ("mine" or
/// "theirs"); a side that deleted the file deletes it. Staged on "Continue".
pub fn resolve(dir: &str, path: &str, side: &str) -> Result<(), String> {
    let repo = open(dir)?;
    let rebasing = match repo.state() {
        RepositoryState::Merge => false,
        RepositoryState::RebaseMerge => true,
        _ => return Err("No merge or rebase is waiting for this file".into()),
    };
    let mut index = repo.index().map_err(msg)?;
    index.read(true).map_err(msg)?;
    let c = index
        .conflicts()
        .map_err(msg)?
        .filter_map(Result::ok)
        .find(|c| [&c.our, &c.their, &c.ancestor].into_iter().flatten().any(|e| e.path == path.as_bytes()))
        .ok_or_else(|| format!("{path} has no conflict any more"))?;
    // In a rebase the index's "ours" stage is the remote's side.
    let entry = if (side == "mine") != rebasing { c.our } else { c.their };
    let file = repo.workdir().ok_or("Bare repositories are not supported")?.join(path);
    match entry {
        Some(e) => {
            let blob = repo.find_blob(e.id).map_err(msg)?;
            if let Some(parent) = file.parent() {
                std::fs::create_dir_all(parent).map_err(|e| format!("{path}: {e}"))?;
            }
            std::fs::write(&file, blob.content()).map_err(|e| format!("{path}: {e}"))?;
        }
        None if file.exists() => std::fs::remove_file(&file).map_err(|e| format!("{path}: {e}"))?,
        None => {}
    }
    Ok(())
}

/// Stages every conflicted file as it is now; refuses while one still has
/// conflict markers.
fn stage_resolved(repo: &Repository) -> Result<(), String> {
    let workdir = repo.workdir().ok_or("Bare repositories are not supported")?.to_path_buf();
    let mut index = repo.index().map_err(msg)?;
    index.read(true).map_err(msg)?;
    let paths = conflicted_paths(&index)?;
    let left: Vec<&str> = paths.iter().filter(|p| markers_in(&workdir.join(p)) > 0).map(String::as_str).collect();
    if !left.is_empty() {
        return Err(format!("These files still have conflict markers: {}", left.join(", ")));
    }
    for p in &paths {
        if workdir.join(p).exists() {
            index.add_path(Path::new(p)).map_err(|e| format!("{p}: {}", e.message()))?;
        } else {
            index.remove_path(Path::new(p)).map_err(|e| format!("{p}: {}", e.message()))?;
        }
    }
    index.write().map_err(msg)
}

/// "Continue": commits the resolved merge, or the rebase's current step and
/// the steps after it (stopping again at the next conflict).
pub fn conflict_continue(dir: &str, name: Option<&str>, email: Option<&str>) -> Result<(), String> {
    let repo = open(dir)?;
    let sig = signature(&repo, name, email)?;
    match repo.state() {
        RepositoryState::Merge => {
            stage_resolved(&repo)?;
            let head = repo.head().map_err(msg)?;
            let branch = head.shorthand().map_err(msg)?.to_owned();
            let mut parents = vec![head.peel_to_commit().map_err(msg)?];
            let merge_head = std::fs::read_to_string(repo.path().join("MERGE_HEAD")).map_err(|e| format!("MERGE_HEAD: {e}"))?;
            for line in merge_head.lines().map(str::trim).filter(|l| !l.is_empty()) {
                let id = Oid::from_str(line).map_err(msg)?;
                parents.push(repo.find_commit(id).map_err(msg)?);
            }
            let message = match upstream_ref(&repo, &branch) {
                Some(u) => format!("Merge {} into {branch}", u.trim_start_matches("refs/remotes/")),
                None => repo.message().unwrap_or_else(|_| "Merge".into()).trim().to_owned(),
            };
            let mut index = repo.index().map_err(msg)?;
            let tree = repo.find_tree(index.write_tree().map_err(msg)?).map_err(msg)?;
            let refs: Vec<&git2::Commit<'_>> = parents.iter().collect();
            repo.commit(Some("HEAD"), &sig, &sig, &message, &tree, &refs).map_err(msg)?;
            repo.cleanup_state().map_err(msg)
        }
        RepositoryState::RebaseMerge => {
            stage_resolved(&repo)?;
            let mut rebase = repo.open_rebase(None).map_err(msg)?;
            let current = rebase.operation_current().and_then(|cur| rebase.nth(cur).map(|o| o.id()));
            if let Some(id) = current {
                commit_step(&repo, &mut rebase, id, &sig)?;
            }
            replay(&repo, &mut rebase, &sig)
        }
        _ => Err("No merge or rebase is waiting".into()),
    }
}

/// "Abort": everything back as before the pull. A rebase resets to where the
/// branch was (it only starts from a clean working tree); a merge puts back
/// only the files it touched, so other uncommitted changes stay.
pub fn conflict_abort(dir: &str) -> Result<(), String> {
    let repo = open(dir)?;
    match repo.state() {
        RepositoryState::RebaseMerge => repo.open_rebase(None).and_then(|mut r| r.abort()).map_err(msg),
        RepositoryState::Merge => {
            let head = repo.head().map_err(msg)?.peel_to_commit().map_err(msg)?;
            let tree = head.tree().map_err(msg)?;
            let mut index = repo.index().map_err(msg)?;
            index.read(true).map_err(msg)?;
            let mut paths = conflicted_paths(&index)?;
            let staged = repo.diff_tree_to_index(Some(&tree), Some(&index), None).map_err(msg)?;
            for d in staged.deltas() {
                if let Some(p) = d.new_file().path().or(d.old_file().path()) {
                    paths.push(p.to_string_lossy().replace('\\', "/"));
                }
            }
            paths.sort();
            paths.dedup();
            if !paths.is_empty() {
                let workdir = repo.workdir().ok_or("Bare repositories are not supported")?.to_path_buf();
                repo.reset_default(Some(head.as_object()), paths.iter().map(String::as_str)).map_err(msg)?;
                let mut co = git2::build::CheckoutBuilder::new();
                co.force().disable_pathspec_match(true);
                let mut known = 0;
                for p in &paths {
                    if tree.get_path(Path::new(p)).is_ok() {
                        co.path(p.as_str());
                        known += 1;
                    } else {
                        // Added by the merge: it was not here before.
                        let _ = std::fs::remove_file(workdir.join(p));
                    }
                }
                if known > 0 {
                    repo.checkout_head(Some(&mut co)).map_err(msg)?;
                }
            }
            repo.cleanup_state().map_err(msg)
        }
        _ => Ok(()),
    }
}

/// Pushes the current branch to its remote and sets the upstream the first time.
/// Fetches first: when the remote has commits this branch lacks, it says so
/// (pull first) instead of letting the server reject the push.
pub fn push(dir: &str, token: Option<&str>) -> Result<BranchInfo, String> {
    busy_check(&open(dir)?)?;
    let before = fetch(dir, token)?;
    if before.behind > 0 {
        return Err(format!(
            "{} has {} new commit(s) that are not here yet. Pull first, then push",
            before.upstream.as_deref().unwrap_or("The remote"),
            before.behind
        ));
    }
    {
        let repo = open(dir)?;
        let head = repo.head().map_err(msg)?;
        if !head.is_branch() {
            return Err("HEAD is not a branch".into());
        }
        let branch = head.shorthand().map_err(msg)?.to_owned();
        let mut remote = current_remote(&repo)?;
        let remote_name = remote.name().ok().flatten().unwrap_or("origin").to_owned();
        let url = remote.url().unwrap_or("").to_owned();
        let spec = format!("refs/heads/{branch}:refs/heads/{branch}");
        let rejected = with_credentials(token, &url, |t| {
            let rejected = std::cell::RefCell::new(None::<String>);
            {
                let mut cb = callbacks(&repo, t);
                cb.push_update_reference(|_, status| {
                    if let Some(s) = status {
                        *rejected.borrow_mut() = Some(s.to_owned());
                    }
                    Ok(())
                });
                let mut opts = PushOptions::new();
                opts.remote_callbacks(cb).proxy_options(proxy());
                remote.push(&[spec.as_str()], Some(&mut opts))?;
            }
            Ok(rejected.into_inner())
        })?;
        if let Some(reason) = rejected {
            return Err(format!("Push rejected: {reason}. Fetch and pull first"));
        }
        if repo.branch_upstream_name(&format!("refs/heads/{branch}")).is_err() {
            if let Ok(mut b) = repo.find_branch(&branch, BranchType::Local) {
                let _ = b.set_upstream(Some(format!("{remote_name}/{branch}").as_str()));
            }
        }
    }
    branch_info(dir)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn sig() -> Signature<'static> {
        Signature::now("Test", "test@example.com").unwrap()
    }

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("parom-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn commit_file(dir: &Path, file: &str, text: &str, message: &str) {
        fs::write(dir.join(file), text).unwrap();
        let repo = Repository::open(dir).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new(file)).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
        let parents: Vec<&git2::Commit<'_>> = parent.iter().collect();
        repo.commit(Some("HEAD"), &sig(), &sig(), message, &tree, &parents).unwrap();
    }

    /// "origin" and a clone that both changed the middle line of a.txt.
    fn diverged(name: &str) -> (PathBuf, String) {
        let root = temp(name);
        let origin = root.join("origin");
        fs::create_dir_all(&origin).unwrap();
        Repository::init(&origin).unwrap();
        commit_file(&origin, "a.txt", "one\ntwo\nthree\n", "start");
        let local = root.join("local");
        Repository::clone(origin.to_str().unwrap(), &local).unwrap();
        commit_file(&origin, "a.txt", "one\nTHEIRS\nthree\n", "theirs");
        commit_file(&local, "a.txt", "one\nMINE\nthree\n", "mine");
        let dir = local.to_str().unwrap().to_owned();
        (root, dir)
    }

    fn read(dir: &str, file: &str) -> String {
        fs::read_to_string(Path::new(dir).join(file)).unwrap().replace("\r\n", "\n")
    }

    #[test]
    fn rebase_conflict_resolved_with_mine() {
        let (root, dir) = diverged("rebase");
        pull(&dir, None, Some("Test"), Some("test@example.com"), true).unwrap();
        let c = conflicts(&dir).unwrap().expect("a rebase waits for the conflict");
        assert_eq!(c.op, "rebase");
        assert!(c.branch.is_some() && c.upstream.is_some(), "branch and upstream named");
        assert_eq!((c.step, c.steps), (1, 1));
        assert_eq!(c.commit.as_deref(), Some("mine"));
        assert_eq!(c.files.len(), 1);
        assert_eq!(c.files[0].path, "a.txt");
        assert_eq!(c.files[0].markers, 1);
        assert!(commit(&dir, &["a.txt".into()], "x", Some("Test"), Some("test@example.com")).is_err());
        assert!(conflict_continue(&dir, Some("Test"), Some("test@example.com")).is_err(), "markers left");
        resolve(&dir, "a.txt", "mine").unwrap();
        assert_eq!(read(&dir, "a.txt"), "one\nMINE\nthree\n");
        assert_eq!(conflicts(&dir).unwrap().unwrap().files[0].markers, 0);
        conflict_continue(&dir, Some("Test"), Some("test@example.com")).unwrap();
        assert!(conflicts(&dir).unwrap().is_none());
        let info = branch_info(&dir).unwrap();
        assert!(info.branch.is_some(), "back on the branch");
        assert_eq!((info.ahead, info.behind), (1, 0), "one line of history: mine on top of theirs");
        let repo = Repository::open(&dir).unwrap();
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(head.parent_count(), 1);
        assert_eq!(head.summary().unwrap(), Some("mine"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn merge_conflict_resolved_with_theirs() {
        let (root, dir) = diverged("merge");
        pull(&dir, None, Some("Test"), Some("test@example.com"), false).unwrap();
        let c = conflicts(&dir).unwrap().expect("a merge waits for the conflict");
        assert_eq!(c.op, "merge");
        assert!(c.upstream.as_deref().is_some_and(|u| u.starts_with("origin/")));
        assert_eq!(c.files.len(), 1);
        resolve(&dir, "a.txt", "theirs").unwrap();
        assert_eq!(read(&dir, "a.txt"), "one\nTHEIRS\nthree\n");
        conflict_continue(&dir, Some("Test"), Some("test@example.com")).unwrap();
        assert!(conflicts(&dir).unwrap().is_none());
        let repo = Repository::open(&dir).unwrap();
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(head.parent_count(), 2);
        assert!(head.summary().unwrap().unwrap().starts_with("Merge "));
        assert_eq!(branch_info(&dir).unwrap().behind, 0);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn abort_puts_everything_back() {
        for rebase in [true, false] {
            let (root, dir) = diverged(if rebase { "abort-rebase" } else { "abort-merge" });
            let before = branch_info(&dir).unwrap().head;
            // An unrelated new file must survive the abort.
            fs::write(Path::new(&dir).join("notes.txt"), "keep").unwrap();
            pull(&dir, None, Some("Test"), Some("test@example.com"), rebase).unwrap();
            assert!(conflicts(&dir).unwrap().is_some());
            conflict_abort(&dir).unwrap();
            assert!(conflicts(&dir).unwrap().is_none());
            let after = branch_info(&dir).unwrap();
            assert_eq!(after.head, before);
            assert!(after.branch.is_some());
            assert_eq!(read(&dir, "a.txt"), "one\nMINE\nthree\n");
            assert_eq!(read(&dir, "notes.txt"), "keep");
            let _ = fs::remove_dir_all(root);
        }
    }

    #[test]
    fn rebase_conflict_needs_a_clean_tree() {
        let (root, dir) = diverged("dirty");
        commit_file(Path::new(&dir), "b.txt", "b\n", "b");
        fs::write(Path::new(&dir).join("b.txt"), "edited\n").unwrap();
        let e = pull(&dir, None, Some("Test"), Some("test@example.com"), true).unwrap_err();
        assert!(e.contains("b.txt"), "{e}");
        assert!(conflicts(&dir).unwrap().is_none());
        assert_eq!(read(&dir, "b.txt"), "edited\n");
        let _ = fs::remove_dir_all(root);
    }
}
