<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { connection } from '../lib/connection.svelte';
  import { edits } from '../lib/edits.svelte';
  import { localJoin, splitAddress } from '../lib/files';
  import { t } from '../lib/i18n';
  import { credentialKey, recentLabel } from '../lib/recent';
  import { prefs } from '../lib/prefs.svelte';
  import { ui } from '../lib/ui.svelte';
  import { sites } from '../lib/sites.svelte';
  import { getSecret } from '../lib/secrets';
  import Checkbox from './Checkbox.svelte';
  import Modal from './Modal.svelte';
  import { siteSecretKey, type Site } from '../lib/sites.svelte';
  import type { EngineState } from '../lib/types';
  import LocalPane from './LocalPane.svelte';
  import QueuePanel from './QueuePanel.svelte';
  import Splitter from './Splitter.svelte';
  import RemotePane from './RemotePane.svelte';
  import RequestDialog from './RequestDialog.svelte';
  import SyncBar from './SyncBar.svelte';
  import SyncDialogs from './SyncDialogs.svelte';
  import { sync } from '../lib/sync/engine.svelte';
  import { repo } from '../lib/repo.svelte';
  import { paneAt, paneDrag } from '../lib/panedrag.svelte';
  import { fly } from 'svelte/transition';
  import { ms } from '../lib/motion';
  import { listLocal, localTrash } from '../lib/local';
  import { isTauri } from '@tauri-apps/api/core';
  import { getCurrentWebview } from '@tauri-apps/api/webview';
  import { joinRelative, normalizePath, relativeTo } from '../lib/browsing';
  import { canSyncBrowse } from '../lib/commands.svelte';
  import { twins } from '../lib/twins.svelte';

  let { engine, visible = true }: { engine: EngineState; visible?: boolean } = $props();

  let host = $state('');
  let user = $state('');
  let password = $state('');
  let port = $state('');
  let remember = $state(false);

  let localPath = $state('');
  let panesWidth = $state(0);
  /** Each pane keeps at least 380 px (or half the room in a narrow window). */
  function clampSplit(percent: number): number {
    const min = panesWidth ? Math.min(50, (380 / panesWidth) * 100) : 20;
    return Math.max(min, Math.min(100 - min, percent));
  }
  let localSeparator = $state('/');
  let localPane: LocalPane;

  let passwordInput: HTMLInputElement;

  let connected = $derived(connection.state === 'connected');

  // A server picked in the top bar menu fills the connect bar. The password
  // is kept only if the same server is already typed; otherwise ask for it.
  $effect(() => {
    const p = connection.picked;
    if (!p) {
      return;
    }
    connection.picked = null;
    untrack(() => {
      const nextHost = p.protocol === 'sftp' ? p.host : `${p.protocol}://${p.host}`;
      const nextPort = p.port ? String(p.port) : '';
      const same = host.trim() === nextHost && user.trim() === p.user && port.trim() === nextPort;
      host = nextHost;
      user = p.user;
      port = nextPort;
      if (!same) {
        password = '';
      }
      remember = !!p.remember;
      void fillAndConnect(p.remember ? credentialKey(p) : null);
    });
  });

  // A saved site picked in the top bar or the Site Manager.
  let sitePrompt = $state<Site | null>(null);
  let sitePassword = $state('');

  $effect(() => {
    const p = connection.pickedSite;
    if (!p) {
      return;
    }
    connection.pickedSite = null;
    untrack(() => void connectToSite(p.site, p.password));
  });

  async function connectToSite(site: Site, typed?: string) {
    if (connection.state === 'connected') {
      await connection.disconnect();
    }
    let pw = typed ?? '';
    if (!pw && site.logon === 'normal' && site.savedPassword) {
      pw = (await getSecret(siteSecretKey(site)).catch(() => null)) ?? '';
    }
    if (site.logon === 'ask' || (site.logon === 'normal' && !pw)) {
      sitePassword = '';
      sitePrompt = site;
      return;
    }
    await connection.connectSite(site, pw);
  }

  $effect(() => {
    const dir = connection.localDirRequest;
    if (dir) {
      connection.localDirRequest = null;
      void localPane?.load(dir);
    }
  });

  /** Uses the stored password if there is one, otherwise the typed one, otherwise asks for it. */
  async function fillAndConnect(key: string | null) {
    if (key) {
      try {
        const stored = await getSecret(key);
        if (stored !== null) {
          password = stored;
        } else {
          remember = false;
        }
      } catch {
        remember = false;
      }
    }
    if (password) {
      void connection.connect({ host, user, password, port, remember });
    } else {
      // The password goes into the connect bar, so show it.
      ui.tab = 'files';
      await tick();
      passwordInput?.focus();
    }
  }
  let busy = $derived(connection.state === 'connecting');

  // With an empty connect bar, Connect becomes Reconnect to the last server.
  let lastTarget = $derived.by(() => {
    const last = prefs.value.lastConnection;
    if (last?.type === 'site') {
      const site = sites.list.find((s) => s.id === last.id);
      return site ? { label: `${site.name} (${site.host})`, site, recent: null } : null;
    }
    const recent = connection.recent[0];
    return recent ? { label: recentLabel(recent, false, ''), site: null, recent } : null;
  });

  function reconnect() {
    const target = lastTarget;
    if (target?.site) {
      connection.pickedSite = { site: target.site };
    } else if (target?.recent) {
      void connection.pick(target.recent);
    }
  }

  let editDontAsk = $state(false);

  // Edited temp files stop syncing back once the session is gone.
  $effect(() => {
    if (connection.state === 'disconnected') {
      void untrack(() => edits.stopAll());
    }
  });

  // The first time both panes show folders with the same name, ask once
  // whether to tint them; any answer (closing the dialog too) is final, and
  // Preferences → File lists changes it later.
  let twinExample = $state<string | null>(null);
  let twinBrowse = $state(false);
  $effect(() => {
    if (prefs.value.twinsAsked || prefs.value.markTwins || twinExample !== null) {
      return;
    }
    const remote = new Set(twins.remote);
    const same = twins.local.find((n) => remote.has(n));
    if (same) {
      twinExample = same;
      twinBrowse = false;
    }
  });

  function answerTwins(tint: boolean, browse: boolean) {
    twinExample = null;
    prefs.value.markTwins = tint;
    prefs.value.twinsAsked = true;
    void prefs.persist();
    if (browse) {
      ui.syncBrowse = true;
    }
  }

  /**
   * Whether the other side may have `target`: a folder one level below the
   * one it shows must be in its list (no request for a folder that is not
   * there); anything else is tried quietly.
   */
  function mayExist(target: string, shown: string, names: string[]): boolean {
    const t = normalizePath(target);
    const cut = t.lastIndexOf('/');
    const parent = cut <= 0 ? '/' : t.slice(0, cut);
    const name = target.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '';
    return parent !== normalizePath(shown) || names.includes(name);
  }

  // Synchronized browsing: a folder opened on one side opens the same folder,
  // relative to the site's local folder and server folder, on the other.
  let seenLocal = '';
  let seenRemote = '';
  $effect(() => {
    const lp = localPath;
    const rp = connection.remotePath;
    const on = ui.syncBrowse && canSyncBrowse() && !!connection.siteRoot;
    untrack(() => {
      const localMoved = normalizePath(lp) !== normalizePath(seenLocal);
      const remoteMoved = normalizePath(rp) !== normalizePath(seenRemote);
      seenLocal = lp;
      seenRemote = rp;
      const localRoot = connection.site?.localDir.trim() ?? '';
      if (!on || !lp || !rp) {
        return;
      }
      if (localMoved) {
        const rel = relativeTo(localRoot, lp);
        const target = rel === null ? null : joinRelative(connection.siteRoot, rel, '/');
        if (target && normalizePath(target) !== normalizePath(rp) && mayExist(target, rp, twins.remote)) {
          seenRemote = target;
          void connection.list(target, true);
        }
      } else if (remoteMoved) {
        const rel = relativeTo(connection.siteRoot, rp);
        const target = rel === null ? null : joinRelative(localRoot, rel, localSeparator);
        if (target && normalizePath(target) !== normalizePath(lp) && mayExist(target, lp, twins.local)) {
          seenLocal = target;
          void localPane?.load(target, true);
        }
      }
    });
  });

  // Sites with a local repository get their server compared on connect.
  $effect(() => {
    const ready = connection.state === 'connected' && !!connection.site?.localDir.trim();
    untrack(() => (ready ? void sync.refresh() : sync.reset()));
  });

  // A commit or pull in the GitHub tab: the local files and the local commit
  // in the sync bar are out of date (the server side is not, so no walk).
  $effect(() => {
    if (!repo.changed) {
      return;
    }
    untrack(() => {
      localPane?.refresh();
      const dir = connection.site?.localDir.trim().toLowerCase();
      if (sync.active && dir === repo.dir.toLowerCase() && !sync.run && !sync.preparing) {
        void sync.refresh({ skipEdits: true });
      }
    });
  });

  // Move (Shift while dragging): the source is removed only after its
  // transfer finished completely; anything skipped, failed or canceled stays.
  async function moveUp(items: { name: string; local: string; dir: boolean }[]) {
    const target = connection.remotePath;
    const done = await Promise.all(
      items.map(async (f) =>
        f.dir
          ? connection.uploadFolder(f.local, localSeparator, f.name, target)
          : connection
              .transfer(false, f.name, { local: f.local, remote_path: target, remote_name: f.name })
              .then((tr) => tr.state === 'done' && !tr.skipped),
      ),
    );
    const moved = items.filter((_, i) => done[i]).map((f) => f.local);
    if (moved.length) {
      await localTrash(moved).catch((e) => (connection.message = { level: 'error', text: String(e) }));
      localPane?.refresh();
    }
  }

  async function moveDown(items: { name: string; remotePath: string; dir: boolean }[]) {
    const target = localPath;
    const done = await Promise.all(
      items.map(async (f) =>
        f.dir
          ? connection.downloadFolder(f.remotePath, f.name, target, localSeparator)
          : connection
              .transfer(true, f.name, { remote_path: f.remotePath, remote_name: f.name, local: localJoin(target, f.name, localSeparator) })
              .then((tr) => tr.state === 'done' && !tr.skipped),
      ),
    );
    const moved = connection.remoteRows.filter((r) => items.some((f, i) => done[i] && f.name === r.name));
    if (moved.length) {
      await connection.deleteRemote(moved);
    }
    localPane?.refresh();
  }

  /** Files or folders dropped from the system file manager onto the server pane. */
  async function uploadPaths(paths: string[]) {
    const items = [];
    for (const p of paths) {
      const name = p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;
      const dir = await listLocal(p).then(
        () => true,
        () => false,
      );
      items.push({ name, local: p, dir });
    }
    upload(items);
  }

  onMount(() => {
    // Rows dragged from one pane to the other transfer like the buttons do.
    paneDrag.onDrop = (from, rows, move) => {
      if (from === 'local' && connected) {
        const items = rows.map((r) => ({ name: r.name, local: localJoin(localPath, r.name, localSeparator), dir: r.dir }));
        if (move) {
          void moveUp(items);
        } else {
          upload(items);
        }
      } else if (from === 'server') {
        const items = rows.map((r) => ({ name: r.name, remotePath: connection.remotePath, dir: r.dir }));
        if (move) {
          void moveDown(items);
        } else {
          download(items);
        }
      }
    };
    // Files dragged in from the system: positions come in physical pixels.
    let stopDrop = () => {};
    if (isTauri()) {
      void getCurrentWebview()
        .onDragDropEvent((event) => {
          const p = event.payload;
          const dpr = window.devicePixelRatio || 1;
          if (p.type === 'enter' || p.type === 'over') {
            paneDrag.external = true;
            paneDrag.over = paneAt(p.position.x / dpr, p.position.y / dpr);
          } else if (p.type === 'drop') {
            const side = paneAt(p.position.x / dpr, p.position.y / dpr);
            paneDrag.external = false;
            paneDrag.over = null;
            if (side === 'server' && connected && visible) {
              void uploadPaths(p.paths);
            }
          } else {
            paneDrag.external = false;
            paneDrag.over = null;
          }
        })
        .then((un) => (stopDrop = un));
    }
    connection.start();
    edits.start();
    connection.onTransferDone = (tr) => {
      // Refresh once a batch (e.g. a folder) is through, not after every file.
      if (tr.state !== 'done' || connection.transfers.some((x) => x.state === 'running')) {
        return;
      }
      if (tr.download) {
        localPane?.refresh();
      } else {
        void connection.list(connection.remotePath);
      }
    };
    return () => {
      connection.onTransferDone = null;
      paneDrag.onDrop = null;
      stopDrop();
    };
  });

  // "host:port" or "user@host" pasted into the host field: the port and the
  // user move to their own fields; the protocol prefix stays in the host.
  function tidyHost() {
    const a = splitAddress(host);
    if (!a || (!a.port && !a.user)) {
      return;
    }
    host = a.protocol ? `${a.protocol}://${a.host}` : a.host;
    if (a.port) {
      port = String(a.port);
    }
    if (a.user && !user.trim()) {
      user = a.user;
    }
  }

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (connected) {
      void connection.disconnect();
    } else {
      void connection.connect({ host, user, password, port, remember });
    }
  }

  function upload(items: { name: string; local: string; dir: boolean }[]) {
    const target = connection.remotePath;
    for (const f of items) {
      if (f.dir) {
        void connection.uploadFolder(f.local, localSeparator, f.name, target);
      } else {
        void connection.transfer(false, f.name, { local: f.local, remote_path: target, remote_name: f.name });
      }
    }
  }

  function download(items: { name: string; remotePath: string; dir: boolean }[]) {
    const target = localPath;
    for (const f of items) {
      if (f.dir) {
        void connection.downloadFolder(f.remotePath, f.name, target, localSeparator);
      } else {
        void connection.transfer(true, f.name, {
          remote_path: f.remotePath,
          remote_name: f.name,
          local: localJoin(target, f.name, localSeparator),
        });
      }
    }
  }
</script>

<div class="view" class:hidden={!visible}>
<form class="connect" onsubmit={submit}>
  <input class="field mono host" placeholder={t('files.connect.host')} aria-label={t('files.connect.host')} disabled={connected || busy} bind:value={host} onblur={tidyHost} onpaste={() => setTimeout(tidyHost)} />
  <input class="field mono user" placeholder={t('files.connect.user')} aria-label={t('files.connect.user')} disabled={connected || busy} bind:value={user} />
  <input
    class="field mono password"
    type="password"
    placeholder={t('files.connect.password')}
    aria-label={t('files.connect.password')}
    disabled={connected || busy}
    bind:this={passwordInput}
    bind:value={password}
  />
  <input
    class="field mono port"
    inputmode="numeric"
    placeholder={t('files.connect.port')}
    aria-label={t('files.connect.port')}
    disabled={connected || busy}
    bind:value={port}
  />
  <Checkbox bind:checked={remember} label={t('files.connect.remember')} title={t('files.connect.remember_hint')} disabled={connected || busy} />
  {#if connected}
    <button class="control" type="submit">{t('common.disconnect')}</button>
  {:else if lastTarget && !host.trim() && !busy}
    <button class="control primary" type="button" disabled={engine !== 'ready'} title={lastTarget.label} onclick={reconnect}>
      {t('files.reconnect')}
    </button>
  {:else}
    <button class="control primary" type="submit" disabled={engine !== 'ready' || busy || !host.trim()}>
      {busy ? t('status.connecting') : t('common.connect')}
    </button>
  {/if}
  {#if connection.error || edits.error}
    <span class="error status-removed" title={connection.error || edits.error}>{connection.error || edits.error}</span>
  {/if}
</form>

<SyncBar />

<div class="panes" bind:clientWidth={panesWidth} style:--split="{prefs.value.paneSplit}%">
  <LocalPane bind:this={localPane} bind:path={localPath} bind:separator={localSeparator} canUpload={connected} onUpload={upload} />
  <Splitter
    axis="x"
    label={t('ui.resize')}
    onMove={(d) => (prefs.value.paneSplit = clampSplit(prefs.value.paneSplit + (d / Math.max(1, panesWidth)) * 100))}
    onEnd={() => prefs.persist()}
    onReset={() => prefs.set('paneSplit', 50)}
  />
  <RemotePane onDownload={download} />
</div>

{#if (connection.transfers.length || connection.walks) && (!ui.log || prefs.value.queueWithLog)}
  <QueuePanel />
{/if}
</div>

{#if paneDrag.active}
  {@const d = paneDrag.active}
  <div class="drag-ghost mono" style:left="{d.x + 14}px" style:top="{d.y + 12}px">
    {#key d.move}<span class="drag-mode" in:fly={{ y: d.move ? -6 : 6, duration: ms(140) }}>{d.move ? t('files.drag_move') : t('files.drag_copy')}</span>{/key}
    <!-- The slash tells which side the rows come from: "/" server, the local separator. -->
    {d.rows.length === 1
      ? `${d.from === 'server' || prefs.value.forwardSlashes ? '/' : localSeparator}${d.rows[0].name}`
      : t('files.drag_count', { count: d.rows.length })}
  </div>
{/if}

<RequestDialog />
<SyncDialogs />

{#if edits.asking.length}
  {@const f = edits.asking[0]}
  <Modal title={t('edit.saved.title')} onCancel={() => edits.answer(false, false)}>
    <p>{t('edit.saved.body', { name: f.name })}</p>
    <p class="mono muted">{edits.remoteName(f)}</p>
    <Checkbox bind:checked={editDontAsk} label={t('edit.saved.dont_ask')} />
    {#snippet actions()}
      <button class="control" onclick={() => edits.answer(false, editDontAsk)}>{t('edit.saved.not_now')}</button>
      <button class="control primary" onclick={() => edits.answer(true, editDontAsk)}>{t('edit.saved.upload')}</button>
    {/snippet}
  </Modal>
{/if}

{#if twinExample !== null}
  <Modal title={t('twins.title')} onCancel={() => answerTwins(false, false)}>
    <p>{t('twins.body', { name: twinExample })}</p>
    {#if canSyncBrowse()}
      <Checkbox bind:checked={twinBrowse} label={t('twins.browse')} />
    {/if}
    <p class="muted">{t('twins.later')}</p>
    {#snippet actions()}
      <button class="control" onclick={() => answerTwins(false, twinBrowse)}>{t('twins.no')}</button>
      <button class="control primary" onclick={() => answerTwins(true, twinBrowse)}>{t('twins.yes')}</button>
    {/snippet}
  </Modal>
{/if}

{#if sitePrompt}
  {@const s = sitePrompt}
  <Modal title={t('dialog.password.title')} onCancel={() => (sitePrompt = null)}>
    <form id="site-password" onsubmit={(e) => (e.preventDefault(), (sitePrompt = null), connection.connectSite(s, sitePassword))}>
      <p class="mono">{s.name} · {s.user ? `${s.user}@` : ''}{s.host}</p>
      <input class="field mono site-password" type="password" aria-label={t('files.connect.password')} bind:value={sitePassword} />
    </form>
    {#snippet actions()}
      <button class="control" onclick={() => (sitePrompt = null)}>{t('common.cancel')}</button>
      <button class="control primary" type="submit" form="site-password">{t('common.connect')}</button>
    {/snippet}
  </Modal>
{/if}

<style>
  .drag-ghost {
    position: fixed;
    z-index: 20;
    padding: 3px 8px;
    border: 1px solid var(--line-control);
    border-radius: 4px;
    background: var(--panel);
    color: var(--text-strong);
    font-size: 12px;
    pointer-events: none;
    white-space: nowrap;
  }

  .drag-mode {
    display: inline-block;
    margin-right: 6px;
    color: var(--muted);
  }

  /* A box (not display: contents) so switching tabs can fade it in. */
  .view {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    animation: fade-in var(--motion) ease-out;
  }

  .view.hidden {
    display: none;
  }

  .connect {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 16px;
    border-bottom: 1px solid var(--line);
    flex: none;
  }

  .host {
    width: 200px;
  }

  .user {
    width: 120px;
  }

  .password {
    width: 140px;
  }

  .port {
    width: 70px;
  }

  .error {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
  }

  .site-password {
    width: 100%;
  }

  .panes {
    flex: 1;
    display: flex;
    min-height: 0;
  }

  .panes > :global(.pane:first-child) {
    flex: 0 0 var(--split);
  }
</style>
