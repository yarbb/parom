// Spotting a site's files moved to another folder of the repository (e.g.
// everything that mirrors the server moved into "serverFiles/"), so the
// site can follow them instead of a sync uploading the new folder next to
// the real files on the server.

/** At least this many files must have moved, so one file put into a folder is not a move. */
const MIN_FILES = 5;

/**
 * The folder the files of the site's folder `sub` ("" for the repository's
 * root) moved to: most of the files deleted from inside `sub` came back at
 * the same relative path under one other folder. Paths are "/" separated
 * and relative to the repository (or all to the same folder). Returns the
 * new folder ("" for the root), or null when nothing moved.
 */
export function movedFolder(sub: string, deleted: string[], added: string[]): string | null {
  const base = sub ? `${sub}/` : '';
  const gone = new Set(deleted.filter((p) => p.startsWith(base)).map((p) => p.slice(base.length)));
  if (gone.size < MIN_FILES) {
    return null;
  }
  const votes = new Map<string, number>();
  const vote = (folder: string) => votes.set(folder, (votes.get(folder) ?? 0) + 1);
  for (const to of added) {
    if (gone.has(to) && sub) {
      vote('');
      continue;
    }
    // Every folder the path could have moved into: "a/b/c.lua" → "a" + "b/c.lua", "a/b" + "c.lua".
    for (let i = to.indexOf('/'); i > 0; i = to.indexOf('/', i + 1)) {
      if (gone.has(to.slice(i + 1))) {
        vote(to.slice(0, i));
        break;
      }
    }
  }
  let best: [string, number] | null = null;
  for (const entry of votes) {
    if (!best || entry[1] > best[1]) {
      best = entry;
    }
  }
  if (!best || best[0] === sub || best[1] < MIN_FILES || best[1] < gone.size * 0.8) {
    return null;
  }
  return best[0];
}
