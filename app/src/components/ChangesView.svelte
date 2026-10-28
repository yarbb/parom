<script lang="ts">
  import EmptyState from './EmptyState.svelte';
  import CircleCheck from '@lucide/svelte/icons/circle-check';
  import FileDiffIcon from '@lucide/svelte/icons/file-diff';
  import { SvelteSet } from 'svelte/reactivity';
  import { t } from '../lib/i18n';
  import { fileDiff, repo, type FileChange, type FileDiff } from '../lib/repo.svelte';
  import Checkbox from './Checkbox.svelte';
  import DiffView from './DiffView.svelte';
  import Splitter from './Splitter.svelte';
  import ContextMenu, { type MenuItem } from './ContextMenu.svelte';
  import Modal from './Modal.svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { openInEditor } from '../lib/local';
  import { colWidth, prefs, resetCol, resizeCol } from '../lib/prefs.svelte';

  // Board Bd: uncommitted files with checkboxes, commit box, diff.
  /** Unticked files; everything else is part of the next commit. */
  const excluded = new SvelteSet<string>();
  let selected = $state('');
  let summary = $state('');
  let description = $state('');
  let diff = $state<FileDiff | null>(null);
  let diffError = $state('');
  let loading = $state(false);

  const letter: Record<FileChange['status'], string> = { new: 'A', modified: 'M', deleted: 'D' };
  const tone: Record<FileChange['status'], string> = { new: 'status-new', modified: 'status-modified', deleted: 'status-removed' };

  let included = $derived(repo.changes.filter((c) => !excluded.has(c.path)));
  let allChecked = $derived(repo.changes.length > 0 && included.length === repo.changes.length);

  // Keep a valid selection as the list changes.
  $effect(() => {
    const paths = repo.changes.map((c) => c.path);
    if (!paths.includes(selected)) {
      selected = paths[0] ?? '';
    }
  });

  // Reload the diff when the selection or the files change; a file edited
  // on disk reloads quietly (no "Loading" in between).
  let shownPath = '';
  $effect(() => {
    const path = selected;
    void repo.changes;
    void repo.touched;
    if (!path) {
      diff = null;
      shownPath = '';
      return;
    }
    loading = path !== shownPath;
    shownPath = path;
    fileDiff(repo.dir, path)
      .then((d) => {
        if (path === selected) {
          diff = d;
          diffError = '';
        }
      })
      .catch((e) => path === selected && (diffError = String(e)))
      .finally(() => (loading = false));
  });

  function toggleAll(on: boolean) {
    excluded.clear();
    if (!on) {
      repo.changes.forEach((c) => excluded.add(c.path));
    }
  }

  function toggle(path: string, on: boolean) {
    if (on) {
      excluded.delete(path);
    } else {
      excluded.add(path);
    }
  }

  let menu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);
  /** Files waiting for "Discard changes" to be confirmed. */
  let discarding = $state<string[] | null>(null);

  const full = (rel: string) => `${repo.dir.replace(/[\\/]+$/, '')}/${rel}`;
  const folderOf = (rel: string) => full(rel).replace(/\/[^/]*$/, '');
  const extension = (rel: string) => /\.[^./]+$/.exec(rel)?.[0] ?? '';

  async function ignore(pattern: string) {
    await invoke('append_line', { path: full('.gitignore'), line: pattern }).catch((e) => (repo.error = String(e)));
    void repo.refreshChanges();
  }

  /** Right click on a changed file, as in GitHub Desktop. */
  function openMenu(e: MouseEvent, c: FileChange) {
    e.preventDefault();
    selected = c.path;
    const ext = extension(c.path);
    menu = {
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: t('changes.discard'), danger: true, action: () => (discarding = [c.path]) },
        {
          label: t('changes.discard_all'),
          danger: true,
          disabled: repo.changes.length < 2,
          action: () => (discarding = repo.changes.map((x) => x.path)),
        },
        { separator: true, label: '' },
        { label: t('changes.ignore_file'), disabled: c.path === '.gitignore', action: () => void ignore(`/${c.path}`) },
        ...(ext ? [{ label: t('changes.ignore_ext', { ext }), action: () => void ignore(`*${ext}`) }] : []),
        { separator: true, label: '' },
        { label: t('changes.copy_path'), action: () => void navigator.clipboard?.writeText(full(c.path)) },
        { label: t('changes.copy_relative'), action: () => void navigator.clipboard?.writeText(c.path) },
        { label: t('github.repo.open'), action: () => void openInEditor(folderOf(c.path), '') },
        {
          label: t('changes.open_default'),
          disabled: c.status === 'deleted',
          action: () => void openInEditor(full(c.path), prefs.value.editorPath),
        },
      ],
    };
  }

  async function confirmDiscard() {
    const paths = discarding ?? [];
    discarding = null;
    if (await repo.discard(paths)) {
      paths.forEach((p) => excluded.delete(p));
    }
  }

  async function commit(e: SubmitEvent) {
    e.preventDefault();
    const message = description.trim() ? `${summary.trim()}\n\n${description.trim()}` : summary.trim();
    if (await repo.commit(included.map((c) => c.path), message)) {
      summary = '';
      description = '';
      excluded.clear();
    }
  }
</script>

<div class="changes">
  <div class="files" style:width="{colWidth('ghChanges', 360)}px">
    <div class="section-label head">
      <Checkbox
        bind:checked={() => allChecked, (on) => toggleAll(on)}
        label={t('github.changed_files', { count: repo.changes.length })}
        disabled={!repo.changes.length}
      />
    </div>
    <div class="list">
      {#each repo.changes as c (c.path)}
        <div
          class="row"
          class:selected={c.path === selected}
          role="presentation"
          onclick={() => (selected = c.path)}
          oncontextmenu={(e) => openMenu(e, c)}
        >
          <span class="tick" role="presentation" onclick={(e) => e.stopPropagation()}>
            <Checkbox bind:checked={() => !excluded.has(c.path), (on) => toggle(c.path, on)} label="" title={c.path} />
          </span>
          <span class="mono letter {tone[c.status]}">{letter[c.status]}</span>
          <span class="mono path" title={c.path}>{c.path}</span>
        </div>
      {:else}
        <p class="muted empty">{t('github.no_changes')}</p>
      {/each}
    </div>
    <form class="commit" onsubmit={commit}>
      <input class="field" placeholder={t('github.summary')} aria-label={t('github.summary')} bind:value={summary} />
      <textarea class="field" rows="3" placeholder={t('github.description')} aria-label={t('github.description')} bind:value={description}></textarea>
      <button class="control primary" type="submit" disabled={!summary.trim() || !included.length || !!repo.busy}>
        {t('github.commit_to', { branch: repo.info?.branch ?? 'HEAD' })}
      </button>
    </form>
  </div>
  <Splitter
    axis="x"
    label={t('ui.resize')}
    onMove={(d) => resizeCol('ghChanges', 360, d, 220, 700)}
    onEnd={() => prefs.persist()}
    onReset={() => resetCol('ghChanges')}
  />
  {#if selected}
    {#key selected}<DiffView path={selected} {diff} {loading} error={diffError} />{/key}
  {:else}
    <div class="placeholder">
      {#if repo.changes.length}
        <EmptyState icon={FileDiffIcon} title={t('empty.pick_file')} />
      {:else}
        <EmptyState icon={CircleCheck} title={t('github.no_changes')} text={t('github.no_changes_body')} />
      {/if}
    </div>
  {/if}
</div>

{#if menu}
  <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => (menu = null)} />
{/if}

{#if discarding}
  {@const files = discarding}
  <Modal title={t('changes.discard_title', { count: files.length })} onCancel={() => (discarding = null)}>
    <p>{t('changes.discard_body')}</p>
    <ul class="discard-list mono">
      {#each files.slice(0, 8) as f (f)}<li>{f}</li>{/each}
      {#if files.length > 8}<li class="muted">{t('changes.and_more', { count: files.length - 8 })}</li>{/if}
    </ul>
    {#snippet actions()}
      <button class="control" onclick={() => (discarding = null)}>{t('common.cancel')}</button>
      <button class="control danger" onclick={confirmDiscard}>{t('changes.discard_confirm')}</button>
    {/snippet}
  </Modal>
{/if}

<style>
  .discard-list {
    max-height: 160px;
    overflow-y: auto;
    margin: 8px 0 0;
    padding-left: 18px;
    font-size: 12px;
  }

  .changes {
    flex: 1;
    min-height: 0;
    display: flex;
  }

  .files {
    flex: none;
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--line);
  }

  .list {
    flex: 1;
    overflow: auto;
  }

  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    height: 30px;
    padding: 0 14px;
    border-bottom: 1px solid var(--line-row);
    font-size: 12px;
    cursor: default;
  }

  .row.selected {
    background: var(--selected-bg);
    box-shadow: inset 2px 0 0 var(--selected-mark);
    color: var(--text-strong);
  }

  .tick {
    display: flex;
  }

  .letter {
    width: 12px;
    flex: none;
    font-size: 11px;
  }

  .path {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .empty {
    padding: 12px 14px;
    margin: 0;
  }

  .commit {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 14px;
    border-top: 1px solid var(--line);
  }

  textarea.field {
    height: auto;
    padding: 6px 9px;
    resize: vertical;
    border: 1px solid var(--line-control);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 12px;
  }

  .placeholder {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }
</style>
