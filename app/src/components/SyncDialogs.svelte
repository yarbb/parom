<script lang="ts">
  import { connection } from '../lib/connection.svelte';
  import { t } from '../lib/i18n';
  import { sync } from '../lib/sync/engine.svelte';
  import { markerName } from '../lib/sync/marker';
  import Checkbox from './Checkbox.svelte';
  import Modal from './Modal.svelte';
  import SyncPreview from './SyncPreview.svelte';

  // Boards Dm (track sync state?), the direction choice, the preview (Ds) and Dp (syncing).
  let rememberChoice = $state(true);


  async function markerAnswer(choice: 'create' | 'not_now' | 'never') {
    sync.offerMarker = false;
    if (choice === 'never') {
      await sync.setSiteMarker('off');
    } else if (choice === 'create') {
      if (rememberChoice) {
        await sync.setSiteMarker('on');
      }
      await sync.createMarker();
    }
  }

  const stepLabel = (key: string) => t(`sync.step.${key}`);
  const mark = (state: string) => (state === 'done' ? '✓' : state === 'running' ? '●' : state === 'failed' ? '✕' : state === 'skipped' ? '–' : '○');
</script>

{#if sync.offerMarker && sync.check}
  {@const c = sync.check}
  <Modal title={t('sync.marker.title', { server: c.site.name })} onCancel={() => markerAnswer('not_now')}>
    <p>{t('sync.marker.body', { path: `${c.root.replace(/\/$/, '')}/${markerName}` })}</p>
    <pre class="mono preview">totzilla 1
repo   {c.site.repo || '–'}
commit {t('sync.marker.after_first_sync')}
by     {t('sync.marker.you')}
lock   –</pre>
    <Checkbox bind:checked={rememberChoice} label={t('sync.marker.remember')} />
    {#snippet actions()}
      <button class="control" onclick={() => markerAnswer('not_now')}>{t('sync.marker.not_now')}</button>
      <button class="control" onclick={() => markerAnswer('never')}>{t('sync.marker.never')}</button>
      <button class="control primary" onclick={() => markerAnswer('create')}>{t('sync.marker.create')}</button>
    {/snippet}
  </Modal>
{/if}

{#if sync.choosing && sync.check}
  <Modal title={t('sync.choose.title', { server: sync.check.site.name })} onCancel={() => (sync.choosing = false)}>
    <div class="choices">
      <button class="choice" onclick={() => ((sync.choosing = false), sync.start())}>
        <b>{t('sync.choose.deploy')}</b>
        <span class="muted">{t('sync.choose.deploy_body')}</span>
      </button>
      <button class="choice" onclick={() => sync.startPull()}>
        <b>{t('sync.choose.pull')}</b>
        <span class="muted">{t('sync.choose.pull_body')}</span>
      </button>
    </div>
    {#snippet actions()}
      <button class="control" onclick={() => (sync.choosing = false)}>{t('common.cancel')}</button>
    {/snippet}
  </Modal>
{/if}

{#if sync.preview}
  <SyncPreview preview={sync.preview} />
{/if}

{#if sync.run}
  {@const run = sync.run}
  <Modal title={t('sync.progress.title', { server: connection.site?.name ?? '' })} onCancel={() => (run.finished ? sync.closeRun() : sync.cancel())}>
    <ul class="steps">
      {#each run.steps as s (s.key)}
        <li class:status-new={s.state === 'done'} class:status-removed={s.state === 'failed'} class:muted={s.state === 'pending' || s.state === 'skipped'}>
          <span class="mark mono">{mark(s.state)}</span>
          {stepLabel(s.key)}
          {#if s.key === 'upload' && run.total}<span class="mono"> {run.done} / {run.total}</span>{/if}
          {#if s.detail}<span class="mono muted"> · {s.detail}</span>{/if}
        </li>
      {/each}
    </ul>
    {#if run.current}<p class="mono muted current">{run.current}</p>{/if}
    {#if run.error}<p class="status-removed">{run.error}</p>{/if}
    {#if run.commandOutput}<pre class="mono output">{run.commandOutput}</pre>{/if}
    {#snippet actions()}
      {#if run.finished}
        <button class="control primary" onclick={() => sync.closeRun()}>{t('common.ok')}</button>
      {:else}
        <button class="control" disabled={run.canceled} onclick={() => sync.cancel()}>{t('common.cancel')}</button>
      {/if}
    {/snippet}
  </Modal>
{/if}

<style>
  p {
    margin: 0 0 10px;
  }

  .preview,
  .output {
    margin: 0 0 12px;
    padding: 10px 12px;
    border: 1px solid var(--line-control);
    border-radius: 4px;
    background: var(--bg);
    font-size: 11.5px;
    white-space: pre-wrap;
    word-break: break-all;
  }

  .output {
    max-height: 120px;
    overflow: auto;
  }

  .choices {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .choice {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 10px 12px;
    border: 1px solid var(--line-control);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .choice:hover {
    border-color: var(--selected-mark);
  }

  .choice b {
    color: var(--text-strong);
  }

  .steps {
    margin: 0 0 10px;
    padding: 0;
    list-style: none;
  }

  .steps li {
    padding: 3px 0;
  }

  .mark {
    display: inline-block;
    width: 18px;
  }

  .current {
    word-break: break-all;
    font-size: 11.5px;
  }
</style>
