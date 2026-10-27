// Passwords in the OS credential store (src-tauri/src/secrets.rs).
import { invoke, isTauri } from '@tauri-apps/api/core';

export async function getSecret(key: string): Promise<string | null> {
  return isTauri() ? invoke<string | null>('secret_get', { key }) : null;
}

export async function setSecret(key: string, password: string): Promise<void> {
  if (isTauri()) {
    await invoke('secret_set', { key, password });
  }
}

/** Copies passwords saved under the app's old name; returns how many. */
export async function migrateSecrets(keys: string[]): Promise<number> {
  return isTauri() ? invoke<number>('secret_migrate', { keys }) : 0;
}

export async function deleteSecret(key: string): Promise<void> {
  if (isTauri()) {
    await invoke('secret_delete', { key });
  }
}
