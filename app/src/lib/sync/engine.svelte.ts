// Server sync for the current site: reads the marker, compares it with the
// local repository, and runs a sync (lock, backup, upload, marker, command).
import { connection, describeError } from '../connection.svelte';
import { call } from '../daemon';
import { remoteJoin } from '../files';
import { prefs } from '../prefs.svelte';
import { sites, type Site } from '../sites.svelte';
import { git, host, joinLocal, type RepoStatus } from './host';
import { classify, parseRules, type Rules } from './managed';
import { lockActive, markerName, newNonce, parseMarker, serializeMarker, treeFingerprint, type Marker } from './marker';
import {
  detectServerEdits,
  foldersFor,
  needsConfirmation,
  planSync,
  serverState,
  type Edits,
  type Plan,
  type ServerFile,
  type ServerState,
  type TreeEntry,
} from './plan';

interface RemoteEntry {
  name: string;
  size: number;
  dir: boolean;
  time?: string;
}

export interface Check {
  site: Site;
  /** Remote folder the repository maps to. */
  root: string;
  repo: RepoStatus;
  marker: Marker | null;
  /** Server time of the marker file (for spotting later hand edits). */
  markerMtime: number | null;
  state: ServerState;
  edits: Edits;
  /** Commits HEAD has that the server's commit does not ("behind"). */
  behind: number;
  /** Managed files with uncommitted changes; sync refuses while there are any. */
  dirtyManaged: string[];
  rules: Rules;
}

export type StepState = 'pending' | 'running' | 'done' | 'skipped' | 'failed';

export interface Step {
  key: 'check' | 'lock' | 'backup' | 'upload' | 'marker' | 'command';
  state: StepState;
  detail: string;
}

export interface Run {
  steps: Step[];
  done: number;
  total: number;
  current: string;
  finished: boolean;
  error: string;
  canceled: boolean;
  commandOutput: string;
}

const lockTtl = 900;

function newRun(): Run {
  const keys: Step['key'][] = ['check', 'lock', 'backup', 'upload', 'marker', 'command'];
  return {
    steps: keys.map((key) => ({ key, state: 'pending', detail: '' })),
    done: 0,
    total: 0,
    current: '',
    finished: false,
    error: '',
    canceled: false,
    commandOutput: '',
  };
}

const parse = (time?: string) => {
  if (!time) {
    return null;
  }
  const ms = Date.parse(time.length === 10 ? `${time}T00:00:00Z` : time);
  return Number.isNaN(ms) ? null : ms;
};

class SyncEngine {
  /** Result of the last check for the connected site; null if it has no repository. */
  check = $state<Check | null>(null);
  checking = $state(false);
  error = $state('');
  /** Set when the server has no marker and the site says "ask". */
  offerMarker = $state(false);
  /** Set when "Versions differ" must be confirmed before syncing. */
  confirming = $state<{ plan: Plan; backup: boolean } | null>(null);
  run = $state<Run | null>(null);
  #askedThisSession = new Set<string>();
  #cancel = false;

  get active(): boolean {
    return !!connection.site?.localDir.trim() && connection.state === 'connected';
  }

  reset(): void {
    this.check = null;
    this.error = '';
    this.offerMarker = false;
    this.confirming = null;
  }

  #session(): number {
    if (connection.session === null) {
      throw new Error('Not connected');
    }
    return connection.session;
  }

  /** Lists one remote folder; a missing folder gives an empty map. */
  async #list(path: string): Promise<Map<string, RemoteEntry>> {
    try {
      const res = await call<{ entries: RemoteEntry[] }>('remote.list', { session: this.#session(), path });
      return new Map(res.entries.map((e) => [e.name, e]));
    } catch {
      return new Map();
    }
  }

  /** Server size and time for repository paths, listing each folder once. */
  async #serverFiles(root: string, paths: readonly string[]): Promise<Map<string, ServerFile>> {
    const byDir = new Map<string, string[]>();
    for (const p of paths) {
      const i = p.lastIndexOf('/');
      const dir = i < 0 ? '' : p.slice(0, i);
      byDir.set(dir, [...(byDir.get(dir) ?? []), p]);
    }
    const out = new Map<string, ServerFile>();
    for (const [dir, files] of byDir) {
      const listing = await this.#list(dir ? remoteJoin(root, dir) : root);
      for (const p of files) {
        const e = listing.get(p.slice(p.lastIndexOf('/') + 1));
        if (e && !e.dir) {
          out.set(p, { size: e.size, mtime: parse(e.time) });
        }
      }
    }
    return out;
  }

  async #tempFile(name: string): Promise<string> {
    const paths = await host.paths();
    return joinLocal(paths.data, 'tmp', `${newNonce()}-${name}`);
  }

  async #readMarker(root: string): Promise<{ marker: Marker | null; mtime: number | null }> {
    const entry = (await this.#list(root)).get(markerName);
    if (!entry || entry.dir) {
      return { marker: null, mtime: null };
    }
    const local = await this.#tempFile('marker.json');
    await call('transfer.download', { session: this.#session(), remote_path: root, remote_name: markerName, local, exists: 'overwrite' });
    return { marker: parseMarker(await host.readSmall(local)), mtime: parse(entry.time) };
  }

  /** Writes the marker under a temp name, then renames it into place. */
  async #writeMarker(root: string, marker: Marker): Promise<void> {
    const session = this.#session();
    const local = await this.#tempFile('marker.json');
    await host.writeSmall(local, serializeMarker(marker));
    const temp = `${markerName}.tmp`;
    await call('transfer.upload', { session, local, remote_path: root, remote_name: temp, exists: 'overwrite' });
    await this.#replace(root, temp, markerName);
  }

  /** Renames over an existing file; servers without atomic rename get delete + rename. */
  async #replace(dir: string, from: string, to: string): Promise<void> {
    const session = this.#session();
    const rename = () => call('remote.rename', { session, from_path: dir, from_name: from, to_path: dir, to_name: to });
    try {
      await rename();
    } catch {
      await call('remote.delete', { session, path: dir, names: [to] }).catch(() => {});
      await rename();
    }
  }

  async #who(): Promise<string> {
    return host.machineName();
  }

  /** Compares the server with the local repository. Called after connecting and after a sync. */
  async refresh(): Promise<void> {
    const site = connection.site;
    if (!this.active || !site) {
      this.reset();
      return;
    }
    this.checking = true;
    this.error = '';
    try {
      const dir = site.localDir.trim();
      const repo = await git.status(dir);
      if (!repo.head) {
        throw new Error('The local folder is a repository without commits.');
      }
      const root = site.remoteDir.trim() || connection.siteRoot;
      const rules = parseRules(await git.readFile(dir, repo.head, '.totzilla-ignore'));
      const { marker, mtime } = await this.#readMarker(root);
      const known = marker?.sha ? await git.hasCommit(dir, marker.sha) : false;
      const ancestor = known && marker?.sha ? await git.isAncestor(dir, marker.sha, repo.head) : false;
      const state = serverState({ marker, head: repo.head, markerKnown: known, markerIsAncestor: ancestor });

      let edits: Edits = { edited: [], missing: [] };
      if (prefs.value.syncDetectEdits && known && marker?.sha) {
        const deployed = (await git.tree(dir, marker.sha)).filter((f) => classify(f.path, rules) === 'managed');
        const server = await this.#serverFiles(root, deployed.map((f) => f.path));
        edits = detectServerEdits(deployed, server, mtime, rules);
      }
      const behind = state === 'behind' && marker?.sha ? await git.commitsBetween(dir, marker.sha, repo.head) : 0;
      this.check = {
        site,
        root,
        repo,
        marker,
        markerMtime: mtime,
        state,
        edits,
        behind,
        dirtyManaged: repo.dirty.filter((p) => classify(p, rules) === 'managed'),
        rules,
      };
      if (state === 'no-marker' && site.marker === 'ask' && !this.#askedThisSession.has(site.id)) {
        this.#askedThisSession.add(site.id);
        this.offerMarker = true;
      } else if (state === 'no-marker' && site.marker === 'on') {
        await this.createMarker();
      }
    } catch (e) {
      this.check = null;
      this.error = describeError(e);
    } finally {
      this.checking = false;
    }
  }

  /** "Create marker": records that this server is tracked; the first sync fills in the commit. */
  async createMarker(): Promise<void> {
    const c = this.check;
    if (!c) {
      return;
    }
    await this.#writeMarker(c.root, {
      format: 1,
      repo: c.site.repo,
      sha: null,
      tree: null,
      who: await this.#who(),
      when: new Date().toISOString(),
      lock: null,
    });
    await this.refresh();
  }

  /** Remembers the answer to "Track sync state?" in the site. */
  async setSiteMarker(choice: Site['marker']): Promise<void> {
    const site = connection.site;
    if (!site) {
      return;
    }
    const list = sites.list.map((s) => (s.id === site.id ? { ...s, marker: choice } : s));
    await sites.save(sites.folders, list);
    connection.site = list.find((s) => s.id === site.id) ?? site;
  }

  async #plan(c: Check): Promise<Plan> {
    const dir = c.site.localDir.trim();
    const head = c.repo.head!;
    const headTree = await git.tree(dir, head);
    const markerSha = c.marker?.sha;
    const useDiff = (c.state === 'behind' || c.state === 'diverged') && markerSha;
    const changes = useDiff ? await git.diff(dir, markerSha, head) : null;
    const server = changes ? new Map<string, ServerFile>() : await this.#serverFiles(c.root, headTree.map((f) => f.path));
    return planSync({
      head: headTree,
      changes,
      server,
      rules: c.rules,
      restore: [...c.edits.edited, ...c.edits.missing],
    });
  }

  /** "Sync with server": confirms first when Preferences say so, then runs. */
  async start(): Promise<void> {
    await this.refresh();
    const c = this.check;
    if (!c || this.run) {
      return;
    }
    if (c.dirtyManaged.length) {
      this.error = `Commit or stash your changes first (${c.dirtyManaged.length} changed file${c.dirtyManaged.length === 1 ? '' : 's'}).`;
      return;
    }
    const plan = await this.#plan(c);
    const ask = {
      versionsDiffer: prefs.value.syncAskVersionsDiffer,
      changedBySomeoneElse: prefs.value.syncAskSomeoneElse,
      localOnly: prefs.value.syncAskLocalOnly,
    };
    if (needsConfirmation(c.state, c.edits, ask)) {
      this.confirming = { plan, backup: prefs.value.syncBackup };
    } else {
      await this.execute(plan, prefs.value.syncBackup);
    }
  }

  cancel(): void {
    this.#cancel = true;
    if (this.run) {
      this.run.canceled = true;
    }
  }

  async execute(plan: Plan, backup: boolean): Promise<void> {
    const c = this.check;
    if (!c || this.run) {
      return;
    }
    this.confirming = null;
    this.#cancel = false;
    this.run = newRun();
    const run = this.run;
    const step = (key: Step['key']) => run.steps.find((s) => s.key === key)!;
    const tracked = c.state !== 'no-marker';
    const dir = c.site.localDir.trim();
    const head = c.repo.head!;
    const who = await this.#who();
    let previous: Marker | null = null;
    let locked = false;

    const fail = (key: Step['key'], message: string) => {
      step(key).state = 'failed';
      run.error = message;
    };

    try {
      // 1. Marker: re-read so a sync that just happened elsewhere is not missed.
      step('check').state = 'running';
      const fresh = tracked ? await this.#readMarker(c.root) : { marker: null, mtime: null };
      previous = fresh.marker;
      if (tracked && fresh.marker?.sha !== c.marker?.sha) {
        return fail('check', 'The server changed since the check. Check again before syncing.');
      }
      step('check').state = 'done';
      step('check').detail = previous?.sha?.slice(0, 7) ?? '';

      // 2. Lock. SFTP and FTP have no compare-and-swap, so a tiny race remains;
      //    writing a nonce and reading it back catches nearly all of it.
      if (tracked && prefs.value.syncLock && previous) {
        step('lock').state = 'running';
        if (lockActive(previous.lock) && previous.lock?.by !== who) {
          return fail('lock', `${previous.lock?.by} is syncing this server (since ${previous.lock?.since}).`);
        }
        const nonce = newNonce();
        await this.#writeMarker(c.root, { ...previous, lock: { by: who, since: new Date().toISOString(), ttl: lockTtl, nonce } });
        locked = true;
        await new Promise((r) => setTimeout(r, 2000));
        const check = await this.#readMarker(c.root);
        if (check.marker?.lock?.nonce !== nonce) {
          locked = false;
          return fail('lock', `${check.marker?.lock?.by ?? 'Someone else'} started syncing at the same time.`);
        }
        step('lock').state = 'done';
      } else {
        step('lock').state = 'skipped';
      }

      // 3. Backup of everything this sync overwrites.
      const existing = await this.#serverFiles(c.root, plan.upload);
      const toBackup = plan.upload.filter((p) => existing.has(p));
      let backupDir = '';
      if (backup && toBackup.length) {
        step('backup').state = 'running';
        const paths = await host.paths();
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        backupDir = joinLocal(paths.backups, c.site.id, `${stamp}-${(previous?.sha ?? 'unknown').slice(0, 7)}`);
        for (const p of toBackup) {
          if (this.#cancel) {
            throw new Error('Canceled');
          }
          const i = p.lastIndexOf('/');
          await call('transfer.download', {
            session: this.#session(),
            remote_path: i < 0 ? c.root : remoteJoin(c.root, p.slice(0, i)),
            remote_name: p.slice(i + 1),
            local: joinLocal(backupDir, p),
            exists: 'overwrite',
          });
        }
        await host.writeSmall(
          joinLocal(backupDir, 'backup.json'),
          JSON.stringify({ when: new Date().toISOString(), site: c.site.name, root: c.root, sha: previous?.sha ?? null, reason: 'before sync', files: toBackup }, null, 2),
        );
        step('backup').state = 'done';
        step('backup').detail = String(toBackup.length);
        await this.#pruneBackups(c.site.id);
      } else {
        step('backup').state = 'skipped';
      }

      // 4. Upload: temp name, then rename, so the server never runs half a file.
      step('upload').state = 'running';
      run.total = plan.upload.length;
      for (const f of foldersFor(plan.upload)) {
        await call('remote.mkdir', { session: this.#session(), path: remoteJoin(c.root, f) }).catch(() => {});
      }
      for (const p of plan.upload) {
        if (this.#cancel) {
          throw new Error('Canceled');
        }
        const i = p.lastIndexOf('/');
        const remoteDir = i < 0 ? c.root : remoteJoin(c.root, p.slice(0, i));
        const name = p.slice(i + 1);
        run.current = remoteJoin(remoteDir, name);
        const tr = await connection.transfer(false, p, {
          local: joinLocal(dir, p),
          remote_path: remoteDir,
          remote_name: `${name}.totzilla-part`,
          exists: 'overwrite',
        });
        if (tr.state !== 'done') {
          throw new Error(`${p}: ${tr.error ?? 'upload failed'}`);
        }
        await this.#replace(remoteDir, `${name}.totzilla-part`, name);
        run.done++;
      }
      run.current = '';
      step('upload').state = 'done';

      // 5. Marker: the new commit, and the lock released in the same write.
      if (tracked) {
        step('marker').state = 'running';
        const headTree = (await git.tree(dir, head)).filter((f: TreeEntry) => classify(f.path, c.rules) === 'managed');
        await this.#writeMarker(c.root, {
          format: 1,
          repo: c.site.repo,
          sha: head,
          tree: await treeFingerprint(headTree),
          who,
          when: new Date().toISOString(),
          lock: null,
        });
        locked = false;
        step('marker').state = 'done';
        step('marker').detail = head.slice(0, 7);
      } else {
        step('marker').state = 'skipped';
      }

      // 6. Optional command on this computer (e.g. a hosting panel restart call).
      const command = c.site.postSync.trim();
      if (command) {
        step('command').state = 'running';
        const res = await host.runCommand(command, dir);
        run.commandOutput = res.output;
        step('command').state = res.code === 0 ? 'done' : 'failed';
        if (res.code !== 0) {
          run.error = `The command after sync exited with code ${res.code ?? '?'}.`;
        }
      } else {
        step('command').state = 'skipped';
      }

      await this.#history(c, previous?.sha ?? null, head, plan.upload.length, backupDir, run.error || 'ok');
    } catch (e) {
      const running = run.steps.find((s) => s.state === 'running');
      if (running) {
        running.state = 'failed';
      }
      run.error = this.#cancel ? 'Canceled.' : describeError(e);
      await this.#history(c, previous?.sha ?? null, head, run.done, '', run.error).catch(() => {});
    } finally {
      if (locked && previous) {
        // Leave the server as it was: the old marker without our lock.
        await this.#writeMarker(c.root, { ...previous, lock: null }).catch(() => {});
      }
      run.finished = true;
      await this.refresh();
    }
  }

  async #history(c: Check, from: string | null, to: string, files: number, backup: string, result: string) {
    const paths = await host.paths();
    await host.appendLine(
      joinLocal(paths.history, `${c.site.id}.jsonl`),
      JSON.stringify({ when: new Date().toISOString(), site: c.site.name, root: c.root, from, to, files, backup, result }),
    );
  }

  /** Keeps the newest `backupKeep` backups of a site. */
  async #pruneBackups(siteId: string) {
    const { backups } = await host.paths();
    const { listLocal } = await import('../local');
    const listing = await listLocal(joinLocal(backups, siteId)).catch(() => null);
    if (!listing) {
      return;
    }
    const dirs = listing.rows.filter((r) => r.dir).map((r) => r.name).sort().reverse();
    for (const old of dirs.slice(Math.max(1, prefs.value.backupKeep))) {
      await host.removeBackup(joinLocal(backups, siteId, old)).catch(() => {});
    }
  }

  closeRun(): void {
    if (this.run?.finished) {
      this.run = null;
    }
  }
}

export const sync = new SyncEngine();
