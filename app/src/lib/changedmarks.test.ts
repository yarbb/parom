import { describe, expect, it } from 'vitest';
import { buildMarks, markJoin, markKey } from './changedmarks';

describe('changed file marks', () => {
  it('finds a file listed with either separator and any case on Windows', () => {
    const marks = buildMarks(
      [{ root: 'C:\\Work\\Site', kind: 'uncommitted', paths: [{ path: 'lua/init.lua', status: 'modified' }] }],
      true,
    );
    expect(marks.files.get(markJoin('c:\\work\\site\\LUA', 'Init.lua', true))).toEqual({ status: 'modified', kind: 'uncommitted' });
    expect(marks.files.get(markJoin('C:/Work/Site/lua/', 'init.lua', true))).toBeDefined();
  });

  it('keeps case where names are case-sensitive', () => {
    const marks = buildMarks([{ root: '/srv/site', kind: 'undeployed', paths: [{ path: 'A.txt', status: 'new' }] }], false);
    expect(marks.files.has(markJoin('/srv/site', 'A.txt', false))).toBe(true);
    expect(marks.files.has(markJoin('/srv/site', 'a.txt', false))).toBe(false);
  });

  it('marks every folder above a file, up to the drive', () => {
    const marks = buildMarks(
      [{ root: 'D:/repo', kind: 'uncommitted', paths: [{ path: 'a/b/c.txt', status: 'new' }] }],
      true,
    );
    for (const dir of ['d:/repo/a/b', 'd:/repo/a', 'd:/repo', 'd:/']) {
      expect(marks.folders.has(dir)).toBe(true);
    }
    expect(marks.folders.has(markKey('D:\\', true))).toBe(true);
    expect(marks.files.has(markJoin('D:\\', 'repo', true))).toBe(false);
  });

  it('an earlier source wins for the same file; folders keep the first kind', () => {
    const marks = buildMarks(
      [
        { root: '/r', kind: 'uncommitted', paths: [{ path: 'x/f', status: 'modified' }] },
        { root: '/r/x', kind: 'undeployed', paths: [{ path: 'f', status: 'new' }, { path: 'g', status: 'new' }] },
      ],
      false,
    );
    expect(marks.files.get('/r/x/f')).toEqual({ status: 'modified', kind: 'uncommitted' });
    expect(marks.files.get('/r/x/g')).toEqual({ status: 'new', kind: 'undeployed' });
    expect(marks.folders.get('/r/x')).toBe('uncommitted');
    expect(marks.folders.has('/')).toBe(true);
  });

  it('ignores empty paths and trailing separators of the root', () => {
    const marks = buildMarks([{ root: '/r/', kind: 'uncommitted', paths: [{ path: '', status: 'new' }, { path: '/y', status: 'new' }] }], false);
    expect([...marks.files.keys()]).toEqual(['/r/y']);
  });
});
