// The local repository shown in the GitHub tab (src-tauri/src/gitrepo.rs).
import { invoke } from '@tauri-apps/api/core';
import { github } from './github.svelte';
import { prefs } from './prefs.svelte';
import { sites } from './sites.svelte';

export interface BranchInfo {
  branch: string | null;
  head: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  remote_url: string | null;
  /** "owner/name" when origin is on github.com. */
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
  /** When origin was last fetched in this session (ms). */
  fetchedAt = $state<number | null>(null);

  /** Repositories linked to sites, then ones added by hand. */
  get choices(): RepoChoice[] {
    const out: RepoChoice[] = [];
    const seen = new Set<string>();
    for (const s of sites.list) {
      const dir = s.localDir.trim();
      if (dir && !seen.has(dir.toLowerCase())) {
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
    if (dir !== this.dir) {
      this.info = null;
      this.changes = [];
      this.log = [];
      this.fetchedAt = null;
      await prefs.set('githubRepo', dir);
    }
    await this.refresh();
  }

  /** Adds a folder by hand; fails if it is not a git repository. */
  async add(dir: string): Promise<void> {
    await invoke<BranchInfo>('repo_info', { dir });
    if (!this.choices.some((c) => c.dir.toLowerCase() === dir.toLowerCase())) {
      await prefs.set('repos', [...prefs.value.repos, dir]);
    }
    await this.select(dir);
  }

  async remove(dir: string): Promise<void> {
    await prefs.set(
      'repos',
      prefs.value.repos.filter((d) => d !== dir),
    );
    if (this.dir === dir) {
      await this.select(this.choices[0]?.dir ?? '');
    }
  }

  async refresh(): Promise<void> {
    const dir = this.dir;
    if (!dir) {
      return;
    }
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
      await this.refresh();
      return true;
    } catch (e) {
      this.error = String(e);
      return false;
    } finally {
      this.busy = '';
    }
  }

  /** Fetch, pull (fast-forward only) or push origin. */
  async remote(op: 'fetch' | 'pull' | 'push'): Promise<void> {
    this.busy = op;
    try {
      this.info = await invoke<BranchInfo>('repo_remote', { dir: this.dir, op });
      this.fetchedAt = Date.now();
      this.error = '';
      await this.refresh();
    } catch (e) {
      this.error = String(e);
    } finally {
      this.busy = '';
    }
  }
}

export const repo = new Repo();
