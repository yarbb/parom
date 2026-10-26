import { describe, expect, it } from 'vitest';
import { classify, globToRegExp, parseRules } from './managed';
import { lockActive, MarkerError, newNonce, parseMarker, serializeMarker, treeFingerprint, type Marker } from './marker';
import { detectServerEdits, foldersFor, needsConfirmation, planSync, serverState, type ServerFile } from './plan';

const sha = (c: string) => c.repeat(40);

const marker = (over: Partial<Marker> = {}): Marker => ({
  format: 1,
  repo: 'org/server',
  sha: sha('a'),
  tree: 'sha256:00',
  who: 'alex',
  when: '2026-10-25T21:40:00Z',
  lock: null,
  ...over,
});

describe('marker', () => {
  it('round-trips and stays small', () => {
    const m = marker({ lock: { by: 'alex', since: '2026-10-26T12:00:00Z', ttl: 600, nonce: 'abc' } });
    const text = serializeMarker(m);
    expect(parseMarker(text)).toEqual(m);
    expect(text.length).toBeLessThan(400);
    expect(text.endsWith('\n')).toBe(true);
  });

  it('tolerates unknown fields and rejects what it cannot understand', () => {
    expect(parseMarker('{"format":1,"sha":"nope","extra":1}').sha).toBeNull();
    expect(() => parseMarker('not json')).toThrow(MarkerError);
    expect(() => parseMarker('{"sha":"x"}')).toThrow(MarkerError);
    expect(() => parseMarker('{"format":2}')).toThrow(/newer version/);
  });

  it('treats locks as active until their ttl runs out', () => {
    const lock = { by: 'a', since: '2026-10-26T12:00:00Z', ttl: 60, nonce: 'n' };
    const t0 = Date.parse(lock.since);
    expect(lockActive(lock, t0 + 30_000)).toBe(true);
    expect(lockActive(lock, t0 + 61_000)).toBe(false);
    expect(lockActive(null)).toBe(false);
    expect(lockActive({ ...lock, since: 'garbage' })).toBe(false);
  });

  it('fingerprints the file list independent of order', async () => {
    const a = { path: 'a.lua', size: 1, oid: '1' };
    const b = { path: 'b/c.lua', size: 2, oid: '2' };
    const f1 = await treeFingerprint([a, b]);
    expect(f1).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(await treeFingerprint([b, a])).toBe(f1);
    expect(await treeFingerprint([a, { ...b, oid: '3' }])).not.toBe(f1);
    expect(newNonce()).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('managed paths', () => {
  it('converts gitignore-style patterns', () => {
    expect(globToRegExp('lua/**').test('lua/x/y.lua')).toBe(true);
    expect(globToRegExp('lua/**').test('addons/lua/x')).toBe(false);
    expect(globToRegExp('*.lua').test('deep/dir/x.lua')).toBe(true);
    expect(globToRegExp('/cfg/server.cfg').test('cfg/server.cfg')).toBe(true);
    expect(globToRegExp('/cfg/server.cfg').test('x/cfg/server.cfg')).toBe(false);
    expect(globToRegExp('data/').test('data/players/1.txt')).toBe(true);
    expect(globToRegExp('**/temp').test('a/b/temp/file')).toBe(true);
    expect(globToRegExp('file?.txt').test('file1.txt')).toBe(true);
    expect(globToRegExp('file?.txt').test('file10.txt')).toBe(false);
  });

  it('manages everything by default, except repo plumbing and protected files', () => {
    const rules = parseRules('# comment\n!data/**\n!cfg/server.cfg\n');
    expect(classify('lua/init.lua', rules)).toBe('managed');
    expect(classify('data/save.txt', rules)).toBe('protected');
    expect(classify('cfg/server.cfg', rules)).toBe('protected');
    expect(classify('.gitignore', rules)).toBe('unmanaged');
    expect(classify('.github/workflows/ci.yml', rules)).toBe('unmanaged');
    expect(classify('.totzilla-ignore', rules)).toBe('unmanaged');
  });

  it('limits to listed paths when there are include lines', () => {
    const rules = parseRules('lua/**\naddons/**\r\n!addons/secret/**');
    expect(classify('lua/a.lua', rules)).toBe('managed');
    expect(classify('README.md', rules)).toBe('unmanaged');
    expect(classify('addons/secret/key', rules)).toBe('protected');
  });
});

describe('server state', () => {
  const base = { head: sha('b'), markerKnown: true, markerIsAncestor: true };
  it('covers every case', () => {
    expect(serverState({ ...base, marker: null })).toBe('no-marker');
    expect(serverState({ ...base, marker: marker({ sha: null }) })).toBe('unsynced');
    expect(serverState({ ...base, marker: marker({ sha: sha('b') }) })).toBe('up-to-date');
    expect(serverState({ ...base, marker: marker() })).toBe('behind');
    expect(serverState({ ...base, marker: marker(), markerIsAncestor: false })).toBe('diverged');
    expect(serverState({ ...base, marker: marker(), markerKnown: false })).toBe('unknown-commit');
  });
});

describe('server edits and plans', () => {
  const rules = parseRules('!data/**');
  const deployed = [
    { path: 'a.lua', size: 10, oid: '1' },
    { path: 'b.lua', size: 20, oid: '2' },
    { path: 'c.lua', size: 30, oid: '3' },
    { path: 'data/x', size: 5, oid: '4' },
  ];
  const markerTime = Date.UTC(2026, 9, 25, 21, 40);
  const server = new Map<string, ServerFile>([
    ['a.lua', { size: 10, mtime: markerTime - 5000 }],
    ['b.lua', { size: 21, mtime: markerTime - 5000 }],
    ['c.lua', { size: 30, mtime: markerTime + 60_000 }],
    ['data/x', { size: 999, mtime: markerTime + 60_000 }],
  ]);

  it('finds size and time changes but ignores protected files', () => {
    expect(detectServerEdits(deployed, server, markerTime, rules)).toEqual({ edited: ['b.lua', 'c.lua'], missing: [] });
    const without = new Map(server);
    without.delete('a.lua');
    expect(detectServerEdits(deployed, without, null, rules)).toEqual({ edited: ['b.lua'], missing: ['a.lua'] });
  });

  it('uploads changed managed files and leaves deletions on the server', () => {
    const plan = planSync({
      head: [...deployed, { path: 'new.lua', size: 1, oid: '5' }],
      changes: [
        { path: 'a.lua', status: 'modified' },
        { path: 'new.lua', status: 'added' },
        { path: 'old.lua', status: 'deleted' },
        { path: 'data/x', status: 'modified' },
      ],
      server,
      rules,
      restore: ['c.lua', 'gone.lua'],
    });
    expect(plan).toEqual({ upload: ['a.lua', 'c.lua', 'new.lua'], removedInRepo: ['old.lua'], protectedSkipped: ['data/x'] });
  });

  it('compares sizes when the deployed commit is unknown', () => {
    const plan = planSync({ head: [...deployed, { path: 'd.lua', size: 1, oid: '5' }], changes: null, server, rules });
    expect(plan.upload).toEqual(['b.lua', 'd.lua']);
    expect(plan.protectedSkipped).toEqual(['data/x']);
  });

  it('lists parent folders before children', () => {
    expect(foldersFor(['a/b/c.lua', 'a/d.lua', 'e.lua', 'f/g/h/i.lua'])).toEqual(['a', 'f', 'a/b', 'f/g', 'f/g/h']);
  });

  it('asks before syncing according to preferences', () => {
    const none = { edited: [], missing: [] };
    const ask = { versionsDiffer: true, changedBySomeoneElse: true, localOnly: false };
    expect(needsConfirmation('behind', none, ask)).toBe(false);
    expect(needsConfirmation('behind', { edited: ['x'], missing: [] }, ask)).toBe(true);
    expect(needsConfirmation('behind', none, { ...ask, localOnly: true })).toBe(true);
    expect(needsConfirmation('diverged', none, ask)).toBe(true);
    expect(needsConfirmation('unknown-commit', none, { ...ask, changedBySomeoneElse: false })).toBe(false);
    expect(needsConfirmation('unknown-commit', { edited: [], missing: ['y'] }, { ...ask, changedBySomeoneElse: false })).toBe(true);
  });
});
