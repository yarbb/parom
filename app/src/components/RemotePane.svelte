<script lang="ts">
  import { connection } from '../lib/connection.svelte';
  import { edits } from '../lib/edits.svelte';
  import { remoteJoin, remoteParent, selectionSummary, type FileRow } from '../lib/files';
  import { prefs } from '../lib/prefs.svelte';
  import { t } from '../lib/i18n';
  import ContextMenu, { type MenuItem } from './ContextMenu.svelte';
  import FileList from './FileList.svelte';
  import { paneDrag } from '../lib/panedrag.svelte';
  import FileOpDialog, { type FileOp } from './FileOpDialog.svelte';

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

  function command(cmd: 'rename' | 'delete' | 'refresh' | 'mkdir' | 'mkfile', rows: FileRow[]) {
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
      op = { kind: 'delete', names: rows.map((r) => r.name), remote: true, onSubmit: () => void connection.deleteRemote(rows) };
    }
  }

  function copyPath(rows: FileRow[]) {
    const paths = rows.length ? rows.map((r) => remoteJoin(connection.remotePath, r.name)) : [connection.remotePath];
    void navigator.clipboard?.writeText(paths.join('\n'));
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
        { label: t('fileop.delete.title'), hint: 'Del', disabled: !any, action: () => command('delete', rows) },
        { label: t('fileop.mkdir.title'), action: () => command('mkdir', rows) },
        { label: t('fileop.mkfile.title'), action: () => command('mkfile', rows) },
        { label: t('fileop.copy_path'), action: () => copyPath(rows) },
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
