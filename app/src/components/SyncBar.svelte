<script lang="ts">
  import { connection } from '../lib/connection.svelte';
  import { t } from '../lib/i18n';
  import { sync } from '../lib/sync/engine.svelte';
  import BackupsDialog from './BackupsDialog.svelte';

  let backups = $state(false);

  // One line under the connect bar for sites with a local repository:
  // server commit, local commit, state, and "Sync with server".
  const short = (sha: string | null | undefined) => (sha ? sha.slice(0, 7) : '–');

  let c = $derived(sync.check);
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
</script>

{#if sync.active}
  <div class="bar">
    {#if sync.checking && !c}
      <span class="muted">{t('sync.checking')}</span>
    {:else if c}
      <span class="mono"><span class="muted">{t('sync.server')}</span> {short(c.marker?.sha)}</span>
      <span class="mono"><span class="muted">{t('sync.local')}</span> {short(c.repo.head)}</span>
      <span class:status-modified={warn} class:status-new={c.state === 'up-to-date' && !warn}>{stateText}</span>
      {#if c.dirtyManaged.length}
        <span class="status-modified" title={c.dirtyManaged.join('\n')}>{t('sync.uncommitted', { count: c.dirtyManaged.length })}</span>
      {/if}
    {:else if sync.error}
      <span class="status-removed" title={sync.error}>{sync.error}</span>
    {/if}
    <span class="spacer"></span>
    {#if sync.error && c}<span class="status-removed err" title={sync.error}>{sync.error}</span>{/if}
    <button class="control small" onclick={() => (backups = true)}>{t('backups.button')}</button>
    <button class="control small" disabled={sync.checking || !!sync.run} onclick={() => sync.refresh()}>{t('sync.check')}</button>
    <button
      class="control small primary"
      disabled={!c || sync.checking || !!sync.run || connection.state !== 'connected'}
      onclick={() => sync.start()}>{t('sync.sync_with_server')}</button
    >
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

  .spacer {
    flex: 1;
  }

  .err {
    max-width: 40%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
