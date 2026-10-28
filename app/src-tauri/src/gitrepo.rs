//! Repository work for the GitHub tab: changes, diffs, commits, history,
//! fetch, pull and push (libgit2 through git2; HTTPS remotes only).

use git2::{
    BranchType, Oid, Cred, CredentialType, Delta, DiffOptions, ErrorCode, FetchOptions, ProxyOptions, PushOptions,
    RemoteCallbacks, Repository, Signature, Status, StatusOptions,
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
/// or a merge commit when both sides have new commits and they touch
/// different lines. Refuses on merge conflicts or when local uncommitted
/// changes would be overwritten.
pub fn pull(dir: &str, token: Option<&str>, name: Option<&str>, email: Option<&str>) -> Result<BranchInfo, String> {
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
        merge(&repo, &branch, local, target, up.trim_start_matches("refs/remotes/"), &sig)?;
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

/// Merges `theirs` into the current branch without touching anything when
/// it cannot finish: conflicts, or local edits in the way of the result.
fn merge(repo: &Repository, branch: &str, ours: Oid, theirs: Oid, upstream: &str, sig: &Signature<'_>) -> Result<(), String> {
    let our_commit = repo.find_commit(ours).map_err(msg)?;
    let their_commit = repo.find_commit(theirs).map_err(msg)?;
    let mut index = repo.merge_commits(&our_commit, &their_commit, None).map_err(msg)?;
    if index.has_conflicts() {
        let files: Vec<String> = index
            .conflicts()
            .map_err(msg)?
            .filter_map(Result::ok)
            .filter_map(|c| c.our.or(c.their).map(|e| String::from_utf8_lossy(&e.path).into_owned()))
            .take(8)
            .collect();
        return Err(format!(
            "{branch} and {upstream} both changed the same lines in {}. Merge them in git or GitHub Desktop, then come back",
            files.join(", ")
        ));
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

/// Pushes the current branch to its remote and sets the upstream the first time.
/// Fetches first: when the remote has commits this branch lacks, it says so
/// (pull first) instead of letting the server reject the push.
pub fn push(dir: &str, token: Option<&str>) -> Result<BranchInfo, String> {
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
