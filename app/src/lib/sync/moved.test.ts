import { describe, expect, it } from 'vitest';
import { movedFolder } from './moved';

const files = ['addons/a.lua', 'addons/b.lua', 'gamemodes/x/init.lua', 'lua/autorun/c.lua', 'lua/d.lua', 'lua/e.lua'];
const under = (folder: string) => files.map((f) => (folder ? `${folder}/${f}` : f));

describe('movedFolder', () => {
  it('finds the folder the root files moved into', () => {
    expect(movedFolder('', files, under('serverFiles'))).toBe('serverFiles');
  });

  it('follows a site folder that moved again, or back to the root', () => {
    expect(movedFolder('serverFiles', under('serverFiles'), under('game/server'))).toBe('game/server');
    expect(movedFolder('serverFiles', under('serverFiles'), files)).toBe('');
  });

  it('allows a few other changes next to the move', () => {
    const added = [...under('serverFiles'), 'serverFiles/addons/new.lua', 'README.md'];
    expect(movedFolder('', [...files, 'docs/old.md'], added)).toBe('serverFiles');
    expect(movedFolder('sub', files, under('serverFiles'))).toBeNull();
  });

  it('is not a move when few files or only some of them went', () => {
    expect(movedFolder('', ['a.lua', 'b.lua'], ['x/a.lua', 'x/b.lua'])).toBeNull();
    expect(movedFolder('', files, under('serverFiles').slice(0, 3))).toBeNull();
    expect(movedFolder('', files, [])).toBeNull();
  });
});
