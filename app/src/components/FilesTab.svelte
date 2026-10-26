<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { connection } from '../lib/connection.svelte';
  import { localJoin } from '../lib/files';
  import { t } from '../lib/i18n';
  import { credentialKey } from '../lib/recent';
  import { getSecret } from '../lib/secrets';
  import Checkbox from './Checkbox.svelte';
  import Modal from './Modal.svelte';
  import { siteSecretKey, type Site } from '../lib/sites.svelte';
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
  let remember = $state(false);

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
      remember = !!p.remember;
      void fillAndConnect(p.remember ? credentialKey(p) : null);
    });
  });

  // A saved site picked in the top bar or the Site Manager.
  let sitePrompt = $state<Site | null>(null);
  let sitePassword = $state('');

  $effect(() => {
    const p = connection.pickedSite;
    if (!p) {
      return;
    }
    connection.pickedSite = null;
    untrack(() => void connectToSite(p.site, p.password));
  });

  async function connectToSite(site: Site, typed?: string) {
    if (connection.state === 'connected') {
      await connection.disconnect();
    }
    let pw = typed ?? '';
    if (!pw && site.logon === 'normal' && site.savedPassword) {
      pw = (await getSecret(siteSecretKey(site)).catch(() => null)) ?? '';
    }
    if (site.logon === 'ask' || (site.logon === 'normal' && !pw)) {
      sitePassword = '';
      sitePrompt = site;
      return;
    }
    await connection.connectSite(site, pw);
  }

  $effect(() => {
    const dir = connection.localDirRequest;
    if (dir) {
      connection.localDirRequest = null;
      void localPane?.load(dir);
    }
  });

  /** Uses the stored password if there is one, otherwise the typed one, otherwise asks for it. */
  async function fillAndConnect(key: string | null) {
    if (key) {
      try {
        const stored = await getSecret(key);
        if (stored !== null) {
          password = stored;
        } else {
          remember = false;
        }
      } catch {
        remember = false;
      }
    }
    if (password) {
      void connection.connect({ host, user, password, port, remember });
    } else {
      await tick();
      passwordInput?.focus();
    }
  }
  let busy = $derived(connection.state === 'connecting');

  onMount(() => {
    connection.start();
    connection.onTransferDone = (tr) => {
      // Refresh once a batch (e.g. a folder) is through, not after every file.
      if (tr.state !== 'done' || connection.transfers.some((x) => x.state === 'running')) {
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
      void connection.connect({ host, user, password, port, remember });
    }
  }

  function upload(items: { name: string; local: string; dir: boolean }[]) {
    const target = connection.remotePath;
    for (const f of items) {
      if (f.dir) {
        void connection.uploadFolder(f.local, localSeparator, f.name, target);
      } else {
        void connection.transfer(false, f.name, { local: f.local, remote_path: target, remote_name: f.name });
      }
    }
  }

  function download(items: { name: string; remotePath: string; dir: boolean }[]) {
    const target = localPath;
    for (const f of items) {
      if (f.dir) {
        void connection.downloadFolder(f.remotePath, f.name, target, localSeparator);
      } else {
        void connection.transfer(true, f.name, {
          remote_path: f.remotePath,
          remote_name: f.name,
          local: localJoin(target, f.name, localSeparator),
        });
      }
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
  <Checkbox bind:checked={remember} label={t('files.connect.remember')} title={t('files.connect.remember_hint')} disabled={connected || busy} />
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

{#if sitePrompt}
  {@const s = sitePrompt}
  <Modal title={t('dialog.password.title')} onCancel={() => (sitePrompt = null)}>
    <form id="site-password" onsubmit={(e) => (e.preventDefault(), (sitePrompt = null), connection.connectSite(s, sitePassword))}>
      <p class="mono">{s.name} · {s.user ? `${s.user}@` : ''}{s.host}</p>
      <input class="field mono site-password" type="password" aria-label={t('files.connect.password')} bind:value={sitePassword} />
    </form>
    {#snippet actions()}
      <button class="control" onclick={() => (sitePrompt = null)}>{t('common.cancel')}</button>
      <button class="control primary" type="submit" form="site-password">{t('common.connect')}</button>
    {/snippet}
  </Modal>
{/if}

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

  .site-password {
    width: 100%;
  }

  .panes {
    flex: 1;
    display: flex;
    min-height: 0;
  }
</style>
