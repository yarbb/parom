<script lang="ts">
  import { connection } from '../lib/connection.svelte';
  import { formatTime } from '../lib/files';
  import { t } from '../lib/i18n';
  import { sync } from '../lib/sync/engine.svelte';
  import { markerName } from '../lib/sync/marker';
  import Checkbox from './Checkbox.svelte';
  import Modal from './Modal.svelte';

  // Boards Dm (track sync state?), Ds (versions differ) and Dp (syncing).
  let rememberChoice = $state(true);
  let backup = $state(true);
  let showDiff = $state(false);

  $effect(() => {
    if (sync.confirming) {
      backup = sync.confirming.backup;
      showDiff = false;
    }
  });

  const short = (sha: string | null | undefined) => (sha ? sha.slice(0, 7) : '–');
  const when = (iso: string | undefined) => (iso ? formatTime(Date.parse(iso), Date.now(), true) : '');

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

{#if sync.confirming && sync.check}
  {@const c = sync.check}
  {@const plan = sync.confirming.plan}
  {@const editedCount = c.edits.edited.length + c.edits.missing.length}
  <Modal title={t('sync.versions_differ')} onCancel={() => (sync.confirming = null)}>
    <p>{t('sync.differ.body')}</p>
    <dl class="versions">
      <dt>{t('sync.server')}</dt>
      <dd class="mono">{short(c.marker?.sha)}{c.marker?.who ? ` · ${t('sync.differ.synced_by', { who: c.marker.who })}` : ''}{c.marker?.when ? ` · ${when(c.marker.when)}` : ''}</dd>
      <dt>{t('sync.local')}</dt>
      <dd class="mono">{short(c.repo.head)}{c.repo.head_time ? ` · ${when(new Date(c.repo.head_time * 1000).toISOString())}` : ''}</dd>
    </dl>
    <p class="counts">
      <span>{t('sync.differ.upload', { count: plan.upload.length })}</span>
      {#if plan.removedInRepo.length}<span class="status-removed">{t('sync.differ.removed', { count: plan.removedInRepo.length })}</span>{/if}
      {#if editedCount}<span class="status-modified">{t('sync.edited_on_server', { count: editedCount })}</span>{/if}
      {#if plan.protectedSkipped.length}<span class="muted">{t('sync.differ.protected', { count: plan.protectedSkipped.length })}</span>{/if}
    </p>
    {#if showDiff}
      <ul class="mono files">
        {#each c.edits.edited as p (p)}<li class="status-modified">{t('sync.differ.tag_edited')} {p}</li>{/each}
        {#each c.edits.missing as p (p)}<li class="status-modified">{t('sync.differ.tag_missing')} {p}</li>{/each}
        {#each plan.upload as p (p)}<li>↑ {p}</li>{/each}
        {#each plan.removedInRepo as p (p)}<li class="status-removed">{t('sync.differ.tag_removed')} {p}</li>{/each}
        {#each plan.protectedSkipped as p (p)}<li class="muted">{t('sync.differ.tag_protected')} {p}</li>{/each}
      </ul>
    {/if}
    <Checkbox bind:checked={backup} label={t('sync.backup_first')} />
    {#snippet actions()}
      <button class="control" onclick={() => (sync.confirming = null)}>{t('common.cancel')}</button>
      <button class="control" onclick={() => (showDiff = !showDiff)}>{t('sync.show_differences')}</button>
      <button class="control primary" onclick={() => sync.confirming && sync.execute(sync.confirming.plan, backup)}>{t('sync.sync_anyway')}</button>
    {/snippet}
  </Modal>
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

  .versions {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 4px 12px;
    margin: 0 0 10px;
  }

  dt {
    color: var(--muted);
  }

  dd {
    margin: 0;
  }

  .counts {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
  }

  .files {
    max-height: 180px;
    overflow: auto;
    margin: 0 0 12px;
    padding-left: 4px;
    list-style: none;
    font-size: 11.5px;
    word-break: break-all;
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
