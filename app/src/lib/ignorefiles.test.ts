import { describe, expect, it } from 'vitest';
import { extensionPattern, ignoreLine, inRepo, withLines } from './ignorefiles';

describe('ignore lines', () => {
  it('anchors paths at the repository root, folders with a slash', () => {
    expect(ignoreLine('git', { rel: 'logs/a.txt', dir: false })).toBe('/logs/a.txt');
    expect(ignoreLine('git', { rel: 'data', dir: true })).toBe('/data/');
    expect(ignoreLine('protect', { rel: 'data', dir: true })).toBe('!/data/');
  });

  it('makes an extension pattern only for names with one', () => {
    expect(extensionPattern('server.log')).toBe('*.log');
    expect(extensionPattern('.env')).toBeNull();
    expect(extensionPattern('Makefile')).toBeNull();
  });

  it('appends only new lines and keeps the line endings', () => {
    expect(withLines('', ['/a'])).toBe('/a\n');
    expect(withLines('/a', ['/a', '/b', '/b'])).toBe('/a\n/b\n');
    expect(withLines('x\r\n', ['y'])).toBe('x\r\ny\r\n');
    expect(withLines('/a\n', ['/a'])).toBeNull();
  });

  it('finds the deepest repository holding a path', () => {
    expect(inRepo(['C:\\r', 'C:\\r\\sub'], 'C:\\R\\sub\\x\\f.txt')).toEqual({ dir: 'C:\\r\\sub', rel: 'x/f.txt' });
    expect(inRepo(['/home/u/r'], '/home/u/other/f')).toBeNull();
    expect(inRepo(['/home/u/r'], '/home/u/r')).toBeNull();
  });
});
