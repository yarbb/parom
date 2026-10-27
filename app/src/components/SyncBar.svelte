<script lang="ts">
  import { connection } from '../lib/connection.svelte';
  import { t } from '../lib/i18n';
  import { sync } from '../lib/sync/engine.svelte';
  import BackupsDialog from './BackupsDialog.svelte';

  // One line under the connect bar for sites with a local repository:
  // target folder, server and local commit, state, and "Sync with server".
  let backups = $state(false);

  const short = (sha: string | null | undefined) => (sha ? sha.slice(0, 7) : '–');

  let c = $derived(sync.check);
  let busy = $derived(sync.checking || sync.preparing || !!sync.run);
  let stateText = $derived.by(() => {
    if (!c) {
      return '';
    }
    const edits = c.edits.edited.length + c.edits.missing.length;
    const base =
      c.state === 'up-to-date'
        ? t('sync.state.up_to_date')
        : c.state === 'behind'
          ? t('sync.state.behind', { count: c.behind })
          : t(`sync.state.${c.state.replace('-', '_')}`);
    return edits ? `${base} · ${t('sync.edited_on_server', { count: edits })}` : base;
  });
  let warn = $derived(!!c && (c.state === 'diverged' || c.state === 'unknown-commit' || c.edits.edited.length + c.edits.missing.length > 0));
  let activity = $derived(
    sync.preparing ? t('sync.preparing', { progress: sync.progress }) : sync.checking ? t('sync.checking_progress', { progress: sync.progress }) : '',
  );
</script>

{#if sync.active}
  <div class="bar">
    <div class="info">
      {#if c}
        <span class="mono item" title={c.root}><span class="muted">{t('sync.target')}</span> {c.root}</span>
        <span class="mono item"><span class="muted">{t('sync.server')}</span> {short(c.marker?.sha)}</span>
        <span class="mono item"><span class="muted">{t('sync.local')}</span> {short(c.repo.head)}</span>
        <span class="item" class:status-modified={warn} class:status-new={c.state === 'up-to-date' && !warn}>{stateText}</span>
        {#if c.dirtyManaged.length}
          <span class="status-modified item cut" title={c.dirtyManaged.join('\n')}>
            {t('sync.uncommitted', { count: c.dirtyManaged.length })}: {c.dirtyManaged.join(', ')}
          </span>
        {/if}
      {/if}
      {#if activity}
        <span class="muted item">{activity}</span>
      {:else if sync.error}
        <span class="status-removed item cut" title={sync.error}>{sync.error}</span>
      {/if}
    </div>
    <div class="buttons">
      <button class="control small" onclick={() => (backups = true)}>{t('backups.button')}</button>
      <button class="control small" disabled={busy} onclick={() => sync.refresh()}>{t('sync.check')}</button>
      {#if sync.preparing || sync.checking}
        <button class="control small primary" onclick={() => sync.stopWalk()}>{t(sync.preparing ? 'sync.cancel_sync' : 'sync.cancel_check')}</button>
      {:else}
        <button class="control small primary" disabled={!c || busy || connection.state !== 'connected'} onclick={() => (sync.choosing = true)}>
          {t('sync.sync_with_server')}
        </button>
      {/if}
    </div>
  </div>
{/if}

{#if backups}
  <BackupsDialog onClose={() => (backups = false)} />
{/if}

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 6px 16px;
    border-bottom: 1px solid var(--line);
    font-size: 12px;
    flex: none;
  }

  .info {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 14px;
    overflow: hidden;
  }

  .item {
    white-space: nowrap;
    flex: none;
  }

  .item.cut {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .buttons {
    display: flex;
    gap: 6px;
    flex: none;
  }

  .buttons button {
    white-space: nowrap;
  }
</style>
