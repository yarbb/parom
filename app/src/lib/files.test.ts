import { describe, expect, it } from 'vitest';
import {
  clickSelection,
  formatSize,
  formatTime,
  localJoin,
  parseHost,
  parseRemoteTime,
  remoteJoin,
  remoteParent,
  sortRows,
  visibleRange,
  type FileRow,
} from './files';
import { format } from './i18n';
import { addRecent, credentialKey, maxRecent, recentLabel, removeRecent, type RecentServer } from './recent';

const row = (name: string, extra: Partial<FileRow> = {}): FileRow => ({
  name,
  size: 0,
  dir: false,
  link: false,
  time: null,
  ...extra,
});

describe('sortRows', () => {
  const rows = [row('b.txt', { size: 5, time: 3 }), row('dir2', { dir: true }), row('a10.txt', { size: 1, time: 1 }), row('a9.txt', { size: 9, time: 2 }), row('Dir1', { dir: true })];

  it('puts directories first and sorts names naturally, ignoring case', () => {
    expect(sortRows(rows, { key: 'name', desc: false }).map((r) => r.name)).toEqual(['Dir1', 'dir2', 'a9.txt', 'a10.txt', 'b.txt']);
  });

  it('sorts by size and time, descending keeps directories first', () => {
    expect(sortRows(rows, { key: 'size', desc: true }).map((r) => r.name)).toEqual(['dir2', 'Dir1', 'a9.txt', 'b.txt', 'a10.txt']);
    expect(sortRows(rows, { key: 'time', desc: false }).map((r) => r.name).slice(2)).toEqual(['a10.txt', 'a9.txt', 'b.txt']);
  });

  it('does not modify its input', () => {
    const copy = [...rows];
    sortRows(rows, { key: 'name', desc: true });
    expect(rows).toEqual(copy);
  });
});

describe('paths', () => {
  it('joins and splits server paths', () => {
    expect(remoteJoin('/', 'a')).toBe('/a');
    expect(remoteJoin('/home/x', 'a')).toBe('/home/x/a');
    expect(remoteParent('/home/x')).toBe('/home');
    expect(remoteParent('/home/x/')).toBe('/home');
    expect(remoteParent('/home')).toBe('/');
    expect(remoteParent('/')).toBeNull();
  });

  it('joins local paths with the platform separator', () => {
    expect(localJoin('C:\\', 'a', '\\')).toBe('C:\\a');
    expect(localJoin('C:\\Users', 'a', '\\')).toBe('C:\\Users\\a');
    expect(localJoin('/home/x', 'a', '/')).toBe('/home/x/a');
  });
});

describe('formatting', () => {
  it('formats sizes', () => {
    expect(formatSize(-1)).toBe('');
    expect(formatSize(0)).toBe('0 B');
    expect(formatSize(1023)).toBe('1023 B');
    expect(formatSize(18 * 1024)).toBe('18 KB');
    expect(formatSize(1.4 * 1024 * 1024)).toBe('1.4 MB');
  });

  it('parses daemon times as UTC', () => {
    expect(parseRemoteTime('2026-10-26T12:00:00Z')).toBe(Date.UTC(2026, 9, 26, 12));
    expect(parseRemoteTime('2026-10-26')).toBe(Date.UTC(2026, 9, 26));
    expect(parseRemoteTime(undefined)).toBeNull();
    expect(parseRemoteTime('garbage')).toBeNull();
  });

  it('omits the year within the current year', () => {
    const now = new Date(2026, 9, 26).getTime();
    expect(formatTime(new Date(2026, 9, 24).getTime(), now)).toBe('Oct 24');
    expect(formatTime(new Date(2024, 0, 2).getTime(), now)).toBe('Jan 2, 2024');
    expect(formatTime(null, now)).toBe('');
  });
});

describe('visibleRange', () => {
  it('renders only the rows in view plus overscan, even for 100k rows', () => {
    const r = visibleRange(30 * 50_000, 600, 30, 100_000, 8);
    expect(r.start).toBe(50_000 - 8);
    expect(r.end).toBe(50_000 + 21 + 8);
    expect(r.end - r.start).toBeLessThan(50);
  });

  it('clamps at both ends', () => {
    expect(visibleRange(0, 600, 30, 100_000)).toEqual({ start: 0, end: 29 });
    expect(visibleRange(30 * 100_000, 600, 30, 100_000)).toEqual({ start: 100_000 - 8, end: 100_000 });
    expect(visibleRange(-50, 600, 30, 5)).toEqual({ start: 0, end: 5 });
    expect(visibleRange(0, 600, 30, 0)).toEqual({ start: 0, end: 0 });
  });
});

describe('clickSelection', () => {
  const none = { ctrl: false, shift: false };
  it('replaces, toggles and extends', () => {
    expect([...clickSelection(new Set([1, 2]), 1, 5, none)]).toEqual([5]);
    expect([...clickSelection(new Set([1, 2]), 1, 2, { ctrl: true, shift: false })]).toEqual([1]);
    expect([...clickSelection(new Set([1]), 1, 4, { ctrl: false, shift: true })].sort()).toEqual([1, 2, 3, 4]);
    expect([...clickSelection(new Set([9]), 4, 2, { ctrl: true, shift: true })].sort()).toEqual([2, 3, 4, 9]);
  });
});

describe('i18n format', () => {
  it('fills placeholders and English plurals', () => {
    expect(format('{name} v{version}', { name: 'App', version: '1.0' })).toBe('App v1.0');
    const files = '{count, plural, one {# file} other {# files}}';
    expect(format(files, { count: 1 })).toBe('1 file');
    expect(format(files, { count: 1200 })).toBe('1,200 files');
    expect(format('{missing}', {})).toBe('{missing}');
  });
});

describe('parseHost', () => {
  it('accepts plain hosts, ports and URLs', () => {
    expect(parseHost('example.org', '')).toEqual({ protocol: 'sftp', host: 'example.org', port: undefined });
    expect(parseHost(' example.org ', '2222')).toEqual({ protocol: 'sftp', host: 'example.org', port: 2222 });
    expect(parseHost('sftp://203.0.113.10:2022/home', '')).toEqual({ protocol: 'sftp', host: '203.0.113.10', port: 2022 });
    expect(parseHost('ftp://example.org', '')).toEqual({ protocol: 'ftp', host: 'example.org', port: undefined });
    expect(parseHost('example.org:2022', '22')).toEqual({ protocol: 'sftp', host: 'example.org', port: 22 });
  });
});
describe('recent servers', () => {
  const a: RecentServer = { protocol: 'sftp', host: 'a.example', port: 2022, user: 'u' };
  const b: RecentServer = { protocol: 'sftp', host: 'b.example', user: 'u' };

  it('moves the latest server to the front without duplicates', () => {
    expect(addRecent([a, b], { ...b, host: 'B.example' })).toEqual([{ ...b, host: 'B.example' }, a]);
    const many = Array.from({ length: 20 }, (_, i) => ({ ...b, host: `h${i}` }));
    expect(addRecent(many, a)).toHaveLength(maxRecent);
    expect(addRecent(many, a)[0]).toEqual(a);
    expect(removeRecent([a, b], a)).toEqual([b]);
  });

  it('keys credentials by protocol, user, host and port', () => {
    expect(credentialKey(a)).toBe('sftp://u@a.example:2022');
    expect(credentialKey({ ...a, host: 'A.EXAMPLE', remember: true })).toBe('sftp://u@a.example:2022');
    expect(credentialKey(b)).toBe('sftp://u@b.example');
  });

  it('labels with or without the address', () => {
    expect(recentLabel(a, false, 'hidden')).toBe('u@a.example:2022');
    expect(recentLabel(a, true, 'hidden')).toBe('u@hidden');
    expect(recentLabel({ ...b, protocol: 'ftp', user: '' }, false, 'hidden')).toBe('ftp://b.example');
  });
});
