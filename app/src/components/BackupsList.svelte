<script lang="ts">
  import { untrack } from 'svelte';
  import { connection } from '../lib/connection.svelte';
  import { call } from '../lib/daemon';
  import { formatSize, formatTime, remoteJoin } from '../lib/files';
  import { t } from '../lib/i18n';
  import { listLocal, openInEditor } from '../lib/local';
  import { prefs } from '../lib/prefs.svelte';
  import { sync } from '../lib/sync/engine.svelte';
  import { backupsRoot, host, joinLocal } from '../lib/sync/host';
  import type { Site } from '../lib/sites.svelte';
  import Modal from './Modal.svelte';

  // Board Bk: backups of a site, kept on this computer. Restoring needs a
  // connection to that site; the list works without one.
  let { site, onRestore }: { site: Site; onRestore?: () => void } = $props();

  interface Backup {
    dir: string;
    when: string;
    sha: string | null;
    reason: string;
    root: string;
    files: string[];
    size: number;
  }

  let list = $state<Backup[]>([]);
  let folder = $state('');
  let loading = $state(true);
  let error = $state('');
  let confirm = $state<{ kind: 'restore' | 'delete'; backup: Backup } | null>(null);

  async function load() {
    loading = true;
    error = '';
    try {
      folder = joinLocal(await backupsRoot(prefs.value.backupDir), site.id);
      const listing = await listLocal(folder).catch(() => null);
      const out: Backup[] = [];
      for (const row of listing?.rows.filter((r) => r.dir) ?? []) {
        const dir = joinLocal(folder, row.name);
        try {
          const meta = JSON.parse(await host.readSmall(joinLocal(dir, 'backup.json')));
          out.push({ dir, when: meta.when, sha: meta.sha, reason: meta.reason, root: meta.root, files: meta.files ?? [], size: await host.dirSize(dir) });
        } catch {
          // Not one of ours (or damaged); leave it alone.
        }
      }
      list = out.sort((a, b) => (a.when < b.when ? 1 : -1));
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void site.id;
    untrack(() => void load());
  });

  let connected = $derived(connection.state === 'connected' && connection.site?.id === site.id);

  async function restore(b: Backup) {
    confirm = null;
    onRestore?.();
    // Uploads go through the queue, so progress and errors show there.
    const folders = [...new Set(b.files.map((p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')).filter(Boolean))];
    for (const f of folders.sort((x, y) => x.length - y.length)) {
      await call('remote.mkdir', { session: connection.session, path: remoteJoin(b.root, f) }).catch(() => {});
    }
    await Promise.all(
      b.files.map((p) => {
        const i = p.lastIndexOf('/');
        return connection.transfer(false, p, {
          local: joinLocal(b.dir, p),
          remote_path: i < 0 ? b.root : remoteJoin(b.root, p.slice(0, i)),
          remote_name: p.slice(i + 1),
          exists: 'overwrite',
        });
      }),
    );
    await sync.refresh();
  }

  async function remove(b: Backup) {
    confirm = null;
    await host.removeBackup(b.dir).catch((e) => (error = String(e)));
    await load();
  }
</script>

<div class="backups">
  <!-- A backup without a sync: everything the site syncs, as it is on the server now. -->
  <div class="now">
    <div>
      <div class="now-title">{t('backups.now_title')}</div>
      <div class="muted small">{t('backups.now_body', { root: connected ? connection.siteRoot || '/' : site.remoteDir || '/' })}</div>
    </div>
    {#if sync.backingUp}
      <button class="control" onclick={() => sync.stopWalk()}>{t('backups.now_cancel', { progress: sync.progress })}</button>
    {:else}
      <button
        class="control primary"
        disabled={!connected || !sync.active || sync.preparing || !!sync.run}
        title={connected ? '' : t('backups.connect_first', { server: site.name })}
        onclick={async () => (await sync.backupNow()) && load()}
      >
        {t('backups.now_button')}
      </button>
    {/if}
  </div>
  <p class="muted">{t('backups.keep', { count: prefs.value.backupKeep })}</p>
  {#if loading}
    <p class="muted">{t('files.loading')}</p>
  {:else if list.length === 0}
    <p class="muted">{t('backups.empty')}</p>
  {:else}
    <ul class="list">
      {#each list as b (b.dir)}
        <li>
          <span class="mono when">{formatTime(Date.parse(b.when), Date.now(), true)}</span>
          <span class="mono">{b.sha ? b.sha.slice(0, 7) : '–'}</span>
          <span class="mono muted">{t('backups.files', { count: b.files.length })} · {formatSize(b.size)}</span>
          <span class="spacer"></span>
          <button
            class="control small"
            disabled={!connected}
            title={connected ? '' : t('backups.connect_first', { server: site.name })}
            onclick={() => (confirm = { kind: 'restore', backup: b })}
          >
            {t('backups.restore')}
          </button>
          <button class="control small" onclick={() => openInEditor(b.dir, '')}>{t('backups.open')}</button>
          <button class="control small" onclick={() => (confirm = { kind: 'delete', backup: b })}>{t('common.remove')}</button>
        </li>
      {/each}
    </ul>
  {/if}
  {#if error}<p class="status-removed">{error}</p>{/if}
  <p class="muted mono where">{folder}</p>
</div>

{#if confirm}
  {@const c = confirm}
  <Modal title={c.kind === 'restore' ? t('backups.restore_title') : t('backups.delete_title')} onCancel={() => (confirm = null)}>
    <p>
      {c.kind === 'restore'
        ? t('backups.restore_body', { count: c.backup.files.length, root: c.backup.root })
        : t('backups.delete_body')}
    </p>
    {#snippet actions()}
      <button class="control" onclick={() => (confirm = null)}>{t('common.cancel')}</button>
      <button class="control primary" onclick={() => (c.kind === 'restore' ? restore(c.backup) : remove(c.backup))}>
        {c.kind === 'restore' ? t('backups.restore') : t('common.remove')}
      </button>
    {/snippet}
  </Modal>
{/if}

<style>
  p {
    margin: 0 0 10px;
  }

  .now {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 14px;
    padding: 12px 14px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--panel);
  }

  .now-title {
    margin-bottom: 2px;
    color: var(--text-strong);
    font-weight: 600;
  }

  .small {
    font-size: 11.5px;
  }

  .list {
    margin: 0 0 10px;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 0;
    border-bottom: 1px solid var(--line-row);
    font-size: 12px;
  }

  .spacer {
    flex: 1;
  }

  .where {
    font-size: 11px;
    word-break: break-all;
  }
</style>
