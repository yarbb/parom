// Synchronized browsing (as in FileZilla): opening a folder on one side opens
// the same folder, relative to the site's two roots, on the other side.

/** A local path as shown: with "/" when Preferences ask for the same slashes as on the server. */
export function shownLocal(path: string, forward: boolean): string {
  return forward ? path.replace(/\\/g, '/') : path;
}

/** For comparing paths: "/" separators, no trailing slash, case folded on Windows-style paths. */
export function normalizePath(p: string): string {
  const s = p.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
  return /^[a-z]:/i.test(s) ? s.toLowerCase() : s;
}

/** `path` relative to `root` ("/"-separated, "" for the root itself), or null when outside it. */
export function relativeTo(root: string, path: string): string | null {
  const r = normalizePath(root);
  const p = normalizePath(path);
  if (p === r) {
    return '';
  }
  const prefix = r === '/' ? '/' : `${r}/`;
  if (!p.startsWith(prefix)) {
    return null;
  }
  // Keep the original spelling of the relative part.
  const original = path.replace(/\\/g, '/').replace(/\/+$/, '');
  return original.slice(original.length - (p.length - prefix.length));
}

/** Joins a "/"-separated relative path onto a root with the root's own separator. */
export function joinRelative(root: string, rel: string, separator: string): string {
  if (!rel) {
    return root;
  }
  const base = root.replace(/[\\/]+$/, '');
  return `${base}${separator}${rel.split('/').join(separator)}`;
}
