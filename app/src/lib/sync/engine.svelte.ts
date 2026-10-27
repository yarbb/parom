// Server sync for the current site: reads the marker, compares it with the
// local repository, and runs a sync (lock, backup, upload, marker, command).
import { connection, describeError } from '../connection.svelte';
import { call } from '../daemon';
import { remoteJoin } from '../files';
import { prefs } from '../prefs.svelte';
import { closeDeployedIssues } from '../deployed';
import { sites, type Site } from '../sites.svelte';
import { invoke } from '@tauri-apps/api/core';
import { repo, type LogEntry } from '../repo.svelte';
import { ui } from '../ui.svelte';
import { backupsRoot, git, host, joinLocal, type RepoStatus } from './host';
import { classify, parseRules, type Rules } from './managed';
import { lockActive, markerName, newNonce, parseMarker, serializeMarker, treeFingerprint, type Marker } from './marker';
import {
  detectServerEdits,
  foldersFor,
  needsConfirmation,
  planSync,
  pullCandidates,
  serverState,
  type Edits,
  type ListedFile,
  type Plan,
  type PreviewItem,
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
  /** Managed files with uncommitted changes; a sync deploys the commit, not these. */
  dirtyManaged: string[];
  rules: Rules;
}

export interface Preview {
  direction: 'deploy' | 'pull';
  items: PreviewItem[];
  /** Deploy: commits the server does not have yet. */
  commits: LogEntry[];
  /** Deploy: the plan the items came from. */
  plan: Plan | null;
  /** Deploy: versions differ or the server was edited by hand. */
  warn: boolean;
  backup: boolean;
  /** Pull: where the server files were downloaded. */
  folder: string;
}

export type StepState = 'pending' | 'running' | 'done' | 'skipped' | 'failed';

export interface Step {
  key: 'check' | 'lock' | 'backup' | 'upload' | 'marker' | 'issues' | 'command';
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
  const keys: Step['key'][] = ['check', 'lock', 'backup', 'upload', 'marker', 'issues', 'command'];
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
  /** "Sync with server" was pressed: which direction? */
  choosing = $state(false);
  /** What a sync would do, shown before it starts (either direction). */
  preview = $state<Preview | null>(null);
  run = $state<Run | null>(null);
  /** What a check or the preparation of a sync is doing right now ("" when idle). */
  progress = $state('');
  /** Between "Sync with server" and the confirmation or the progress dialog. */
  preparing = $state(false);
  #askedThisSession = new Set<string>();
  #cancel = false;
  /** "Cancel sync" while a check or the preparation walks the server. */
  #stopWalk = false;

  get active(): boolean {
    return !!connection.site?.localDir.trim() && connection.state === 'connected';
  }

  reset(): void {
    this.check = null;
    this.error = '';
    this.offerMarker = false;
    this.choosing = false;
    void this.cancelPreview();
  }

  #session(): number {
    if (connection.session === null) {
      throw new Error('Not connected');
    }
    return connection.session;
  }

  // Every FTP listing costs a command and a data connection, and hosts
  // rate-limit bursts ("too many requests"). Within one check or sync each
  // folder is listed once, and listings are spaced out a little.
  #cache = new Map<string, Map<string, RemoteEntry> | null>();
  #lastList = 0;
  static readonly listGapMs = 150;

  /** Lists one remote folder; null if it cannot be listed (usually: it does not exist). */
  async #list(path: string, fresh = false): Promise<Map<string, RemoteEntry> | null> {
    if (!fresh && this.#cache.has(path)) {
      return this.#cache.get(path)!;
    }
    if (this.#stopWalk) {
      throw new Error('Canceled');
    }
    const wait = this.#lastList + SyncEngine.listGapMs - Date.now();
    if (wait > 0) {
      await new Promise((r) => setTimeout(r, wait));
    }
    this.#lastList = Date.now();
    let listing: Map<string, RemoteEntry> | null;
    try {
      const res = await call<{ entries: RemoteEntry[] }>('remote.list', { session: this.#session(), path });
      listing = new Map(res.entries.map((e) => [e.name, e]));
    } catch {
      listing = null;
    }
    this.#cache.set(path, listing);
    return listing;
  }

  /** Whether a folder is known to exist from listings made in this operation. */
  #knownFolder(root: string, rel: string): boolean {
    const i = rel.lastIndexOf('/');
    const parent = i < 0 ? root : remoteJoin(root, rel.slice(0, i));
    return !!this.#cache.get(parent)?.get(rel.slice(i + 1))?.dir;
  }

  /**
   * Server size and time for repository paths, listing each folder once.
   * Folders below a folder the server does not have are not listed at all,
   * which keeps a first sync over FTP from walking hundreds of missing folders.
   */
  async #serverFiles(root: string, paths: readonly string[]): Promise<Map<string, ServerFile>> {
    const byDir = new Map<string, string[]>();
    for (const p of paths) {
      const i = p.lastIndexOf('/');
      const dir = i < 0 ? '' : p.slice(0, i);
      byDir.set(dir, [...(byDir.get(dir) ?? []), p]);
    }
    // Parents first, so a missing parent is known before its children.
    const dirs = [...byDir.keys()].sort((a, b) => a.split('/').length - b.split('/').length);
    const listed = new Map<string, Map<string, RemoteEntry>>();
    const missing = new Set<string>();
    // A folder is known to be absent if any ancestor is missing, or a listed
    // ancestor has no such subfolder.
    const absent = (dir: string): boolean => {
      for (let d = dir; d; d = d.includes('/') ? d.slice(0, d.lastIndexOf('/')) : '') {
        const parent = d.includes('/') ? d.slice(0, d.lastIndexOf('/')) : '';
        const parentListing = listed.get(parent);
        if (missing.has(d) || (parentListing && !parentListing.get(d.slice(d.lastIndexOf('/') + 1))?.dir)) {
          return true;
        }
      }
      return false;
    };
    const out = new Map<string, ServerFile>();
    // The root listing alone rules out whole trees (e.g. a wrong remote directory).
    const rootListing = await this.#list(root);
    listed.set('', rootListing ?? new Map());
    let n = 0;
    for (const dir of dirs) {
      n++;
      this.progress = `${n} / ${dirs.length}`;
      if (dir && absent(dir)) {
        continue;
      }
      const listing = dir ? await this.#list(remoteJoin(root, dir)) : rootListing;
      if (!listing) {
        missing.add(dir);
        continue;
      }
      listed.set(dir, listing);
      for (const p of byDir.get(dir) ?? []) {
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
    // Always fresh: the marker is what tells syncs apart.
    const listing = await this.#list(root, true);
    if (!listing) {
      throw new Error(`Cannot open ${root} on the server. Check the site's remote directory.`);
    }
    const entry = listing.get(markerName);
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

  /**
   * Compares the server with the local repository. Called after connecting,
   * from Check, before and after a sync. `keepCache` reuses this operation's
   * listings; `skipEdits` skips walking the folders (right after a sync).
   */
  async refresh(opts: { keepCache?: boolean; skipEdits?: boolean } = {}): Promise<void> {
    const site = connection.site;
    if (!this.active || !site) {
      this.reset();
      return;
    }
    if (!opts.keepCache) {
      this.#cache.clear();
    }
    if (!this.preparing) {
      this.#stopWalk = false;
    }
    const before = this.check;
    this.checking = true;
    this.error = '';
    try {
      const dir = site.localDir.trim();
      const repo = await git.status(dir);
      if (!repo.head) {
        throw new Error('The local folder is a repository without commits.');
      }
      const root = site.remoteDir.trim() || connection.siteRoot;
      const rules = { ...parseRules(await git.readFile(dir, repo.head, '.totzilla-ignore')), within: site.syncPaths ?? [] };
      const { marker, mtime } = await this.#readMarker(root);
      const known = marker?.sha ? await git.hasCommit(dir, marker.sha) : false;
      const ancestor = known && marker?.sha ? await git.isAncestor(dir, marker.sha, repo.head) : false;
      const state = serverState({ marker, head: repo.head, markerKnown: known, markerIsAncestor: ancestor });

      let edits: Edits = { edited: [], missing: [] };
      if (prefs.value.syncDetectEdits && !opts.skipEdits && known && marker?.sha) {
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
      // A canceled walk keeps the last result instead of an error.
      this.check = this.#stopWalk ? before : null;
      this.error = this.#stopWalk ? '' : describeError(e);
    } finally {
      this.checking = false;
      if (!this.preparing) {
        this.progress = '';
      }
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
    // Only managed paths: folders left out in the Site Manager are not walked.
    const headTree = (await git.tree(dir, head)).filter((f) => classify(f.path, c.rules) !== 'unmanaged');
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
    if (this.preparing || this.run) {
      return;
    }
    this.preparing = true;
    this.#stopWalk = false;
    try {
      await this.#start();
    } catch (e) {
      this.error = this.#stopWalk ? '' : describeError(e);
    } finally {
      this.preparing = false;
      this.progress = '';
    }
  }

  async #start(): Promise<void> {
    // One fresh walk of the server for the whole sync.
    this.#cache.clear();
    await this.refresh({ keepCache: true });
    const c = this.check;
    if (!c || this.run || this.#stopWalk) {
      return;
    }

    const plan = await this.#plan(c);
    if (this.#stopWalk) {
      return;
    }
    const ask = {
      versionsDiffer: prefs.value.syncAskVersionsDiffer,
      changedBySomeoneElse: prefs.value.syncAskSomeoneElse,
      localOnly: prefs.value.syncAskLocalOnly,
    };
    const warn = needsConfirmation(c.state, c.edits, ask);
    if (!prefs.value.syncPreview && !warn) {
      await this.execute(plan, prefs.value.syncBackup);
      return;
    }
    // Which uploads replace a file on the server: the same folder listings
    // the upload uses afterwards (cached), so no extra requests.
    const existing = await this.#serverFiles(c.root, plan.upload);
    const edited = new Set([...c.edits.edited, ...c.edits.missing]);
    this.preview = {
      direction: 'deploy',
      items: plan.upload.map((path) => ({
        path,
        kind: edited.has(path) ? 'edited' : existing.has(path) ? 'overwrite' : 'new',
        include: true,
      })),
      commits: await this.#commits(c.site.localDir.trim(), c.marker?.sha ?? null, c.repo.head!),
      plan,
      warn,
      backup: prefs.value.syncBackup,
      folder: '',
    };
  }

  /** Commits the server does not have yet, newest first (at most 50). */
  async #commits(dir: string, from: string | null, to: string): Promise<LogEntry[]> {
    const log = await invoke<LogEntry[]>('repo_log', { dir, limit: 300 }).catch(() => [] as LogEntry[]);
    const start = Math.max(0, log.findIndex((c) => c.sha === to));
    const end = from ? log.findIndex((c) => c.sha === from) : -1;
    return log.slice(start, end > start ? end : start + 50).slice(0, 50);
  }

  /** "Server to GitHub": finds server files that differ from the local folder and previews them. */
  async startPull(): Promise<void> {
    if (this.preparing || this.run) {
      return;
    }
    this.choosing = false;
    this.preparing = true;
    this.#stopWalk = false;
    try {
      await this.#startPull();
    } catch (e) {
      this.error = this.#stopWalk ? '' : describeError(e);
    } finally {
      this.preparing = false;
      this.progress = '';
    }
  }

  async #startPull(): Promise<void> {
    this.#cache.clear();
    await this.refresh({ keepCache: true, skipEdits: true });
    const c = this.check;
    if (!c || this.run || this.#stopWalk) {
      return;
    }
    const dir = c.site.localDir.trim();
    // "Changed on the server" means changed since the deployed commit: a server
    // that is simply behind must not offer its older files as changes.
    const deployed = c.marker?.sha && (await git.hasCommit(dir, c.marker.sha)) ? c.marker.sha : c.repo.head!;
    const head = (await git.tree(dir, deployed)).filter((f) => classify(f.path, c.rules) === 'managed');
    const server = await this.#serverFiles(c.root, head.map((f) => f.path));
    // Folders the walk listed (the repository's folders that exist on the server).
    const listings = new Map<string, ListedFile[]>();
    const folders = new Set(['', ...head.map((f) => (f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : ''))]);
    for (const folder of folders) {
      const listing = this.#cache.get(folder ? remoteJoin(c.root, folder) : c.root);
      if (listing) {
        listings.set(folder, [...listing.values()]);
      }
    }
    const candidates = pullCandidates({ head, server, listings, markerMtime: c.markerMtime, rules: c.rules });

    // Download them next to the repository, then keep only real differences.
    const folder = joinLocal((await host.paths()).data, 'tmp', `pull-${newNonce()}`);
    const items: PreviewItem[] = [];
    const dirty = new Set(c.repo.dirty);
    let n = 0;
    for (const p of candidates) {
      if (this.#stopWalk) {
        await host.removeBackup(folder).catch(() => {});
        throw new Error('Canceled');
      }
      this.progress = `${++n} / ${candidates.length}`;
      const i = p.lastIndexOf('/');
      await call('transfer.download', {
        session: this.#session(),
        remote_path: i < 0 ? c.root : remoteJoin(c.root, p.slice(0, i)),
        remote_name: p.slice(i + 1),
        local: joinLocal(folder, p),
        exists: 'overwrite',
      });
      const same = await host.compareFiles(joinLocal(folder, p), joinLocal(dir, p));
      if (same === 'missing') {
        items.push({ path: p, kind: 'new', include: true });
      } else if (same === 'different') {
        // Uncommitted local edits are not overwritten unless asked to.
        items.push({ path: p, kind: dirty.has(p) ? 'dirty' : 'overwrite', include: !dirty.has(p) });
      }
    }
    this.preview = { direction: 'pull', items, commits: [], plan: null, warn: false, backup: false, folder };
  }

  /** Runs the previewed sync with the files left ticked. */
  async applyPreview(): Promise<void> {
    const p = this.preview;
    if (!p) {
      return;
    }
    const chosen = p.items.filter((i) => i.include).map((i) => i.path);
    if (p.direction === 'deploy' && p.plan) {
      this.preview = null;
      await this.execute({ ...p.plan, upload: chosen }, p.backup);
      return;
    }
    const c = this.check;
    if (!c) {
      return;
    }
    const dir = c.site.localDir.trim();
    try {
      for (const path of chosen) {
        await host.copyFile(joinLocal(p.folder, path), joinLocal(dir, path));
      }
      this.error = '';
    } catch (e) {
      this.error = describeError(e);
    } finally {
      await this.cancelPreview();
    }
    // The files are now local changes: review and commit them in Changes.
    repo.changed++;
    if (chosen.length) {
      ui.tab = 'github';
    }
  }

  async cancelPreview(): Promise<void> {
    const folder = this.preview?.folder;
    this.preview = null;
    if (folder) {
      await host.removeBackup(folder).catch(() => {});
    }
  }

  /** Stops a check or the preparation of a sync at the next folder listing. */
  stopWalk(): void {
    this.#stopWalk = true;
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
    this.preview = null;
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
    let exportDir = '';

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
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        backupDir = joinLocal(await backupsRoot(prefs.value.backupDir), c.site.id, `${stamp}-${(previous?.sha ?? 'unknown').slice(0, 7)}`);
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

      // 4. Upload the committed version (not whatever is on disk): exported from
      //    git, sent under a temp name, then renamed so the server never runs half a file.
      step('upload').state = 'running';
      run.total = plan.upload.length;
      exportDir = joinLocal((await host.paths()).data, 'tmp', `export-${newNonce()}`);
      await git.export(dir, head, plan.upload, exportDir);
      for (const f of foldersFor(plan.upload)) {
        if (!this.#knownFolder(c.root, f)) {
          await call('remote.mkdir', { session: this.#session(), path: remoteJoin(c.root, f) }).catch(() => {});
        }
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
          local: joinLocal(exportDir, p),
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

      // 6. Issues the deployed commits close ("Fixes #12"): a comment, then
      //    closed. Best effort: a failure here does not undo the sync.
      if (prefs.value.syncCloseIssues && previous?.sha) {
        step('issues').state = 'running';
        try {
          const closed = await closeDeployedIssues(dir, previous.sha, head, c.site.name);
          step('issues').state = closed === null ? 'skipped' : 'done';
          step('issues').detail = closed?.length ? closed.map((n) => `#${n}`).join(' ') : '';
        } catch (e) {
          step('issues').state = 'failed';
          step('issues').detail = describeError(e);
        }
      } else {
        step('issues').state = 'skipped';
      }

      // 7. Optional command on this computer (e.g. a hosting panel restart call).
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
      if (exportDir) {
        await host.removeBackup(exportDir).catch(() => {});
      }
      run.finished = true;
      // The uploads just made the server match; no need to walk it again.
      await this.refresh({ skipEdits: true });
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
    const backups = await backupsRoot(prefs.value.backupDir);
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
