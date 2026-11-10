// Which local files and folders to highlight in the file lists: files with
// uncommitted changes and files committed since the last sync (not on the
// server yet). Pure, so the path handling is tested.

export type MarkStatus = 'modified' | 'new';
/** Uncommitted in the repository, or committed but not deployed yet. */
export type MarkKind = 'uncommitted' | 'undeployed';

export interface Mark {
  status: MarkStatus;
  kind: MarkKind;
}

export interface MarkSource {
  /** Absolute folder the paths are relative to. */
  root: string;
  kind: MarkKind;
  /** "/" separated paths below root. */
  paths: { path: string; status: MarkStatus }[];
}

export interface Marks {
  files: Map<string, Mark>;
  /** Folders holding marked files (any depth), with the kind of the first one found. */
  folders: Map<string, MarkKind>;
}

/** One form for a path: "/" separated, no trailing "/", lower case where names ignore case. */
export function markKey(path: string, caseless: boolean): string {
  let p = path.replace(/[\\/]+/g, '/');
  if (p.length > 1 && p.endsWith('/') && !/^[A-Za-z]:\/$/.test(p)) {
    p = p.slice(0, -1);
  }
  return caseless ? p.toLowerCase() : p;
}

/** Joins a folder and a name the way markKey expects. */
export function markJoin(folder: string, name: string, caseless: boolean): string {
  return markKey(`${folder.replace(/[\\/]+$/, '')}/${name}`, caseless);
}

/** Sources come in order of weight: a file marked by an earlier one keeps that mark. */
export function buildMarks(sources: MarkSource[], caseless: boolean): Marks {
  const files = new Map<string, Mark>();
  const folders = new Map<string, MarkKind>();
  for (const s of sources) {
    const root = markKey(s.root, caseless);
    for (const { path, status } of s.paths) {
      const rel = path.replace(/^[\\/]+/, '');
      if (!rel) {
        continue;
      }
      const key = markJoin(root, rel, caseless);
      if (files.has(key)) {
        continue;
      }
      files.set(key, { status, kind: s.kind });
      // Every folder above the file, up to the drive or "/".
      let dir = key;
      for (;;) {
        const cut = dir.lastIndexOf('/');
        if (cut <= 0) {
          if (cut === 0 && dir !== '/' && !folders.has('/')) {
            folders.set('/', s.kind);
          }
          break;
        }
        dir = /^[A-Za-z]:$/.test(dir.slice(0, cut)) ? dir.slice(0, cut + 1) : dir.slice(0, cut);
        if (folders.has(dir)) {
          break;
        }
        folders.set(dir, s.kind);
        if (dir.endsWith('/')) {
          break;
        }
      }
    }
  }
  return { files, folders };
}
