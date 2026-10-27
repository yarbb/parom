// The sync marker: one small JSON file on the server (default "/.parom")
// recording the last deployed commit. History stays on each user's computer.

export const markerFormat = 1;
export const markerName = '.parom';
/** The marker's name before the app was renamed; read, and replaced on the next write. */
export const legacyMarkerName = '.totzilla';
/** Suffix of files being uploaded, renamed into place when complete. */
export const partSuffix = '.parom-part';
const legacyPartSuffix = '.totzilla-part';

/** Sync's own files on the server (marker, its temp copy, half-uploaded files). */
export function isSyncFile(name: string): boolean {
  return (
    name.startsWith(markerName) ||
    name.startsWith(legacyMarkerName) ||
    name.endsWith(partSuffix) ||
    name.endsWith(legacyPartSuffix)
  );
}

export interface Lock {
  /** Who holds it (GitHub login or user@computer). */
  by: string;
  /** UTC ISO time. */
  since: string;
  /** Seconds after `since` when the lock is considered stale. */
  ttl: number;
  /** Random value; re-reading it confirms the lock is ours. */
  nonce: string;
}

export interface Marker {
  format: number;
  /** "owner/name", or "" if the site has no GitHub repository set. */
  repo: string;
  /** Last deployed commit; null right after "Create marker", before the first sync. */
  sha: string | null;
  /** Fingerprint of the managed files at `sha` (see treeFingerprint). */
  tree: string | null;
  who: string;
  /** UTC ISO time of the last change. */
  when: string;
  lock: Lock | null;
}

export class MarkerError extends Error {}

/** Parses the marker file. Throws MarkerError for files it must not overwrite blindly. */
export function parseMarker(text: string): Marker {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new MarkerError('The marker file is not valid JSON.');
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new MarkerError('The marker file has an unexpected structure.');
  }
  const m = raw as Record<string, unknown>;
  const format = typeof m.format === 'number' ? m.format : 0;
  if (format < 1) {
    throw new MarkerError('The marker file has no format version.');
  }
  if (format > markerFormat) {
    throw new MarkerError(`The marker was written by a newer version (format ${format}). Update the app.`);
  }
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const sha = typeof m.sha === 'string' && /^[0-9a-f]{40}$/.test(m.sha) ? m.sha : null;
  let lock: Lock | null = null;
  if (typeof m.lock === 'object' && m.lock !== null) {
    const l = m.lock as Record<string, unknown>;
    lock = { by: str(l.by), since: str(l.since), ttl: typeof l.ttl === 'number' ? l.ttl : 0, nonce: str(l.nonce) };
  }
  return {
    format,
    repo: str(m.repo),
    sha,
    tree: typeof m.tree === 'string' ? m.tree : null,
    who: str(m.who),
    when: str(m.when),
    lock,
  };
}

/** Stable key order, one line; small enough to stay around 300 bytes. */
export function serializeMarker(m: Marker): string {
  return (
    JSON.stringify({
      format: m.format,
      repo: m.repo,
      sha: m.sha,
      tree: m.tree,
      who: m.who,
      when: m.when,
      lock: m.lock && { by: m.lock.by, since: m.lock.since, ttl: m.lock.ttl, nonce: m.lock.nonce },
    }) + '\n'
  );
}

export function lockActive(lock: Lock | null, now = Date.now()): boolean {
  if (!lock) {
    return false;
  }
  const since = Date.parse(lock.since);
  return Number.isFinite(since) && since + lock.ttl * 1000 > now;
}

export interface FingerprintFile {
  path: string;
  size: number;
  oid: string;
}

/** "sha256:<hex>" over sorted "path\tsize\tgit-blob-id" lines of the managed files. */
export async function treeFingerprint(files: readonly FingerprintFile[]): Promise<string> {
  const lines = [...files]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((f) => `${f.path}\t${f.size}\t${f.oid}\n`)
    .join('');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(lines));
  return 'sha256:' + [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 16 random hex characters for lock nonces. */
export function newNonce(): string {
  return [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('');
}
