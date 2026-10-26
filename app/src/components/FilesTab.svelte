<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { connection } from '../lib/connection.svelte';
  import { localJoin } from '../lib/files';
  import { t } from '../lib/i18n';
  import type { EngineState } from '../lib/types';
  import LocalPane from './LocalPane.svelte';
  import QueuePanel from './QueuePanel.svelte';
  import RemotePane from './RemotePane.svelte';
  import RequestDialog from './RequestDialog.svelte';

  let { engine }: { engine: EngineState } = $props();

  let host = $state('');
  let user = $state('');
  let password = $state('');
  let port = $state('');

  let localPath = $state('');
  let localSeparator = $state('/');
  let localPane: LocalPane;

  let passwordInput: HTMLInputElement;

  let connected = $derived(connection.state === 'connected');

  // A server picked in the top bar menu fills the connect bar. The password
  // is kept only if the same server is already typed; otherwise ask for it.
  $effect(() => {
    const p = connection.picked;
    if (!p) {
      return;
    }
    connection.picked = null;
    untrack(() => {
      const nextHost = p.protocol === 'sftp' ? p.host : `${p.protocol}://${p.host}`;
      const nextPort = p.port ? String(p.port) : '';
      const same = host.trim() === nextHost && user.trim() === p.user && port.trim() === nextPort;
      host = nextHost;
      user = p.user;
      port = nextPort;
      if (!same) {
        password = '';
      }
      if (password) {
        void connection.connect({ host, user, password, port });
      } else {
        void tick().then(() => passwordInput?.focus());
      }
    });
  });
  let busy = $derived(connection.state === 'connecting');

  onMount(() => {
    connection.start();
    connection.onTransferDone = (tr) => {
      if (tr.state !== 'done') {
        return;
      }
      if (tr.download) {
        localPane?.refresh();
      } else {
        void connection.list(connection.remotePath);
      }
    };
    return () => (connection.onTransferDone = null);
  });

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (connected) {
      void connection.disconnect();
    } else {
      void connection.connect({ host, user, password, port });
    }
  }

  function upload(files: { name: string; local: string }[]) {
    for (const f of files) {
      void connection.transfer(false, f.name, { local: f.local, remote_path: connection.remotePath, remote_name: f.name });
    }
  }

  function download(files: { name: string; remotePath: string }[]) {
    for (const f of files) {
      void connection.transfer(true, f.name, {
        remote_path: f.remotePath,
        remote_name: f.name,
        local: localJoin(localPath, f.name, localSeparator),
      });
    }
  }
</script>

<form class="connect" onsubmit={submit}>
  <input class="field mono host" placeholder={t('files.connect.host')} aria-label={t('files.connect.host')} disabled={connected || busy} bind:value={host} />
  <input class="field mono user" placeholder={t('files.connect.user')} aria-label={t('files.connect.user')} disabled={connected || busy} bind:value={user} />
  <input
    class="field mono password"
    type="password"
    placeholder={t('files.connect.password')}
    aria-label={t('files.connect.password')}
    disabled={connected || busy}
    bind:this={passwordInput}
    bind:value={password}
  />
  <input
    class="field mono port"
    inputmode="numeric"
    placeholder={t('files.connect.port')}
    aria-label={t('files.connect.port')}
    disabled={connected || busy}
    bind:value={port}
  />
  {#if connected}
    <button class="control" type="submit">{t('common.disconnect')}</button>
  {:else}
    <button class="control primary" type="submit" disabled={engine !== 'ready' || busy || !host.trim()}>
      {busy ? t('status.connecting') : t('common.connect')}
    </button>
  {/if}
  {#if connection.error}
    <span class="error status-removed" title={connection.error}>{connection.error}</span>
  {/if}
</form>

<div class="panes">
  <LocalPane bind:this={localPane} bind:path={localPath} bind:separator={localSeparator} canUpload={connected} onUpload={upload} />
  <RemotePane onDownload={download} />
</div>

{#if connection.transfers.length}
  <QueuePanel />
{/if}

<RequestDialog />

<style>
  .connect {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 16px;
    border-bottom: 1px solid var(--line);
    flex: none;
  }

  .host {
    width: 200px;
  }

  .user {
    width: 120px;
  }

  .password {
    width: 140px;
  }

  .port {
    width: 70px;
  }

  .error {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
  }

  .panes {
    flex: 1;
    display: flex;
    min-height: 0;
  }
</style>
