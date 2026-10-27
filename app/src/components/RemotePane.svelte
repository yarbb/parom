<script lang="ts">
  import { connection } from '../lib/connection.svelte';
  import { edits } from '../lib/edits.svelte';
  import { remoteJoin, remoteParent, selectionSummary, type FileRow } from '../lib/files';
  import { prefs } from '../lib/prefs.svelte';
  import { t } from '../lib/i18n';
  import ContextMenu, { type MenuItem } from './ContextMenu.svelte';
  import FileList from './FileList.svelte';
  import { paneDrag } from '../lib/panedrag.svelte';
  import { labelColors, labelOf, remoteLabelKey } from '../lib/labels';
  import LabelPicker from './LabelPicker.svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { dragOut } from '../lib/dragout';
  import { localJoin } from '../lib/files';
  import FileOpDialog, { type FileOp } from './FileOpDialog.svelte';
  import Link2 from '@lucide/svelte/icons/link-2';
  import { ui } from '../lib/ui.svelte';
  import { canSyncBrowse } from '../lib/commands.svelte';
  import { twinColor, twins } from '../lib/twins.svelte';

  interface Props {
    onDownload: (items: { name: string; remotePath: string; dir: boolean }[]) => void;
  }

  let { onDownload }: Props = $props();

  let typed = $state('');
  let selected = $state<FileRow[]>([]);
  let connected = $derived(connection.state === 'connected');
  let parent = $derived(connection.remotePath ? remoteParent(connection.remotePath) : null);

  $effect(() => {
    typed = connection.remotePath;
  });

  function download(files: FileRow[]) {
    onDownload(files.map((f) => ({ name: f.name, remotePath: connection.remotePath, dir: f.dir })));
  }

  let menu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);
  let op = $state<FileOp | null>(null);
  let labeling = $state<{ keys: string[]; names: string[] } | null>(null);

  // Dragging server files out of the window: the system needs files that
  // exist, so a drag starts downloading them to a temp folder at once
  // (files only, up to 200 MB), and leaving the window hands them over.
  let prepared: { names: string[]; ready: Promise<string[] | null> } | null = null;

  function prepareDragOut(rows: FileRow[]) {
    const files = rows.filter((r) => !r.dir);
    const size = files.reduce((n, r) => n + Math.max(0, r.size), 0);
    prepared = null;
    if (!files.length || files.length !== rows.length || size > 200 * 1024 * 1024) {
      return;
    }
    const remotePath = connection.remotePath;
    const ready = (async () => {
      const dir = await invoke<string>('edit_new_dir');
      const sep = dir.includes('\\') ? '\\' : '/';
      const done = await Promise.all(
        files.map((f) =>
          connection.transfer(true, f.name, { remote_path: remotePath, remote_name: f.name, local: localJoin(dir, f.name, sep), exists: 'overwrite' }),
        ),
      );
      return done.every((tr) => tr.state === 'done') ? files.map((f) => localJoin(dir, f.name, sep)) : null;
    })();
    prepared = { names: files.map((f) => f.name), ready };
  }

  async function finishDragOut(rows: FileRow[]) {
    const p = prepared;
    if (!p || rows.some((r) => !p.names.includes(r.name))) {
      connection.message = { level: 'error', text: t('files.drag_out_folders') };
      return;
    }
    // Small files are usually there by the time the mouse leaves the window.
    const paths = await Promise.race([p.ready, new Promise<null>((r) => setTimeout(() => r(null), 4000))]);
    if (!paths) {
      connection.message = { level: 'status', text: t('files.drag_out_wait') };
      return;
    }
    await dragOut(paths, rows.length === 1 ? rows[0].name : t('files.drag_count', { count: rows.length })).catch(
      (e) => (connection.message = { level: 'error', text: String(e) }),
    );
  }
  /** Labels belong to a server: the saved site, or the address of a quick connection. */
  const server = $derived(connection.site?.id ?? connection.label);
  const localDirs = $derived(new Set(twins.local));
  const folderLabel = (row: FileRow) => {
    const c = labelOf(remoteLabelKey(server, remoteJoin(connection.remotePath, row.name)));
    return c ? labelColors[c] : prefs.value.markTwins && localDirs.has(row.name) ? twinColor : null;
  };

  function command(cmd: 'rename' | 'delete' | 'refresh' | 'mkdir' | 'mkfile', rows: FileRow[], quick = false) {
    if (!connected) {
      return;
    }
    if (cmd === 'refresh') {
      void connection.list(connection.remotePath);
    } else if (cmd === 'mkdir') {
      op = { kind: 'mkdir', onSubmit: (name) => void connection.mkdirRemote(name) };
    } else if (cmd === 'mkfile') {
      op = { kind: 'mkfile', onSubmit: (name) => void connection.mkfileRemote(name) };
    } else if (cmd === 'rename' && rows.length === 1) {
      const from = rows[0].name;
      op = { kind: 'rename', name: from, onSubmit: (to) => to !== from && void connection.renameRemote(from, to) };
    } else if (cmd === 'delete' && rows.length) {
      if (quick) {
        void connection.deleteRemote(rows);
      } else {
        op = { kind: 'delete', names: rows.map((r) => r.name), remote: true, onSubmit: () => void connection.deleteRemote(rows) };
      }
    }
  }

  function copyPath(rows: FileRow[]) {
    const paths = rows.length ? rows.map((r) => remoteJoin(connection.remotePath, r.name)) : [connection.remotePath];
    void navigator.clipboard?.writeText(paths.join('\n'));
  }

  /** sftp://user@host:port/path (Shift+right-click), for other clients and notes. */
  function copyUrl(rows: FileRow[]) {
    const site = connection.site;
    const scheme = site?.protocol && site.protocol !== 'sftp' ? 'ftp' : 'sftp';
    const auth = connection.label.split(' (').pop()!.replace(/\)$/, '');
    const paths = rows.length ? rows.map((r) => remoteJoin(connection.remotePath, r.name)) : [connection.remotePath];
    void navigator.clipboard?.writeText(paths.map((p) => `${scheme}://${auth}${p}`).join('\n'));
  }

  function openMenu(e: MouseEvent, rows: FileRow[]) {
    if (!connected) {
      return;
    }
    const any = rows.length > 0;
    menu = {
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: `← ${t('files.download')}`, disabled: !any, action: () => download(rows) },
        {
          label: t('edit.edit'),
          disabled: rows.length !== 1 || rows[0].dir,
          action: () => edits.edit(connection.remotePath, rows[0].name),
        },
        { separator: true, label: '' },
        { label: t('fileop.rename.title'), hint: 'F2', disabled: rows.length !== 1, action: () => command('rename', rows) },
        e.shiftKey
          ? { label: t('fileop.delete_now'), hint: 'Shift+Del', danger: true, disabled: !any, action: () => command('delete', rows, true) }
          : { label: t('fileop.delete.title'), hint: 'Del', disabled: !any, action: () => command('delete', rows) },
        { label: t('fileop.mkdir.title'), action: () => command('mkdir', rows) },
        { label: t('fileop.mkfile.title'), action: () => command('mkfile', rows) },
        {
          label: t('labels.menu'),
          disabled: !rows.some((r) => r.dir),
          action: () => {
            const dirs = rows.filter((r) => r.dir);
            labeling = { keys: dirs.map((r) => remoteLabelKey(server, remoteJoin(connection.remotePath, r.name))), names: dirs.map((r) => r.name) };
          },
        },
        { label: t('fileop.copy_path'), action: () => copyPath(rows) },
        ...(e.shiftKey ? [{ label: t('fileop.copy_url'), action: () => copyUrl(rows) }] : []),
        { separator: true, label: '' },
        { label: t('files.refresh'), hint: 'F5', action: () => command('refresh', rows) },
      ],
    };
  }
</script>

<section
  class="pane"
  data-pane="server"
  class:drop-target={paneDrag.over === 'server' && (paneDrag.active ? paneDrag.active.from === 'local' : paneDrag.external) && connected}
>
  <div class="section-label head">
    <span>{t('files.remote')}<span class="picked">{selectionSummary(selected, (count) => t('files.selected', { count }), prefs.value.sizeUnits === 'decimal')}</span></span>
    <span class="buttons">
      <button
        class="control small icon-btn"
        class:on={ui.syncBrowse}
        aria-pressed={ui.syncBrowse}
        aria-label={t('files.sync_browse')}
        title={t('files.sync_browse_hint')}
        disabled={!canSyncBrowse()}
        onclick={() => (ui.syncBrowse = !ui.syncBrowse)}
      >
        <Link2 size={13} strokeWidth={1.8} />
      </button>
      <button class="control small" disabled={!connected} onclick={() => connection.list(connection.remotePath)}>{t('files.refresh')}</button>
      <button class="control small" disabled={!connected || selected.length === 0} onclick={() => download(selected)}>
        ← {t('files.download')}
      </button>
    </span>
  </div>
  <form class="pathbar" onsubmit={(e) => (e.preventDefault(), connected && typed && connection.list(typed.trim()))}>
    <input class="field mono" aria-label={t('files.remote_path')} disabled={!connected} bind:value={typed} />
  </form>
  <FileList
    label={t('files.remote')}
    rows={connection.remoteRows}
    canGoUp={connected && parent !== null}
    onUp={() => parent && connection.list(parent)}
    onOpenDir={(row) => connection.list(remoteJoin(connection.remotePath, row.name))}
    onActivate={download}
    folder={connection.remotePath}
    labelOf={folderLabel}
    onDragStart={prepareDragOut}
    onDragOut={finishDragOut}
    unscanned={(row) => row.dir && !connection.listed.has(remoteJoin(connection.remotePath, row.name))}
    dragFrom="server"
    bind:selected
    loading={connection.remoteLoading}
    error={connection.remoteError}
    emptyText={connected ? t('files.empty') : t('files.not_connected_hint')}
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
