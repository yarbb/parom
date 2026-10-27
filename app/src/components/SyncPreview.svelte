<script lang="ts">
  import { connection } from '../lib/connection.svelte';
  import { formatTime } from '../lib/files';
  import { t } from '../lib/i18n';
  import { sync, type Preview } from '../lib/sync/engine.svelte';
  import { groupByFolder, type PreviewItem } from '../lib/sync/plan';
  import { relativeTime } from '../lib/when';
  import Checkbox from './Checkbox.svelte';
  import Modal from './Modal.svelte';

  // What a sync will do, before it runs: commits (to the server), files by
  // folder with "new" / "overwrite" tags, and a checkbox per file and folder.
  let { preview }: { preview: Preview } = $props();

  let groups = $derived(groupByFolder(preview.items));
  let chosen = $derived(preview.items.filter((i) => i.include).length);
  let deploy = $derived(preview.direction === 'deploy');
  const c = $derived(sync.check);

  const short = (sha: string | null | undefined) => (sha ? sha.slice(0, 7) : '–');
  const when = (iso: string | undefined) => (iso ? formatTime(Date.parse(iso), Date.now(), true) : '');
  const name = (path: string) => path.slice(path.lastIndexOf('/') + 1);

  const tag: Record<PreviewItem['kind'], { key: string; tone: string }> = {
    new: { key: 'sync.preview.new', tone: 'status-new' },
    overwrite: { key: 'sync.preview.overwrite', tone: 'status-modified' },
    edited: { key: 'sync.preview.edited', tone: 'status-modified' },
    dirty: { key: 'sync.preview.dirty', tone: 'status-removed' },
  };

  function setFolder(items: PreviewItem[], on: boolean) {
    for (const i of items) {
      i.include = on;
    }
  }
</script>

<Modal
  title={deploy ? t('sync.preview.deploy_title', { server: connection.site?.name ?? '' }) : t('sync.preview.pull_title', { server: connection.site?.name ?? '' })}
  wide
  onCancel={() => sync.cancelPreview()}
>
  {#if deploy && preview.warn && c}
    <p class="status-modified">{t('sync.differ.body')}</p>
    <dl class="versions">
      <dt>{t('sync.server')}</dt>
      <dd class="mono">{short(c.marker?.sha)}{c.marker?.who ? ` · ${t('sync.differ.synced_by', { who: c.marker.who })}` : ''}{c.marker?.when ? ` · ${when(c.marker.when)}` : ''}</dd>
      <dt>{t('sync.local')}</dt>
      <dd class="mono">{short(c.repo.head)}</dd>
    </dl>
  {/if}
  {#if !deploy}
    <p class="muted">{t('sync.preview.pull_body')}</p>
  {/if}

  {#if deploy && preview.commits.length}
    <div class="label">{t('sync.preview.commits', { count: preview.commits.length })}</div>
    <ul class="commits">
      {#each preview.commits as cm (cm.sha)}
        <li><span class="mono muted">{cm.sha.slice(0, 7)}</span> <span class="summary">{cm.summary}</span> <span class="muted">{cm.author} · {relativeTime(cm.time * 1000)}</span></li>
      {/each}
    </ul>
  {/if}

  <div class="label files-label">
    <span>{t('sync.preview.files', { chosen, count: preview.items.length })}</span>
    {#if preview.items.length}
      <span class="pick-all">
        <button type="button" onclick={() => setFolder(preview.items, true)}>{t('sync.preview.all')}</button>
        <button type="button" onclick={() => setFolder(preview.items, false)}>{t('sync.preview.none')}</button>
      </span>
    {/if}
  </div>
  {#if deploy && preview.items.length && chosen === 0}
    <p class="muted small">{t('sync.preview.marker_only')}</p>
  {/if}
  {#if preview.items.length}
    <div class="tree">
      {#each groups as g (g.folder)}
        {@const all = g.items.every((i) => i.include)}
        <div class="folder">
          <Checkbox bind:checked={() => all, (on) => setFolder(g.items, on)} label="" title={g.folder || '/'} />
          <span class="mono">{g.folder ? `${g.folder}/` : '/'}</span>
        </div>
        {#each g.items as item (item.path)}
          <div class="file">
            <Checkbox bind:checked={item.include} label="" title={item.path} />
            <span class="mono name" title={item.path}>{name(item.path)}</span>
            <span class="tag {tag[item.kind].tone}">{t(tag[item.kind].key)}</span>
          </div>
        {/each}
      {/each}
    </div>
  {:else}
    <p class="muted">{deploy ? t('sync.preview.nothing_deploy') : t('sync.preview.nothing_pull')}</p>
  {/if}

  {#if deploy && preview.plan}
    {#if preview.plan.removedInRepo.length}<p class="muted small">{t('sync.differ.removed', { count: preview.plan.removedInRepo.length })}</p>{/if}
    {#if preview.plan.protectedSkipped.length}<p class="muted small">{t('sync.differ.protected', { count: preview.plan.protectedSkipped.length })}</p>{/if}
    <Checkbox bind:checked={preview.backup} label={t('sync.backup_first')} />
  {/if}

  {#snippet actions()}
    <button class="control" onclick={() => sync.cancelPreview()}>{t('common.cancel')}</button>
    <button class="control primary" disabled={!deploy && chosen === 0} onclick={() => sync.applyPreview()}>
      {deploy ? t('sync.preview.upload', { count: chosen }) : t('sync.preview.take', { count: chosen })}
    </button>
  {/snippet}
</Modal>

<style>
  p {
    margin: 0 0 10px;
  }

  .small {
    font-size: 11.5px;
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

  .label {
    margin: 4px 0 6px;
    color: var(--muted);
    font-size: 10.5px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .files-label {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .pick-all {
    display: flex;
    gap: 10px;
    text-transform: none;
    letter-spacing: normal;
  }

  .pick-all button {
    padding: 0;
    border: 0;
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: 11.5px;
    text-decoration: underline;
    cursor: pointer;
  }

  .pick-all button:hover {
    color: var(--text-strong);
  }

  .commits {
    margin: 0 0 10px;
    padding: 0;
    list-style: none;
    max-height: 110px;
    overflow: auto;
    font-size: 12px;
  }

  .commits li {
    padding: 2px 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .summary {
    color: var(--text-strong);
  }

  .tree {
    max-height: 260px;
    margin-bottom: 10px;
    overflow: auto;
    border: 1px solid var(--line);
    border-radius: 4px;
    font-size: 12px;
  }

  .folder,
  .file {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 10px;
  }

  .folder {
    background: var(--bg);
    color: var(--muted);
  }

  .file {
    padding-left: 30px;
  }

  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tag {
    flex: none;
    font-size: 11px;
  }
</style>
