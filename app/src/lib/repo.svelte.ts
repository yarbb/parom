// The local repository shown in the GitHub tab (src-tauri/src/gitrepo.rs).
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { github } from './github.svelte';
import { prefs } from './prefs.svelte';
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
  status: 'new' | 'modified' | 'deleted';
}

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
  status: FileChange['status'];
  additions: number;
  deletions: number;
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
  changes = $state<FileChange[]>([]);
  log = $state<LogEntry[]>([]);
  error = $state('');
  /** "fetch" / "pull" / "push" / "commit" while running. */
  busy = $state('');
  /** Bumped when a commit or pull changed HEAD or the files on disk. */
  changed = $state(0);
  /** Bumped whenever files in the repository changed on disk (live changes). */
  touched = $state(0);
  /** When the remote was last fetched in this session (ms). */
  fetchedAt = $state<number | null>(null);

  /** Repositories linked to sites, then ones added by hand. */
  get choices(): RepoChoice[] {
    const out: RepoChoice[] = [];
    const seen = new Set<string>();
    const hidden = new Set(prefs.value.hiddenRepos.map((d) => d.toLowerCase()));
    for (const s of sites.list) {
      const dir = s.localDir.trim();
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

  /** Status and branch only (cheap): after file changes on disk. */
  async refreshChanges(): Promise<void> {
    const dir = this.dir;
    if (!dir || this.busy) {
      return;
    }
    try {
      const [info, changes] = await Promise.all([
        invoke<BranchInfo>('repo_info', { dir }),
        invoke<FileChange[]>('repo_changes', { dir }),
      ]);
      if (dir !== this.dir) {
        return;
      }
      this.touched++;
      // Same list: keep the old array, so views do not reload their diffs.
      if (JSON.stringify(changes) !== JSON.stringify(this.changes)) {
        this.changes = changes;
      }
      if (JSON.stringify(info) !== JSON.stringify(this.info)) {
        this.info = info;
      }
    } catch {
      // The next full refresh shows the error.
    }
  }

  /** Throws away the changes of `paths`: HEAD's version back, new files to the Recycle Bin. */
  async discard(paths: string[]): Promise<boolean> {
    try {
      await invoke('repo_discard', { dir: this.dir, paths });
      this.error = '';
      this.changed++;
      await this.refreshChanges();
      return true;
    } catch (e) {
      this.error = String(e);
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
      const [info, changes, log] = await Promise.all([
        invoke<BranchInfo>('repo_info', { dir }),
        invoke<FileChange[]>('repo_changes', { dir }),
        invoke<LogEntry[]>('repo_log', { dir, limit: 300 }),
      ]);
      if (dir === this.dir) {
        this.info = info;
        this.changes = changes;
        this.log = log;
        this.error = '';
      }
    } catch (e) {
      this.error = String(e);
    }
  }

  async commit(paths: string[], message: string): Promise<boolean> {
    this.busy = 'commit';
    try {
      const author = github.author;
      await invoke<string>('repo_commit', { dir: this.dir, paths, message, name: author?.name ?? null, email: author?.email ?? null });
      this.error = '';
      this.changed++;
      await this.refresh();
      return true;
    } catch (e) {
      this.error = String(e);
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
      this.error = '';
      if (op === 'pull') {
        this.changed++;
      }
      await this.refresh();
    } catch (e) {
      this.error = String(e);
      // A failed push fetched first: the button can now offer the pull.
      await this.refresh();
      this.error = String(e);
    } finally {
      this.busy = '';
    }
  }
}

export const repo = new Repo();
