<script lang="ts">
  import { connection } from '../lib/connection.svelte';
  import { t } from '../lib/i18n';
  import { prefs } from '../lib/prefs.svelte';
  import Splitter from './Splitter.svelte';

  let running = $derived(connection.transfers.filter((x) => x.state === 'running').length);
  let failed = $derived(connection.transfers.filter((x) => x.state === 'failed').length);
  let done = $derived(connection.transfers.filter((x) => x.state === 'done' && !x.skipped).length);
  let skipped = $derived(connection.transfers.filter((x) => x.skipped).length);

  const percent = (offset: number, total: number) => (total > 0 ? Math.min(100, Math.round((offset / total) * 100)) : 0);

  // Follow new rows while the list is scrolled to the bottom; leave it alone
  // when the user scrolled up to look at something.
  let rows: HTMLDivElement;
  let pinned = true;

  function onscroll() {
    pinned = rows.scrollTop + rows.clientHeight >= rows.scrollHeight - 4;
  }

  $effect(() => {
    void connection.transfers.length;
    if (pinned && rows) {
      rows.scrollTop = rows.scrollHeight;
    }
  });
</script>

<Splitter
  axis="y"
  label={t('ui.resize')}
  onMove={(d) => (prefs.value.queueHeight = Math.max(70, Math.min(window.innerHeight - 260, prefs.value.queueHeight - d)))}
  onEnd={() => prefs.persist()}
  onReset={() => prefs.set('queueHeight', 160)}
/>
<section class="queue" style:height="{prefs.value.queueHeight}px">
  <div class="section-label head">
    <span>{t('queue.header', { queued: running, failed, succeeded: done })}{skipped ? ` · ${t('queue.skipped_count', { count: skipped })}` : ''}</span>
    <span class="buttons">
      <button class="control small" disabled={running === 0 && connection.walks === 0} onclick={() => connection.cancelAll()}>{t('queue.cancel_all')}</button>
      <button class="control small" disabled={running === connection.transfers.length} onclick={() => connection.clearFinished()}>
        {t('queue.clear')}
      </button>
    </span>
  </div>
  {#if connection.walks}
    <div class="scanning mono muted">{t('queue.scanning', { count: connection.scanned })}</div>
  {/if}
  <div class="rows" bind:this={rows} {onscroll}>
    {#each connection.transfers as tr (tr.id)}
      {@const pct = percent(tr.offset, tr.total)}
      <div class="row">
        <span class="name mono">{tr.name} → {tr.download ? t('files.local_short') : t('files.remote_short')}</span>
        <div class="bar" aria-hidden="true"><i style:width="{tr.state === 'done' ? 100 : pct}%"></i></div>
        {#if tr.state === 'done' && tr.skipped}
          <span class="state mono muted" title={t('queue.skipped_hint')}>{t('queue.skipped')}</span>
        {:else if tr.state === 'done'}
          <span class="state mono status-new">{t('queue.done')}</span>
        {:else if tr.state === 'failed'}
          <span class="state mono status-removed" title={tr.error}>{t('queue.failed')}</span>
        {:else if tr.state === 'canceled'}
          <span class="state mono muted">{t('queue.canceled')}</span>
        {:else}
          <span class="state mono status-modified">{tr.total > 0 ? `${pct}%` : t('queue.queued')}</span>
        {/if}
        <button
          class="cancel"
          aria-label={t('queue.cancel')}
          title={t('queue.cancel')}
          disabled={tr.state !== 'running'}
          onclick={() => connection.cancel(tr)}>✕</button
        >
      </div>
    {/each}
  </div>
</section>

<style>
  .queue {
    flex: none;
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--line);
  }

  .scanning {
    padding: 6px 14px;
    border-bottom: 1px solid var(--line-row);
    font-size: 11.5px;
    flex: none;
  }

  .rows {
    flex: 1;
    overflow-y: auto;
  }

  .row {
    display: flex;
    gap: 10px;
    align-items: center;
    height: 30px;
    padding: 0 14px;
    border-bottom: 1px solid var(--line-row);
    font-size: 12px;
  }

  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bar {
    width: 150px;
    height: 3px;
    background: var(--line-control);
    flex: none;
  }

  .bar i {
    display: block;
    height: 3px;
    background: var(--selected-mark);
  }

  .state {
    min-width: 58px;
    text-align: right;
    font-size: 11px;
  }

  .cancel {
    width: 22px;
    height: 22px;
    flex: none;
    border: 0;
    border-radius: 3px;
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: 11px;
    cursor: pointer;
  }

  .cancel:hover:not(:disabled) {
    background: var(--selected-bg);
    color: var(--text-strong);
  }

  .cancel:disabled {
    visibility: hidden;
  }
</style>
