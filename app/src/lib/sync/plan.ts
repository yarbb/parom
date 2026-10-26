// Pure sync decisions: how the server relates to the local repository, which
// server files were edited by hand, and what a sync uploads.
import { classify, type Rules } from './managed';
import type { Marker } from './marker';

export type ServerState =
  /** No marker on the server. */
  | 'no-marker'
  /** Marker created but nothing synced yet: compare files instead. */
  | 'unsynced'
  /** The server has exactly the local HEAD. */
  | 'up-to-date'
  /** The server's commit is an ancestor of HEAD: a normal update. */
  | 'behind'
  /** The server's commit is known locally but not an ancestor (diverged or HEAD is older). */
  | 'diverged'
  /** The server's commit is not in the local repository (someone else synced). */
  | 'unknown-commit';

export interface StateInput {
  marker: Marker | null;
  head: string;
  /** Whether marker.sha exists locally; ignored without a sha. */
  markerKnown: boolean;
  /** Whether marker.sha is an ancestor of (or equal to) HEAD. */
  markerIsAncestor: boolean;
}

export function serverState(s: StateInput): ServerState {
  if (!s.marker) {
    return 'no-marker';
  }
  if (!s.marker.sha) {
    return 'unsynced';
  }
  if (s.marker.sha === s.head) {
    return 'up-to-date';
  }
  if (!s.markerKnown) {
    return 'unknown-commit';
  }
  return s.markerIsAncestor ? 'behind' : 'diverged';
}

export interface TreeEntry {
  path: string;
  size: number;
  oid: string;
}

export interface ServerFile {
  size: number;
  /** Epoch ms from the server's clock, or null. */
  mtime: number | null;
}

export interface Edits {
  /** Managed files whose size differs or that changed after the marker was written. */
  edited: string[];
  /** Managed files of the deployed commit that are gone from the server. */
  missing: string[];
}

/**
 * Finds hand edits without downloading anything: sizes are compared with the
 * deployed commit, times with the marker file's own time (both from the
 * server's clock, so clock differences between computers do not matter).
 */
export function detectServerEdits(
  deployed: readonly TreeEntry[],
  server: ReadonlyMap<string, ServerFile>,
  markerMtime: number | null,
  rules: Rules,
): Edits {
  const edits: Edits = { edited: [], missing: [] };
  for (const f of deployed) {
    if (classify(f.path, rules) !== 'managed') {
      continue;
    }
    const s = server.get(f.path);
    if (!s) {
      edits.missing.push(f.path);
    } else if (s.size !== f.size || (markerMtime !== null && s.mtime !== null && s.mtime > markerMtime + 1000)) {
      edits.edited.push(f.path);
    }
  }
  return edits;
}

export interface Change {
  path: string;
  status: 'added' | 'modified' | 'deleted';
}

export interface Plan {
  /** Repository paths to upload, sorted. */
  upload: string[];
  /** Removed from the repository since the deployed commit; left on the server. */
  removedInRepo: string[];
  /** Would have been uploaded but are protected by a "!" rule. */
  protectedSkipped: string[];
}

/**
 * What to upload. With `changes` (deployed commit known) only the changed
 * files; without, every managed file whose size differs from the server.
 * `restore` adds server-edited files so the repository version wins.
 */
export function planSync(input: {
  head: readonly TreeEntry[];
  changes: readonly Change[] | null;
  server: ReadonlyMap<string, ServerFile>;
  rules: Rules;
  restore?: readonly string[];
}): Plan {
  const upload = new Set<string>();
  const removed: string[] = [];
  const skipped = new Set<string>();
  const consider = (path: string) => {
    const c = classify(path, input.rules);
    if (c === 'managed') {
      upload.add(path);
    } else if (c === 'protected') {
      skipped.add(path);
    }
  };

  if (input.changes) {
    for (const ch of input.changes) {
      if (ch.status === 'deleted') {
        if (classify(ch.path, input.rules) === 'managed') {
          removed.push(ch.path);
        }
      } else {
        consider(ch.path);
      }
    }
  } else {
    for (const f of input.head) {
      const s = input.server.get(f.path);
      if (!s || s.size !== f.size) {
        consider(f.path);
      }
    }
  }
  const inHead = new Set(input.head.map((f) => f.path));
  for (const path of input.restore ?? []) {
    if (inHead.has(path)) {
      consider(path);
    }
  }
  return { upload: [...upload].sort(), removedInRepo: removed.sort(), protectedSkipped: [...skipped].sort() };
}

/** Folders (relative, parents first) that must exist on the server for the uploads. */
export function foldersFor(paths: readonly string[]): string[] {
  const dirs = new Set<string>();
  for (const p of paths) {
    const parts = p.split('/').slice(0, -1);
    for (let i = 1; i <= parts.length; i++) {
      dirs.add(parts.slice(0, i).join('/'));
    }
  }
  return [...dirs].sort((a, b) => a.split('/').length - b.split('/').length || (a < b ? -1 : 1));
}

/** Whether to show "Versions differ" before syncing, following Preferences. */
export function needsConfirmation(
  state: ServerState,
  edits: Edits,
  ask: { versionsDiffer: boolean; changedBySomeoneElse: boolean; localOnly: boolean },
): boolean {
  const handEdits = edits.edited.length + edits.missing.length > 0;
  if (state === 'unknown-commit') {
    return ask.changedBySomeoneElse || handEdits;
  }
  if (state === 'diverged' || state === 'unsynced' || state === 'no-marker' || handEdits) {
    return ask.versionsDiffer || handEdits;
  }
  return state === 'behind' && ask.localOnly;
}
