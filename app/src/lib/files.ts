// Pure helpers for the Files tab: rows, sorting, paths, formatting, and the
// visible window of a virtualized list. Unit tested in files.test.ts.

/** One row in a file list, local or remote. */
export interface FileRow {
  name: string;
  /** Bytes; -1 when unknown or for directories. */
  size: number;
  dir: boolean;
  link: boolean;
  /** Milliseconds since the epoch, or null. */
  time: number | null;
}

export type SortKey = 'name' | 'size' | 'time';

export interface Sort {
  key: SortKey;
  desc: boolean;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const caseCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'case', caseFirst: 'upper' });

export interface SortOptions {
  foldersFirst?: boolean;
  caseSensitive?: boolean;
}

/** By key, folders first unless disabled; names break ties. Returns a new array. */
export function sortRows(rows: readonly FileRow[], sort: Sort, options: SortOptions = {}): FileRow[] {
  const dir = sort.desc ? -1 : 1;
  const names = options.caseSensitive ? caseCollator : collator;
  const foldersFirst = options.foldersFirst ?? true;
  return [...rows].sort((a, b) => {
    if (foldersFirst && a.dir !== b.dir) {
      return a.dir ? -1 : 1;
    }
    let c = 0;
    if (sort.key === 'size') {
      c = a.size - b.size;
    } else if (sort.key === 'time') {
      c = (a.time ?? -Infinity) - (b.time ?? -Infinity);
      if (Number.isNaN(c)) {
        c = 0;
      }
    }
    if (c === 0) {
      c = names.compare(a.name, b.name);
    }
    return c * dir;
  });
}

/** Parses the daemon's `YYYY-MM-DD[THH:MM:SSZ]` (UTC) into epoch ms. */
export function parseRemoteTime(time: string | undefined): number | null {
  if (!time) {
    return null;
  }
  const ms = Date.parse(time.length === 10 ? `${time}T00:00:00Z` : time);
  return Number.isNaN(ms) ? null : ms;
}

export function remoteJoin(path: string, name: string): string {
  return path.endsWith('/') ? path + name : `${path}/${name}`;
}

/** Parent of an absolute server path, or null at "/". */
export function remoteParent(path: string): string | null {
  const trimmed = path.length > 1 ? path.replace(/\/+$/, '') : path;
  if (trimmed === '/' || trimmed === '') {
    return null;
  }
  const i = trimmed.lastIndexOf('/');
  return i <= 0 ? '/' : trimmed.slice(0, i);
}

export function localJoin(path: string, name: string, separator: string): string {
  return path.endsWith('/') || path.endsWith('\\') ? path + name : path + separator + name;
}

const units = ['B', 'KB', 'MB', 'GB', 'TB'];

/** 1024-based by default, like file managers ("18 KB", "1.4 MB"); `decimal` uses 1000. */
export function formatSize(bytes: number, decimal = false): string {
  if (bytes < 0) {
    return '';
  }
  const base = decimal ? 1000 : 1024;
  let v = bytes;
  let u = 0;
  while (v >= base && u < units.length - 1) {
    v /= base;
    u++;
  }
  const digits = u === 0 || v >= 10 ? 0 : 1;
  return `${v.toFixed(digits)} ${units[u]}`;
}

const shortDate = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' });
const longDate = new Intl.DateTimeFormat('en', { year: 'numeric', month: 'short', day: 'numeric' });
const fullDate = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });

const pad = (n: number) => String(n).padStart(2, '0');

/** "Oct 26" within the current year, "Oct 26, 2024" otherwise; `iso` gives local "2026-10-26 12:04". */
export function formatTime(ms: number | null, now = Date.now(), iso = false): string {
  if (ms === null) {
    return '';
  }
  if (iso) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  const sameYear = new Date(ms).getFullYear() === new Date(now).getFullYear();
  return (sameYear ? shortDate : longDate).format(ms);
}

export function formatFullTime(ms: number | null): string {
  return ms === null ? '' : fullDate.format(ms);
}

/** Rows [start, end) to render for a fixed row height, with overscan. */
export function visibleRange(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  count: number,
  overscan = 8,
): { start: number; end: number } {
  if (count <= 0 || rowHeight <= 0) {
    return { start: 0, end: 0 };
  }
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const visible = Math.ceil(Math.max(0, viewportHeight) / rowHeight) + 1;
  const start = Math.max(0, Math.min(count, first - overscan));
  const end = Math.max(start, Math.min(count, first + visible + overscan));
  return { start, end };
}

/** Indexes selected by a click: plain replaces, ctrl toggles, shift extends from the anchor. */
export function clickSelection(
  selected: ReadonlySet<number>,
  anchor: number | null,
  index: number,
  mods: { ctrl: boolean; shift: boolean },
): Set<number> {
  if (mods.shift && anchor !== null) {
    const next = mods.ctrl ? new Set(selected) : new Set<number>();
    const [a, b] = anchor < index ? [anchor, index] : [index, anchor];
    for (let i = a; i <= b; i++) {
      next.add(i);
    }
    return next;
  }
  if (mods.ctrl) {
    const next = new Set(selected);
    if (next.has(index)) {
      next.delete(index);
    } else {
      next.add(index);
    }
    return next;
  }
  return new Set([index]);
}

/** Splits "sftp://host:port" style input into protocol, host and port. */
/**
 * Splits a pasted address such as "ftp://user@203.0.113.10:21/garrysmod" into
 * its parts, for host fields that should tidy themselves up. Null when the
 * input is a plain host name (nothing to split).
 */
export function splitAddress(input: string): { protocol?: string; user?: string; host: string; port?: number; path?: string } | null {
  let rest = input.trim();
  const out: { protocol?: string; user?: string; host: string; port?: number; path?: string } = { host: '' };
  const scheme = /^([a-z][a-z0-9+-]*):\/\//i.exec(rest);
  if (scheme) {
    const s = scheme[1].toLowerCase();
    out.protocol = s === 'ssh' || s === 'scp' ? 'sftp' : s;
    rest = rest.slice(scheme[0].length);
  }
  const slash = rest.indexOf('/');
  if (slash >= 0) {
    out.path = rest.slice(slash) || undefined;
    rest = rest.slice(0, slash);
  }
  const at = rest.lastIndexOf('@');
  if (at > 0) {
    out.user = decodeURIComponent(rest.slice(0, at));
    rest = rest.slice(at + 1);
  }
  const hostPort = /^(.*):(\d+)$/.exec(rest);
  if (hostPort && !rest.startsWith('[')) {
    rest = hostPort[1];
    out.port = Number(hostPort[2]);
  }
  out.host = rest;
  const changed = out.protocol || out.user || out.port || (out.path && out.path !== '/');
  return changed && out.host ? out : null;
}

export function parseHost(input: string, port: string): { protocol: string; host: string; port?: number } {
  let rest = input.trim();
  let protocol = 'sftp';
  const scheme = /^([a-z]+):\/\//i.exec(rest);
  if (scheme) {
    protocol = scheme[1].toLowerCase();
    rest = rest.slice(scheme[0].length);
  }
  rest = rest.replace(/\/.*$/, '');
  let p = port.trim() ? Number(port.trim()) : undefined;
  const hostPort = /^(.*):(\d+)$/.exec(rest);
  if (hostPort && !rest.startsWith('[')) {
    rest = hostPort[1];
    p ??= Number(hostPort[2]);
  }
  return { protocol, host: rest, port: p };
}

/**
 * Whether a certificate's DNS names cover the host the user connected to.
 * Supports one leading wildcard label ("*.example.org"), like browsers.
 */
export function certCoversHost(host: string, names: readonly string[]): boolean {
  const h = host.trim().toLowerCase().replace(/\.$/, '');
  return names.some((raw) => {
    const n = raw.trim().toLowerCase().replace(/\.$/, '');
    if (n === h) {
      return true;
    }
    if (n.startsWith('*.')) {
      const dot = h.indexOf('.');
      return dot > 0 && h.slice(dot + 1) === n.slice(2);
    }
    return false;
  });
}