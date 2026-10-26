// Saved sites (Site Manager). The list lives in the daemon's store
// ("sites"); passwords live in the OS credential store under "site:<id>".
import { call } from './daemon';
import { deleteSecret } from './secrets';

export type Protocol = 'sftp' | 'ftp' | 'ftps' | 'ftpes' | 'ftp-insecure';
export type Logon = 'normal' | 'ask' | 'key' | 'anonymous';
export type ExistsDefault = 'ask' | 'overwrite' | 'overwrite_newer' | 'skip';

export interface Site {
  id: string;
  name: string;
  /** Folder name in the tree; "" for the top level. */
  folder: string;
  protocol: Protocol;
  host: string;
  port?: number;
  logon: Logon;
  user: string;
  keyfile: string;
  /** A password for it is in the OS credential store. */
  savedPassword: boolean;
  remoteDir: string;
  localDir: string;
  /** Seconds; empty uses the default. */
  timeout?: number;
  exists: ExistsDefault;
  /** Milliseconds between requests, for hosts that rate-limit them (0 = none). */
  pace?: number;
  // Sync and GitHub (used from M3 on).
  repo: string;
  marker: 'ask' | 'on' | 'off';
  postSync: string;
}

interface SitesDoc {
  version: 1;
  folders: string[];
  sites: Site[];
}

export const protocols: Protocol[] = ['sftp', 'ftpes', 'ftps', 'ftp', 'ftp-insecure'];

export function newSite(folder = ''): Site {
  return {
    id: crypto.randomUUID(),
    name: 'New site',
    folder,
    protocol: 'sftp',
    host: '',
    logon: 'normal',
    user: '',
    keyfile: '',
    savedPassword: false,
    remoteDir: '',
    localDir: '',
    exists: 'ask',
    repo: '',
    marker: 'ask',
    postSync: '',
  };
}

export const siteSecretKey = (site: Site) => `site:${site.id}`;

class Sites {
  folders = $state<string[]>([]);
  list = $state<Site[]>([]);
  loaded = $state(false);
  error = $state('');

  async load(): Promise<void> {
    try {
      const res = await call<{ value: SitesDoc | null }>('store.get', { name: 'sites' });
      this.folders = res.value?.folders ?? [];
      this.list = (res.value?.sites ?? []).map((s) => ({ ...newSite(), ...s }));
      this.error = '';
    } catch (e) {
      this.error = String((e as Error).message ?? e);
    } finally {
      this.loaded = true;
    }
  }

  /** Replaces everything (the Site Manager edits a copy and saves on OK). */
  async save(folders: string[], list: Site[]): Promise<void> {
    const removed = this.list.filter((old) => !list.some((s) => s.id === old.id) && old.savedPassword);
    const doc: SitesDoc = { version: 1, folders: [...folders], sites: list.map((s) => ({ ...s })) };
    await call('store.set', { name: 'sites', value: doc });
    this.folders = doc.folders;
    this.list = doc.sites;
    for (const s of removed) {
      void deleteSecret(siteSecretKey(s)).catch(() => {});
    }
  }
}

export const sites = new Sites();
