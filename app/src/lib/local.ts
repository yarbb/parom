// Local file system commands implemented in src-tauri/src/local.rs.
import { invoke } from '@tauri-apps/api/core';
import type { FileRow } from './files';

interface LocalEntry {
  name: string;
  size: number;
  dir: boolean;
  link: boolean;
  mtime: number | null;
}

export interface LocalListing {
  path: string;
  parent: string | null;
  separator: string;
  rows: FileRow[];
}

export async function listLocal(path: string): Promise<LocalListing> {
  const res = await invoke<{ path: string; parent: string | null; separator: string; entries: LocalEntry[] }>('local_list', {
    path,
  });
  return {
    path: res.path,
    parent: res.parent,
    separator: res.separator,
    rows: res.entries.map((e) => ({ name: e.name, size: e.size, dir: e.dir, link: e.link, time: e.mtime })),
  };
}

export const localHome = () => invoke<string>('local_home');
export const localRoots = () => invoke<string[]>('local_roots');

/** All folders and files below `path`, relative with "/" (folders parents first). */
export const localWalk = (path: string) => invoke<{ dirs: string[]; files: string[] }>('local_walk', { path });
export const localMkdir = (path: string) => invoke<void>('local_mkdir', { path });