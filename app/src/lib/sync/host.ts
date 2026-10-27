// Typed wrappers for the Rust commands sync needs (src-tauri/src/git.rs, support.rs).
import { invoke } from '@tauri-apps/api/core';
import type { Change, TreeEntry } from './plan';

export interface RepoStatus {
  head: string | null;
  branch: string | null;
  head_time: number | null;
  head_summary: string | null;
  dirty: string[];
}

export const git = {
  status: (dir: string) => invoke<RepoStatus>('git_status', { dir }),
  tree: (dir: string, rev: string) => invoke<TreeEntry[]>('git_tree', { dir, rev }),
  hasCommit: (dir: string, sha: string) => invoke<boolean>('git_has_commit', { dir, sha }),
  isAncestor: (dir: string, ancestor: string, descendant: string) =>
    invoke<boolean>('git_is_ancestor', { dir, ancestor, descendant }),
  commitsBetween: (dir: string, from: string, to: string) => invoke<number>('git_commits_between', { dir, from, to }),
  diff: (dir: string, from: string, to: string) => invoke<Change[]>('git_diff', { dir, from, to }),
  readFile: (dir: string, rev: string, path: string) => invoke<string>('git_read_file', { dir, rev, path }),
  /** Writes the committed version of paths below dest. */
  export: (dir: string, rev: string, paths: string[], dest: string) => invoke<void>('git_export', { dir, rev, paths, dest }),
};

export interface AppPaths {
  data: string;
  backups: string;
  history: string;
}

export const host = {
  paths: () => invoke<AppPaths>('app_paths'),
  readSmall: (path: string) => invoke<string>('read_small_file', { path }),
  writeSmall: (path: string, content: string) => invoke<void>('write_small_file', { path, content }),
  appendLine: (path: string, line: string) => invoke<void>('append_line', { path, line }),
  removeBackup: (path: string) => invoke<void>('remove_backup', { path }),
  dirSize: (path: string) => invoke<number>('dir_size', { path }),
  /** "missing" when there is no local file, else "same" or "different" (content). */
  compareFiles: (downloaded: string, local: string) => invoke<'missing' | 'same' | 'different'>('compare_files', { downloaded, local }),
  copyFile: (from: string, to: string) => invoke<void>('copy_file', { from, to }),
  machineName: () => invoke<string>('machine_name'),
  runCommand: (command: string, cwd: string) => invoke<{ code: number | null; output: string }>('run_command', { command, cwd }),
};

/** Where backups go: the folder from Preferences, or the app's own data folder. */
export async function backupsRoot(custom: string): Promise<string> {
  return custom.trim() || (await host.paths()).backups;
}

/** Joins local path parts with the separator the base path already uses. */
export function joinLocal(base: string, ...parts: string[]): string {
  const sep = base.includes('\\') ? '\\' : '/';
  return [base.replace(/[\\/]+$/, ''), ...parts.map((p) => p.split('/').join(sep))].join(sep);
}
