// "Add to .gitignore" and "Never upload or overwrite" (.parom-ignore) from
// the file panes' right-click menus. Paths are relative to the repository
// root with "/"; the files are created when missing and lines already there
// are not added twice.
import { invoke } from '@tauri-apps/api/core';
import { joinRelative, relativeTo } from './browsing';
import { listLocal } from './local';
import { ignoreName, legacyIgnoreName } from './sync/managed';

export type IgnoreKind = 'git' | 'protect';

/** One entry to ignore: a "/"-separated path from the repository root. */
export interface IgnoreTarget {
  rel: string;
  dir: boolean;
}

/** The line for a path: anchored at the root, folders with a trailing "/". */
export function ignoreLine(kind: IgnoreKind, target: IgnoreTarget): string {
  const p = `/${target.rel}${target.dir ? '/' : ''}`;
  return kind === 'protect' ? `!${p}` : p;
}

/** "*.log" for a file name with an extension, else null. */
export function extensionPattern(name: string): string | null {
  const ext = /\.[^./]+$/.exec(name)?.[0];
  return ext && ext !== name ? `*${ext}` : null;
}

/** The file's text with the lines it does not have yet appended; null when nothing is new. */
export function withLines(text: string, lines: string[]): string | null {
  const have = new Set(text.split(/\r?\n/).map((l) => l.trim()));
  const added = [...new Set(lines)].filter((l) => !have.has(l));
  if (!added.length) {
    return null;
  }
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const body = text && !/\r?\n$/.test(text) ? `${text}${eol}` : text;
  return `${body}${added.join(eol)}${eol}`;
}

/** The repository among `repos` that holds `path`, and the path relative to it. */
export function inRepo(repos: string[], path: string): { dir: string; rel: string } | null {
  // The deepest one wins (a repository inside another).
  let best: { dir: string; rel: string } | null = null;
  for (const dir of repos) {
    const rel = relativeTo(dir, path);
    if (rel && (!best || dir.length > best.dir.length)) {
      best = { dir, rel };
    }
  }
  return best;
}

/** Adds lines to the repository's .gitignore or .parom-ignore; false when all were there. */
export async function addIgnoreLines(repoDir: string, kind: IgnoreKind, lines: string[]): Promise<boolean> {
  const sep = repoDir.includes('\\') ? '\\' : '/';
  let name = kind === 'git' ? '.gitignore' : ignoreName;
  const names = new Set((await listLocal(repoDir)).rows.map((r) => r.name));
  if (kind === 'protect' && !names.has(ignoreName) && names.has(legacyIgnoreName)) {
    name = legacyIgnoreName;
  }
  const path = joinRelative(repoDir, name, sep);
  const text = names.has(name) ? await invoke<string>('read_small_file', { path }) : '';
  const next = withLines(text, lines);
  if (next === null) {
    return false;
  }
  await invoke('write_small_file', { path, content: next });
  return true;
}

