// Local files that still need uploading, for the file lists: uncommitted
// changes of the open repository (and of the connected site), and files
// committed since the last sync. Built once per change, looked up per row.
import { buildMarks, markJoin, type Mark, type MarkKind, type MarkSource, type MarkStatus } from './changedmarks';
import { prefs } from './prefs.svelte';
import { repo } from './repo.svelte';
import { sync } from './sync/engine.svelte';

/** Windows and macOS file names ignore case. */
const caseless = typeof navigator === 'undefined' || !/linux/i.test(navigator.userAgent) || /android/i.test(navigator.userAgent);

class ChangedFiles {
  #marks = $derived.by(() => {
    if (!prefs.value.markChanged) {
      return null;
    }
    const sources: MarkSource[] = [];
    if (repo.dir && repo.changes.length) {
      sources.push({
        root: repo.dir,
        kind: 'uncommitted',
        paths: repo.changes.flatMap((c): { path: string; status: MarkStatus }[] =>
          c.status === 'new' ? [{ path: c.path, status: 'new' }] : c.status === 'modified' || c.status === 'renamed' ? [{ path: c.path, status: 'modified' }] : [],
        ),
      });
    }
    const c = sync.check;
    const siteDir = c?.site.localDir.trim();
    if (c && siteDir) {
      if (c.dirtyManaged.length) {
        sources.push({ root: siteDir, kind: 'uncommitted', paths: c.dirtyManaged.map((path) => ({ path, status: 'modified' })) });
      }
      if (c.undeployed.length) {
        sources.push({
          root: siteDir,
          kind: 'undeployed',
          paths: c.undeployed.map((u) => ({ path: u.path, status: u.status === 'added' ? 'new' : 'modified' })),
        });
      }
    }
    return sources.length ? buildMarks(sources, caseless) : null;
  });

  /** The mark of a file in a local folder, if it still needs uploading. */
  file(folder: string, name: string): Mark | null {
    return this.#marks?.files.get(markJoin(folder, name, caseless)) ?? null;
  }

  /** A local folder that holds such files (at any depth). */
  folder(folder: string, name: string): MarkKind | null {
    return this.#marks?.folders.get(markJoin(folder, name, caseless)) ?? null;
  }
}

export const changed = new ChangedFiles();
