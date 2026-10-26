<script lang="ts">
  import { connection } from '../lib/connection.svelte';
  import { remoteJoin, remoteParent, type FileRow } from '../lib/files';
  import { t } from '../lib/i18n';
  import FileList from './FileList.svelte';

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
</script>

<section class="pane">
  <div class="section-label head">
    <span>{t('files.remote')}</span>
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
    bind:selected
    loading={connection.remoteLoading}
    error={connection.remoteError}
    emptyText={connected ? t('files.empty') : t('files.not_connected_hint')}
  />
</section>
