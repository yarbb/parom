<script lang="ts">
  import EmptyState from './EmptyState.svelte';
  import CircleCheck from '@lucide/svelte/icons/circle-check';
  import FileDiffIcon from '@lucide/svelte/icons/file-diff';
  import { t } from '../lib/i18n';
  import { changePaths, fileDiff, repo, type FileChange, type FileDiff } from '../lib/repo.svelte';
  import { visibleRange } from '../lib/files';
  import Checkbox from './Checkbox.svelte';
  import DiffView from './DiffView.svelte';
  import Splitter from './Splitter.svelte';
  import ContextMenu, { type MenuItem } from './ContextMenu.svelte';
  import Modal from './Modal.svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { openInEditor } from '../lib/local';
  import { colWidth, prefs, resetCol, resizeCol } from '../lib/prefs.svelte';

  // Board Bd: uncommitted files with checkboxes, commit box, diff.
  /** Unticked files; everything else is part of the next commit. Replaced, not changed in place. */
  let excluded = $state.raw(new Set<string>());
  let selected = $state('');
  let summary = $state('');
  let description = $state('');
  let diff = $state<FileDiff | null>(null);
  let diffError = $state('');
  let loading = $state(false);

  const letter: Record<FileChange['status'], string> = { new: 'A', modified: 'M', deleted: 'D', renamed: 'R' };
  const tone: Record<FileChange['status'], string> = {
    new: 'status-new',
    modified: 'status-modified',
    deleted: 'status-removed',
    renamed: 'status-modified',
  };

  let included = $derived(repo.changes.filter((c) => !excluded.has(c.path)));
  let allChecked = $derived(repo.changes.length > 0 && included.length === repo.changes.length);
  let current = $derived(repo.changes.find((c) => c.path === selected));

  // Only the rows in view and some above and below are drawn, as GitHub
  // Desktop does: a moved folder can list tens of thousands of files.
  const ROW = 30;
  let scrollTop = $state(0);
  let height = $state(0);
  let range = $derived(visibleRange(scrollTop, height, ROW, repo.changes.length, 20));

  // Keep a valid selection as the list changes.
  $effect(() => {
    if (!current) {
      selected = repo.changes[0]?.path ?? '';
    }
  });

  // Reload the diff when the selection or the files change; a file edited
  // on disk reloads quietly (no "Loading" in between).
  let shownPath = '';
  $effect(() => {
    const path = selected;
    void repo.changes;
    void repo.touched;
    if (!path || current?.status === 'renamed') {
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
    excluded = on ? new Set() : new Set(repo.changes.map((c) => c.path));
  }

  function toggle(path: string, on: boolean) {
    const next = new Set(excluded);
    if (on) {
      next.delete(path);
    } else {
      next.add(path);
    }
    excluded = next;
  }

  let menu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);
  /** Files waiting for "Discard changes" to be confirmed. */
  let discarding = $state<string[] | null>(null);

  const full = (rel: string) => `${repo.dir.replace(/[\\/]+$/, '')}/${rel}`;
  const folderOf = (rel: string) => full(rel).replace(/\/[^/]*$/, '');
  const extension = (rel: string) => /\.[^./]+$/.exec(rel)?.[0] ?? '';

  async function ignore(pattern: string) {
    await invoke('append_line', { path: full('.gitignore'), line: pattern }).catch((e) => repo.fail(e));
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
        { label: t('changes.discard'), danger: true, action: () => (discarding = changePaths(c)) },
        {
          label: t('changes.discard_all'),
          danger: true,
          disabled: repo.changes.length < 2,
          action: () => (discarding = repo.changes.flatMap(changePaths)),
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
      excluded = new Set([...excluded].filter((p) => !paths.includes(p)));
    }
  }

  async function commit(e: SubmitEvent) {
    e.preventDefault();
    const message = description.trim() ? `${summary.trim()}\n\n${description.trim()}` : summary.trim();
    if (await repo.commit(included.flatMap(changePaths), message)) {
      summary = '';
      description = '';
      excluded = new Set();
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
    <div class="list" bind:clientHeight={height} onscroll={(e) => (scrollTop = e.currentTarget.scrollTop)}>
      {#if repo.changes.length}
        <div class="spacer" style:height="{repo.changes.length * ROW}px">
          {#each repo.changes.slice(range.start, range.end) as c, k (c.path)}
            {@const title = c.old_path ? `${c.old_path} → ${c.path}` : c.path}
            <div
              class="row"
              class:selected={c.path === selected}
              role="presentation"
              style:transform="translateY({(range.start + k) * ROW}px)"
              onclick={() => (selected = c.path)}
              oncontextmenu={(e) => openMenu(e, c)}
            >
              <span class="tick" role="presentation" onclick={(e) => e.stopPropagation()}>
                <Checkbox bind:checked={() => !excluded.has(c.path), (on) => toggle(c.path, on)} label="" title={c.path} />
              </span>
              <span class="mono letter {tone[c.status]}">{letter[c.status]}</span>
              {#if prefs.value.changesFullPaths}
                <span class="mono path" {title}>{title}</span>
              {:else}
                <!-- The name first, its folder after it (GitHub Desktop cuts long paths in the middle instead). -->
                <span class="path" {title}>
                  <span class="mono name">{c.path.split('/').pop()}</span>
                  {#if c.path.includes('/')}<span class="mono folder">{c.path.slice(0, c.path.lastIndexOf('/'))}</span>{/if}
                </span>
              {/if}
            </div>
          {/each}
        </div>
      {:else}
        <p class="muted empty">{t('github.no_changes')}</p>
      {/if}
    </div>
    <form class="commit" onsubmit={commit}>
      <input class="field" placeholder={t('github.summary')} aria-label={t('github.summary')} bind:value={summary} />
      <textarea class="field" rows="3" placeholder={t('github.description')} aria-label={t('github.description')} bind:value={description}></textarea>
      {#if repo.conflicts}<p class="muted small-note">{t('conflicts.no_commit')}</p>{/if}
      <button class="control primary" type="submit" disabled={!summary.trim() || !included.length || !!repo.busy || !!repo.conflicts}>
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
  {#if current?.old_path}
    <div class="placeholder">
      <EmptyState icon={FileDiffIcon} title={t('changes.renamed_from', { path: current.old_path })} text={t('changes.renamed_same')} />
    </div>
  {:else if selected}
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

  .spacer {
    position: relative;
  }

  .row {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
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

  .folder {
    margin-left: 8px;
    color: var(--muted);
    font-size: 11px;
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

  .small-note {
    margin: 0;
    font-size: 11.5px;
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
