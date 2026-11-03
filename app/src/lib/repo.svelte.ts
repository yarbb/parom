// The local repository shown in the GitHub tab (src-tauri/src/gitrepo.rs).
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { github } from './github.svelte';
import { prefs } from './prefs.svelte';
import { repoRoots } from './reporoot.svelte';
import { sites } from './sites.svelte';

export interface BranchInfo {
  branch: string | null;
  head: string | null;
  /** Remote the branch pushes to and pulls from. */
  remote: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  remote_url: string | null;
  /** "owner/name" when that remote is on github.com. */
  github: string | null;
}

export interface FileChange {
  path: string;
  status: 'new' | 'modified' | 'deleted' | 'renamed';
  /** Renamed: where the file was (same content). */
  old_path?: string;
}

/** The paths a change touches: both of a rename. */
export const changePaths = (c: FileChange) => (c.old_path ? [c.path, c.old_path] : [c.path]);

export interface DiffLine {
  kind: '+' | '-' | ' ' | '@';
  old: number | null;
  new: number | null;
  text: string;
}

export interface FileDiff {
  binary: boolean;
  lines: DiffLine[];
  truncated: boolean;
}

export interface LogEntry {
  sha: string;
  summary: string;
  body: string;
  author: string;
  email: string;
  /** Seconds since the epoch. */
  time: number;
}

export interface CommitFile {
  path: string;
  status: 'new' | 'modified' | 'deleted';
  additions: number;
  deletions: number;
}

export interface ConflictFile {
  path: string;
  /** Conflict blocks still in the file; 0 = resolved. */
  markers: number;
  mine_deleted: boolean;
  theirs_deleted: boolean;
}

/** A merge or rebase stopped at conflicting lines, waiting for the user. */
export interface Conflicts {
  op: 'merge' | 'rebase';
  branch: string | null;
  upstream: string | null;
  files: ConflictFile[];
  /** Rebase: the commit being replayed and its place among all of them. */
  commit: string | null;
  step: number;
  steps: number;
}

export interface RepoChoice {
  dir: string;
  /** Site name for linked repositories. */
  site: string | null;
}

export const fileDiff = (dir: string, path: string, rev?: string) =>
  invoke<FileDiff>('repo_file_diff', { dir, path, rev: rev ?? null });

export const commitFiles = (dir: string, rev: string) => invoke<CommitFile[]>('repo_commit_files', { dir, rev });

/** Last folder name, for menus. */
export const repoName = (dir: string) => dir.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || dir;

class Repo {
  info = $state<BranchInfo | null>(null);
  // Raw: replaced as a whole, never changed in place (tens of thousands of rows after a big move).
  changes = $state.raw<FileChange[]>([]);
  log = $state<LogEntry[]>([]);
  /** The last failure; kept until closed or the next action succeeds (refreshes do not clear it). */
  error = $state('');
  /** The error's own window is open (long errors open it by themselves). */
  errorOpen = $state(false);
  #errorFromRefresh = false;
  /** "fetch" / "pull" / "push" / "commit" / "continue" / "abort" while running. */
  busy = $state('');
  /** Bumped when a commit or pull changed HEAD or the files on disk. */
  changed = $state(0);
  /** Bumped whenever files in the repository changed on disk (live changes). */
  touched = $state(0);
  /** A merge or rebase waiting for conflicts to be resolved (also one started in git). */
  conflicts = $state<Conflicts | null>(null);
  /** The conflicts window is open; a pull that stops at conflicts opens it. */
  conflictsOpen = $state(false);
  /** When the remote was last fetched in this session (ms). */
  fetchedAt = $state<number | null>(null);

  /** Repositories linked to sites, then ones added by hand. */
  get choices(): RepoChoice[] {
    const out: RepoChoice[] = [];
    const seen = new Set<string>();
    const hidden = new Set(prefs.value.hiddenRepos.map((d) => d.toLowerCase()));
    for (const s of sites.list) {
      // A site's folder may be inside its repository: the repository is listed.
      const loc = repoRoots.location(s.localDir);
      const dir = loc === undefined ? '' : (loc?.root ?? s.localDir.trim());
      if (dir && !seen.has(dir.toLowerCase()) && !hidden.has(dir.toLowerCase())) {
        seen.add(dir.toLowerCase());
        out.push({ dir, site: s.name });
      }
    }
    for (const dir of prefs.value.repos) {
      if (!seen.has(dir.toLowerCase())) {
        seen.add(dir.toLowerCase());
        out.push({ dir, site: null });
      }
    }
    return out;
  }

  get dir(): string {
    return prefs.value.githubRepo;
  }

  async select(dir: string): Promise<void> {
    const other = dir !== this.dir;
    if (other) {
      this.info = null;
      this.changes = [];
      this.log = [];
      this.conflicts = null;
      this.conflictsOpen = false;
      this.fetchedAt = null;
      await prefs.set('githubRepo', dir);
    }
    await this.refresh();
    if (other && dir) {
      // A repository just opened: see what the remote has, as on start.
      void this.fetchQuietly();
    }
  }

  /** Adds a folder by hand; fails if it is not a git repository. */
  async add(dir: string): Promise<void> {
    await invoke<BranchInfo>('repo_info', { dir });
    const hidden = prefs.value.hiddenRepos.filter((d) => d.toLowerCase() !== dir.toLowerCase());
    if (hidden.length !== prefs.value.hiddenRepos.length) {
      await prefs.set('hiddenRepos', hidden);
    }
    if (!this.choices.some((c) => c.dir.toLowerCase() === dir.toLowerCase())) {
      await prefs.set('repos', [...prefs.value.repos, dir]);
    }
    await this.select(dir);
  }

  /** Takes a repository off the list; one linked to a site is hidden instead. */
  async remove(dir: string): Promise<void> {
    if (prefs.value.repos.includes(dir)) {
      await prefs.set(
        'repos',
        prefs.value.repos.filter((d) => d !== dir),
      );
    } else {
      await prefs.set('hiddenRepos', [...prefs.value.hiddenRepos, dir]);
    }
    if (this.dir === dir) {
      await this.select(this.choices[0]?.dir ?? '');
    }
  }

  async unhide(dir: string): Promise<void> {
    await prefs.set(
      'hiddenRepos',
      prefs.value.hiddenRepos.filter((d) => d !== dir),
    );
  }

  /** Folder the Rust side watches for live changes. */
  #watched = '';
  #listening = false;
  #liveTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Live changes, as in GitHub Desktop: files edited, added or deleted in
   * the repository show in Changes right away (the folder is watched).
   */
  async #watch(dir: string): Promise<void> {
    if (!isTauri() || dir === this.#watched) {
      return;
    }
    this.#watched = dir;
    await invoke('repo_watch', { dir }).catch(() => undefined);
    if (!this.#listening) {
      this.#listening = true;
      await listen('repo-fs', () => {
        if (this.#liveTimer) {
          clearTimeout(this.#liveTimer);
        }
        this.#liveTimer = setTimeout(() => void this.refreshChanges(), 150);
      });
    }
  }

  #refreshing = false;
  #refreshAgain = false;

  /**
   * Status and branch only (cheap): after file changes on disk. One at a
   * time: while files keep changing (a big move) the next one waits for this
   * one, and many requests in between make one more refresh.
   */
  async refreshChanges(): Promise<void> {
    const dir = this.dir;
    if (!dir || this.busy) {
      return;
    }
    if (this.#refreshing) {
      this.#refreshAgain = true;
      return;
    }
    this.#refreshing = true;
    try {
      const [info, changes, conflicts] = await Promise.all([
        invoke<BranchInfo>('repo_info', { dir }),
        invoke<FileChange[]>('repo_changes', { dir }),
        invoke<Conflicts | null>('repo_conflicts', { dir }),
      ]);
      if (dir !== this.dir) {
        return;
      }
      this.touched++;
      // Files edited in an editor count as resolved as soon as their markers are gone.
      if (JSON.stringify(conflicts) !== JSON.stringify(this.conflicts)) {
        this.#setConflicts(conflicts);
      }
      // Same list: keep the old array, so views do not reload their diffs.
      if (JSON.stringify(changes) !== JSON.stringify(this.changes)) {
        this.changes = changes;
      }
      if (JSON.stringify(info) !== JSON.stringify(this.info)) {
        this.info = info;
      }
    } catch {
      // The next full refresh shows the error.
    } finally {
      this.#refreshing = false;
      if (this.#refreshAgain) {
        this.#refreshAgain = false;
        void this.refreshChanges();
      }
    }
  }

  /** Shows an action's failure: a short one in the toolbar, a long one in its own window. */
  fail(e: unknown): void {
    this.error = String(e).replace(/^Error: /, '');
    this.#errorFromRefresh = false;
    this.errorOpen = this.error.length > 90 || this.error.includes('\n');
  }

  dismissError(): void {
    this.error = '';
    this.errorOpen = false;
  }

  /** Throws away the changes of `paths`: HEAD's version back, new files to the Recycle Bin. */
  async discard(paths: string[]): Promise<boolean> {
    try {
      await invoke('repo_discard', { dir: this.dir, paths });
      this.dismissError();
      this.changed++;
      await this.refreshChanges();
      return true;
    } catch (e) {
      this.fail(e);
      return false;
    }
  }

  async refresh(): Promise<void> {
    const dir = this.dir;
    if (!dir) {
      void this.#watch('');
      return;
    }
    void this.#watch(dir);
    try {
      const [info, changes, log, conflicts] = await Promise.all([
        invoke<BranchInfo>('repo_info', { dir }),
        invoke<FileChange[]>('repo_changes', { dir }),
        invoke<LogEntry[]>('repo_log', { dir, limit: 300 }),
        invoke<Conflicts | null>('repo_conflicts', { dir }),
      ]);
      if (dir === this.dir) {
        this.info = info;
        this.changes = changes;
        this.log = log;
        this.#setConflicts(conflicts);
        if (this.#errorFromRefresh) {
          this.dismissError();
        }
      }
    } catch (e) {
      if (!this.error || this.#errorFromRefresh) {
        this.error = String(e);
        this.#errorFromRefresh = true;
      }
    }
  }

  #setConflicts(c: Conflicts | null): void {
    this.conflicts = c;
    if (!c) {
      this.conflictsOpen = false;
    }
  }

  /** Takes one side's whole version of a conflicted file. */
  async resolve(path: string, side: 'mine' | 'theirs'): Promise<void> {
    try {
      await invoke('repo_resolve', { dir: this.dir, path, side });
      await this.refreshChanges();
    } catch (e) {
      this.fail(e);
    }
  }

  /** Commits the resolved merge, or the rebase step and the ones after it. */
  async continueConflicts(): Promise<void> {
    this.busy = 'continue';
    try {
      const author = github.author;
      await invoke('repo_conflict_continue', { dir: this.dir, name: author?.name ?? null, email: author?.email ?? null });
      this.dismissError();
      this.changed++;
    } catch (e) {
      this.fail(e);
    } finally {
      this.busy = '';
    }
    await this.refresh();
    // A rebase may stop again at its next commit: the window stays then.
    this.conflictsOpen = !!this.conflicts;
  }

  /** Back to how things were before the pull. */
  async abortConflicts(): Promise<void> {
    this.busy = 'abort';
    try {
      await invoke('repo_conflict_abort', { dir: this.dir });
      this.dismissError();
      this.changed++;
    } catch (e) {
      this.fail(e);
    } finally {
      this.busy = '';
    }
    await this.refresh();
  }

  async commit(paths: string[], message: string): Promise<boolean> {
    this.busy = 'commit';
    try {
      const author = github.author;
      await invoke<string>('repo_commit', { dir: this.dir, paths, message, name: author?.name ?? null, email: author?.email ?? null });
      this.dismissError();
      this.changed++;
      await this.refresh();
      return true;
    } catch (e) {
      this.fail(e);
      return false;
    } finally {
      this.busy = '';
    }
  }

  #autoTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Fetches in the background, like GitHub Desktop: at start, when the
   * window comes back after a while, and every 10 minutes. Quiet: failures
   * (offline, no access) do not show as errors.
   */
  startAutoFetch(): void {
    if (this.#autoTimer) {
      return;
    }
    const quiet = () => this.fetchQuietly(false);
    void quiet();
    this.#autoTimer = setInterval(() => void quiet(), 10 * 60_000);
    window.addEventListener('focus', () => void quiet());
  }

  /** Fetches without showing failures; unless `force`, only if the last fetch is 5 minutes old. */
  async fetchQuietly(force = true): Promise<void> {
    const due = force || !this.fetchedAt || Date.now() - this.fetchedAt > 5 * 60_000;
    const dir = this.dir;
    if (!dir || this.busy || !due) {
      return;
    }
    try {
      const info = await invoke<BranchInfo>('repo_remote', { dir, op: 'fetch', name: null, email: null });
      if (dir === this.dir) {
        this.info = info;
        this.fetchedAt = Date.now();
      }
    } catch {
      // Offline or no access: the button still works and shows the reason.
    }
  }

  /** Fetch, pull (fast-forward only) or push the branch's remote. */
  async remote(op: 'fetch' | 'pull' | 'push'): Promise<void> {
    this.busy = op;
    try {
      const author = github.author;
      this.info = await invoke<BranchInfo>('repo_remote', {
        dir: this.dir,
        op,
        name: author?.name ?? null,
        email: author?.email ?? null,
        rebase: prefs.value.pullMode !== 'merge',
      });
      this.fetchedAt = Date.now();
      this.dismissError();
      if (op === 'pull') {
        this.changed++;
      }
      await this.refresh();
      if (op === 'pull' && this.conflicts) {
        this.conflictsOpen = true;
      }
    } catch (e) {
      this.fail(e);
      // A failed push fetched first: the button can now offer the pull.
      await this.refresh();
    } finally {
      this.busy = '';
    }
  }
}

export const repo = new Repo();
