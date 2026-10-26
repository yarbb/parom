// Edit server files in place, like FileZilla: download a temp copy, open it
// in an editor, and upload it again when the editor saves it.
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { connection } from './connection.svelte';
import { localJoin, remoteJoin } from './files';
import { prefs } from './prefs.svelte';

export interface EditedFile {
  /** Temp copy on this computer. */
  local: string;
  remotePath: string;
  name: string;
  /** false after "upload without asking" for this file. */
  ask: boolean;
}

class Edits {
  files = $state<EditedFile[]>([]);
  /** Saved files waiting for "upload?"; the first one is asked. */
  asking = $state<EditedFile[]>([]);
  error = $state('');
  #started = false;

  start(): void {
    if (this.#started || !isTauri()) {
      return;
    }
    this.#started = true;
    void listen<string>('edit-saved', (e) => this.#saved(e.payload));
  }

  async edit(remotePath: string, name: string): Promise<void> {
    this.error = '';
    try {
      const dir = await invoke<string>('edit_new_dir');
      const local = localJoin(dir, name, dir.includes('\\') ? '\\' : '/');
      const tr = await connection.transfer(true, name, { remote_path: remotePath, remote_name: name, local, exists: 'overwrite' });
      if (tr.state !== 'done') {
        this.error = tr.error ?? '';
        return;
      }
      this.files.push({ local, remotePath, name, ask: true });
      await invoke('edit_watch', { path: local });
      await invoke('edit_open', { path: local, editor: prefs.value.editorPath || null });
    } catch (e) {
      this.error = String(e);
    }
  }

  #saved(path: string): void {
    const f = this.files.find((x) => x.local === path);
    if (!f || !prefs.value.editUploadOnSave || connection.state !== 'connected') {
      return;
    }
    if (prefs.value.editAsk && f.ask) {
      if (!this.asking.includes(f)) {
        this.asking.push(f);
      }
    } else {
      void this.upload(f);
    }
  }

  async upload(f: EditedFile): Promise<void> {
    await connection.transfer(false, f.name, { local: f.local, remote_path: f.remotePath, remote_name: f.name, exists: 'overwrite' });
  }

  /** Answers the "upload?" question for the first waiting file. */
  async answer(upload: boolean, dontAskAgain: boolean): Promise<void> {
    const f = this.asking.shift();
    if (!f) {
      return;
    }
    if (dontAskAgain) {
      f.ask = false;
    }
    if (upload) {
      await this.upload(f);
    }
  }

  remoteName(f: EditedFile): string {
    return remoteJoin(f.remotePath, f.name);
  }

  /** Stops watching after a disconnect; temp copies are removed on the next start. */
  async stopAll(): Promise<void> {
    for (const f of this.files) {
      await invoke('edit_unwatch', { path: f.local }).catch(() => {});
    }
    this.files = [];
    this.asking = [];
  }
}

export const edits = new Edits();
