<script lang="ts">
  import PathInput from './PathInput.svelte';
  import { hint } from '../lib/keys';
  import EmptyState from './EmptyState.svelte';
  import FolderOpen from '@lucide/svelte/icons/folder-open';
  import { onMount } from 'svelte';
  import { invoke, isTauri } from '@tauri-apps/api/core';
  import { open } from '@tauri-apps/plugin-dialog';
  import { localJoin, selectionSummary, type FileRow } from '../lib/files';
  import { t } from '../lib/i18n';
  import { prefs } from '../lib/prefs.svelte';
  import { listLocal, localHome, localMkdir, localRename, localRoots, localTrash, openInEditor } from '../lib/local';
  import ContextMenu, { type MenuItem } from './ContextMenu.svelte';
  import FileOpDialog, { type FileOp } from './FileOpDialog.svelte';
  import FileList from './FileList.svelte';
  import { paneDrag } from '../lib/panedrag.svelte';
  import { labelColors, labelOf, localLabelKey } from '../lib/labels';
  import LabelPicker from './LabelPicker.svelte';
  import { dragOut } from '../lib/dragout';
  import { shownLocal } from '../lib/browsing';
  import { twinColor, twins } from '../lib/twins.svelte';
  import { fileOps } from '../lib/fileops.svelte';

  interface Props {
    /** Current directory and separator, for downloads into it. */
    path?: string;
    separator?: string;
    canUpload: boolean;
    onUpload: (items: { name: string; local: string; dir: boolean }[]) => void;
  }

  let { path = $bindable(''), separator = $bindable('/'), canUpload, onUpload }: Props = $props();

  let parent = $state<string | null>(null);
  let rows = $state<FileRow[]>([]);
  let roots = $state<string[]>([]);
  /** True while showing the list of drives (Windows) instead of a directory. */
  let atRoots = $state(false);
  let loading = $state(false);
  let error = $state('');
  let typed = $state('');
  let selected = $state<FileRow[]>([]);

  /** Folder names for path suggestions; nothing for the drive list. */
  async function localFolders(dir: string): Promise<string[] | null> {
    const res = await listLocal(dir);
    return res.rows.filter((r) => r.dir).map((r) => r.name);
  }

  /** A path as shown and copied; the list itself keeps the system's form. */
  const shown = (p: string) => shownLocal(p, prefs.value.forwardSlashes);

  $effect(() => {
    if (!atRoots && path) {
      typed = shown(path);
    }
  });

  /** Opens a folder; `quiet` (synchronized browsing) leaves the pane as it is when that fails. */
  export async function load(dir: string, quiet = false) {
    loading = true;
    if (!quiet) {
      error = '';
    }
    try {
      const res = await listLocal(dir);
      path = res.path;
      parent = res.parent;
      separator = res.separator;
      rows = res.rows;
      atRoots = false;
      if (prefs.value.rememberDirs) {
        void prefs.set('lastLocalDir', res.path);
      }
    } catch (e) {
      if (!quiet) {
        error = String(e);
      }
    } finally {
      loading = false;
    }
  }

  export function refresh() {
    if (!atRoots && path) {
      void load(path);
    }
  }

  function up() {
    if (parent) {
      void load(parent);
    } else if (roots.length > 1) {
      atRoots = true;
      rows = roots.map((r) => ({ name: r, size: -1, dir: true, link: false, time: null }));
      typed = '';
    }
  }

  /** Picks a folder with the system dialog and opens it. */
  async function browse() {
    if (!isTauri()) {
      return;
    }
    const dir = await open({ directory: true, multiple: false, defaultPath: atRoots ? undefined : path || undefined });
    if (typeof dir === 'string') {
      await load(dir);
    }
  }

  function upload(files: FileRow[]) {
    if (!canUpload) {
      return;
    }
    onUpload(files.map((f) => ({ name: f.name, local: localJoin(path, f.name, separator), dir: f.dir })));
  }

  let menu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);
  let op = $state<FileOp | null>(null);
  let labeling = $state<{ keys: string[]; names: string[] } | null>(null);
  const remoteDirs = $derived(new Set(twins.remote));
  const folderLabel = (row: FileRow) => {
    const c = labelOf(localLabelKey(localJoin(path, row.name, separator)));
    return c ? labelColors[c] : !atRoots && prefs.value.markTwins && remoteDirs.has(row.name) ? twinColor : null;
  };

  $effect(() => {
    twins.local = atRoots ? [] : rows.filter((r) => r.dir).map((r) => r.name);
  });

  /** Runs a local file operation, then reloads the folder; failures show in the list. */
  async function fsOp(run: () => Promise<void>) {
    try {
      await run();
      refresh();
    } catch (e) {
      error = String(e);
    }
  }

  /** The folder's rows (command() takes the selected rows as `rows`). */
  const listed = () => rows;

  function command(cmd: 'rename' | 'delete' | 'refresh' | 'mkdir' | 'mkfile', rows: FileRow[], quick = false) {
    if (atRoots) {
      return;
    }
    const full = (name: string) => localJoin(path, name, separator);
    if (cmd === 'refresh') {
      refresh();
    } else if (cmd === 'mkdir') {
      op = { kind: 'mkdir', onSubmit: (name) => fsOp(() => localMkdir(full(name))) };
    } else if (cmd === 'mkfile') {
      op = {
        kind: 'mkfile',
        onSubmit: (name) =>
          fsOp(async () => {
            if (listed().some((r) => r.name === name)) {
              throw new Error(`${name} already exists`);
            }
            await invoke('write_small_file', { path: full(name), content: '' });
          }),
      };
    } else if (cmd === 'rename' && rows.length === 1) {
      const from = rows[0].name;
      op = { kind: 'rename', name: from, onSubmit: (to) => to !== from && fsOp(() => localRename(full(from), full(to))) };
    } else if (cmd === 'delete' && rows.length) {
      const names = rows.map((r) => r.name);
      if (quick) {
        void fsOp(() => localTrash(names.map(full)));
      } else {
        op = { kind: 'delete', names, remote: false, onSubmit: () => fsOp(() => localTrash(names.map(full))) };
      }
    }
  }

  function copyPath(rows: FileRow[]) {
    void navigator.clipboard?.writeText((rows.length ? rows.map((r) => localJoin(path, r.name, separator)) : [path]).map(shown).join('\n'));
  }

  onMount(() =>
    fileOps.register('local', {
      ready: () => !atRoots && !!path,
      selected: () => selected,
      command,
      transfer: upload,
      canTransfer: () => canUpload,
      edit: (row) => void fsOp(() => openInEditor(localJoin(path, row.name, separator), prefs.value.editorPath)),
      copyPath,
    }),
  );

  function openMenu(e: MouseEvent, rows: FileRow[]) {
    if (atRoots) {
      return;
    }
    const any = rows.length > 0;
    menu = {
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: `${t('files.upload')} →`, disabled: !canUpload || !any, action: () => upload(rows) },
        {
          label: t('edit.edit'),
          disabled: rows.length !== 1 || rows[0].dir,
          action: () => fsOp(() => openInEditor(localJoin(path, rows[0].name, separator), prefs.value.editorPath)),
        },
        { separator: true, label: '' },
        { label: t('fileop.rename.title'), hint: hint('rename'), disabled: rows.length !== 1, action: () => command('rename', rows) },
        e.shiftKey
          ? { label: t('fileop.delete_now'), hint: hint('delete') && `Shift+${hint('delete')}`, danger: true, disabled: !any, action: () => command('delete', rows, true) }
          : { label: t('fileop.trash'), hint: hint('delete'), disabled: !any, action: () => command('delete', rows) },
        { label: t('fileop.mkdir.title'), action: () => command('mkdir', rows) },
        { label: t('fileop.mkfile.title'), action: () => command('mkfile', rows) },
        {
          label: t('labels.menu'),
          disabled: !rows.some((r) => r.dir),
          action: () => {
            const dirs = rows.filter((r) => r.dir);
            labeling = { keys: dirs.map((r) => localLabelKey(localJoin(path, r.name, separator))), names: dirs.map((r) => r.name) };
          },
        },
        ...(e.shiftKey
          ? [
              { separator: true, label: '' },
              { label: t('fileop.copy_as_path'), action: () => copyPath(rows) },
              { label: t('github.repo.open'), action: () => void openInEditor(any && rows.length === 1 && rows[0].dir ? localJoin(path, rows[0].name, separator) : path, '') },
            ]
          : []),
        { separator: true, label: '' },
        { label: t('files.refresh'), hint: hint('refresh'), action: refresh },
      ],
    };
  }

  onMount(async () => {
    if (!isTauri()) {
      error = t('files.error.desktop_only');
      return;
    }
    roots = await localRoots();
    const last = prefs.value.rememberDirs ? prefs.value.lastLocalDir : '';
    await load(last || (await localHome()));
    if (error && last) {
      // The remembered folder is gone; start at home instead.
      await load(await localHome());
    }
  });
</script>

{#snippet empty()}
  <EmptyState icon={FolderOpen} title={t('files.empty')} />
{/snippet}

<section
  class="pane"
  data-pane="local"
  onpointerdowncapture={() => (fileOps.active = 'local')}
  onfocusin={() => (fileOps.active = 'local')}
  class:drop-target={paneDrag.over === 'local' && paneDrag.active?.from === 'server'}>
  <div class="section-label head">
    <span>{t('files.local')}<span class="picked">{selectionSummary(selected, (count) => t('files.selected', { count }), prefs.value.sizeUnits === 'decimal')}</span></span>
    <span class="buttons">
      <button class="control small" onclick={browse} title={t('files.browse_hint')}>{t('files.browse')}</button>
      <button class="control small" disabled={!canUpload || selected.length === 0} onclick={() => upload(selected)}>
        {t('files.upload')} →
      </button>
    </span>
  </div>
  <PathInput
    bind:value={typed}
    label={t('files.local_path')}
    separators={separator === '\\' ? '\\/' : '/'}
    caseSensitive={separator !== '\\'}
    folders={localFolders}
    onSubmit={(p) => load(p)}
  />
  <FileList
    label={t('files.local')}
    {rows}
    canGoUp={!atRoots && (parent !== null || roots.length > 1)}
    onUp={up}
    onOpenDir={(row) => load(atRoots ? row.name : localJoin(path, row.name, separator))}
    {empty}
    onActivate={upload}
    folder={path}
    labelOf={folderLabel}
    onDragOut={(rows) =>
      void dragOut(
        rows.map((r) => localJoin(path, r.name, separator)),
        rows.length === 1 ? rows[0].name : t('files.drag_count', { count: rows.length }),
      ).catch((e) => (error = String(e)))}
    dragFrom="local"
    bind:selected
    {loading}
    {error}
    emptyText={t('files.empty')}
    onContextMenu={openMenu}
    onCommand={command}
  />
</section>

{#if menu}
  <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => (menu = null)} />
{/if}
{#if op}
  <FileOpDialog {op} onClose={() => (op = null)} />
{/if}
{#if labeling}
  <LabelPicker keys={labeling.keys} names={labeling.names} onClose={() => (labeling = null)} />
{/if}
