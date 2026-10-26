// Recently used servers for the top bar menu. Only host, user and port are
// kept, never passwords (those go to the OS credential store with the Site
// Manager in M2). Stored per machine in the webview's storage for now.

export interface RecentServer {
  protocol: string;
  host: string;
  port?: number;
  user: string;
}

const storageKey = 'recent-servers';
export const maxRecent = 8;

const same = (a: RecentServer, b: RecentServer) =>
  a.protocol === b.protocol && a.host.toLowerCase() === b.host.toLowerCase() && a.port === b.port && a.user === b.user;

/** Moves `server` to the front, dropping duplicates and the oldest entries. */
export function addRecent(list: readonly RecentServer[], server: RecentServer): RecentServer[] {
  return [server, ...list.filter((s) => !same(s, server))].slice(0, maxRecent);
}

export function removeRecent(list: readonly RecentServer[], server: RecentServer): RecentServer[] {
  return list.filter((s) => !same(s, server));
}

/** "user@host:port", or with the host masked when the address is hidden. */
export function recentLabel(s: RecentServer, hideAddress: boolean, hidden: string): string {
  const host = hideAddress ? hidden : `${s.host}${s.port ? `:${s.port}` : ''}`;
  const scheme = s.protocol === 'sftp' ? '' : `${s.protocol}://`;
  return `${scheme}${s.user ? `${s.user}@` : ''}${host}`;
}

export function loadRecent(): RecentServer[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((s): s is RecentServer => typeof s?.host === 'string' && typeof s?.user === 'string' && typeof s?.protocol === 'string')
      .slice(0, maxRecent);
  } catch {
    return [];
  }
}

export function saveRecent(list: readonly RecentServer[]): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(list));
  } catch {
    // Not fatal: the list just will not persist.
  }
}
