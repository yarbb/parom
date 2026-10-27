<script lang="ts">
  import { open } from '@tauri-apps/plugin-dialog';
  import { isTauri } from '@tauri-apps/api/core';
  import { connection } from '../lib/connection.svelte';
  import { t } from '../lib/i18n';
  import { deleteSecret, setSecret } from '../lib/secrets';
  import { newSite, protocols, siteSecretKey, sites, type Protocol, type Site } from '../lib/sites.svelte';
  import { splitAddress } from '../lib/files';
  import { git } from '../lib/sync/host';
  import { sync } from '../lib/sync/engine.svelte';
  import Checkbox from './Checkbox.svelte';
  import Select from './Select.svelte';

  // Board Sm: a tree of sites and folders on the left, the selected site's
  // settings in tabs on the right. Edits a copy; OK or Connect saves it.
  let { onClose }: { onClose: () => void } = $props();

  let folders = $state<string[]>($state.snapshot(sites.folders));
  let list = $state<Site[]>($state.snapshot(sites.list) as Site[]);
  let selectedId = $state<string | null>(sites.list[0]?.id ?? null);
  let selectedFolder = $state<string | null>(null);
  let tab = $state<'general' | 'advanced' | 'transfer' | 'sync'>('general');
  /** Passwords typed in this dialog, by site id; saved on OK. */
  let passwords = $state<Record<string, string>>({});
  let savePassword = $state<Record<string, boolean>>({});
  let error = $state('');

  let site = $derived(list.find((s) => s.id === selectedId) ?? null);
  let tree = $derived([
    ...list.filter((s) => !s.folder).map((s) => ({ folder: null as string | null, site: s })),
    ...folders.flatMap((f) => [
      { folder: f, site: null as Site | null },
      ...list.filter((s) => s.folder === f).map((s) => ({ folder: null, site: s })),
    ]),
  ]);

  function addSite() {
    const s = newSite(selectedFolder ?? site?.folder ?? '');
    list.push(s);
    selectedId = s.id;
    selectedFolder = null;
    tab = 'general';
  }

  function addFolder() {
    let name = t('sites.new_folder');
    for (let i = 2; folders.includes(name); i++) {
      name = `${t('sites.new_folder')} ${i}`;
    }
    folders.push(name);
    selectedFolder = name;
    selectedId = null;
  }

  function renameFolder(from: string, to: string) {
    const name = to.trim();
    if (!name || folders.includes(name)) {
      return;
    }
    folders = folders.map((f) => (f === from ? name : f));
    for (const s of list) {
      if (s.folder === from) {
        s.folder = name;
      }
    }
    selectedFolder = name;
  }

  function remove() {
    if (site) {
      list = list.filter((s) => s.id !== site.id);
      selectedId = list[0]?.id ?? null;
    } else if (selectedFolder !== null) {
      const f = selectedFolder;
      for (const s of list) {
        if (s.folder === f) {
          s.folder = '';
        }
      }
      folders = folders.filter((x) => x !== f);
      selectedFolder = null;
    }
  }

  async function browseKey() {
    if (site && isTauri()) {
      const file = await open({ multiple: false, directory: false });
      if (typeof file === 'string') {
        site.keyfile = file;
      }
    }
  }

  async function browseLocal() {
    if (site && isTauri()) {
      const dir = await open({ multiple: false, directory: true, defaultPath: site.localDir || undefined });
      if (typeof dir === 'string') {
        site.localDir = dir;
      }
    }
  }

  async function save(): Promise<boolean> {
    try {
      for (const s of list) {
        const typed = passwords[s.id];
        if (s.logon !== 'normal' || savePassword[s.id] === false) {
          if (s.savedPassword) {
            await deleteSecret(siteSecretKey(s));
            s.savedPassword = false;
          }
        } else if (typed !== undefined && typed !== '' && savePassword[s.id] !== false) {
          await setSecret(siteSecretKey(s), typed);
          s.savedPassword = true;
        }
      }
      await sites.save(folders, $state.snapshot(list) as Site[]);
      // The connected site picks up its new settings (remote folder, sync folders).
      const current = connection.site && sites.list.find((x) => x.id === connection.site?.id);
      if (current) {
        connection.site = current;
        void sync.refresh();
      }
      return true;
    } catch (e) {
      error = String((e as Error).message ?? e);
      return false;
    }
  }

  async function ok() {
    if (await save()) {
      onClose();
    }
  }

  async function connect() {
    const s = site;
    if (!s || !s.host.trim()) {
      return;
    }
    if (await save()) {
      const saved = sites.list.find((x) => x.id === s.id) ?? s;
      // A password typed here but not saved still works for this connection.
      connection.pickedSite = { site: saved, password: passwords[s.id] || undefined };
      onClose();
    }
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }

  const port = (v: string) => (v.trim() === '' ? undefined : Number(v));

  // Top-level entries of the site's repository, for "Folders to sync".
  let topLevel = $state<{ name: string; dir: boolean }[]>([]);
  $effect(() => {
    const dir = site?.localDir.trim() ?? '';
    topLevel = [];
    if (!dir || tab !== 'sync') {
      return;
    }
    git
      .tree(dir, 'HEAD')
      .then((files) => {
        const seen = new Map<string, boolean>();
        for (const f of files) {
          const i = f.path.indexOf('/');
          const name = i < 0 ? f.path : f.path.slice(0, i);
          seen.set(name, (seen.get(name) ?? false) || i >= 0);
        }
        topLevel = [...seen.entries()]
          .map(([name, isDir]) => ({ name, dir: isDir }))
          .filter((e) => !e.name.startsWith('.git'))
          .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
      })
      .catch(() => (topLevel = []));
  });

  function toggleSyncPath(s: Site, name: string, on: boolean) {
    const current = new Set(s.syncPaths ?? []);
    if (on) {
      current.add(name);
    } else {
      current.delete(name);
    }
    s.syncPaths = [...current].sort();
  }

  /** A pasted "ftp://user@host:21/dir" fills protocol, user, host, port and remote folder. */
  function tidyHost(s: Site) {
    const a = splitAddress(s.host);
    if (!a) {
      return;
    }
    if (a.protocol && (protocols as string[]).includes(a.protocol)) {
      s.protocol = a.protocol as Protocol;
    }
    s.host = a.host;
    if (a.port) {
      s.port = a.port;
    }
    if (a.user && !s.user) {
      s.user = a.user;
    }
    if (a.path && a.path !== '/' && !s.remoteDir.trim()) {
      s.remoteDir = a.path;
    }
  }
</script>

<div class="backdrop">
  <div class="window" role="dialog" aria-modal="true" aria-label={t('sites.title')} tabindex="-1" {onkeydown}>
    <header>
      <h2>{t('sites.title')}</h2>
      <button class="close" aria-label={t('common.cancel')} onclick={onClose}>✕</button>
    </header>
    <div class="body">
      <aside>
        <div class="section-label">{t('sites.sites')}</div>
        <div class="tree" role="tree" aria-label={t('sites.sites')}>
          {#each tree as node, i (node.site?.id ?? `folder:${node.folder}:${i}`)}
            {#if node.site}
              {@const s = node.site}
              <button
                class="node mono"
                class:nested={!!s.folder}
                class:selected={s.id === selectedId}
                role="treeitem"
                aria-selected={s.id === selectedId}
                onclick={() => ((selectedId = s.id), (selectedFolder = null))}
                ondblclick={connect}>{s.name || s.host || '—'}</button
              >
            {:else}
              <button
                class="node folder"
                class:selected={node.folder === selectedFolder}
                role="treeitem"
                aria-selected={node.folder === selectedFolder}
                onclick={() => ((selectedFolder = node.folder), (selectedId = null))}>▾ {node.folder}</button
              >
            {/if}
          {:else}
            <p class="muted empty">{t('sites.empty')}</p>
          {/each}
        </div>
        <div class="tree-actions">
          <button class="control small" onclick={addSite}>{t('sites.new_site')}</button>
          <button class="control small" onclick={addFolder}>{t('sites.new_folder')}</button>
          <button class="control small" disabled={!site && selectedFolder === null} onclick={remove}>{t('common.remove')}</button>
        </div>
      </aside>

      <section class="editor">
        {#if site}
          <div class="tabs" role="tablist">
            {#each [['general', 'sites.tab.general'], ['advanced', 'sites.tab.advanced'], ['transfer', 'sites.tab.transfer'], ['sync', 'sites.tab.sync']] as [id, key] (id)}
              <button role="tab" class="tab" class:active={tab === id} aria-selected={tab === id} onclick={() => (tab = id as typeof tab)}>{t(key)}</button>
            {/each}
          </div>
          <div class="form">
            {#if tab === 'general'}
              <label><span>{t('sites.name')}</span><input class="field" bind:value={site.name} /></label>
              <label><span>{t('sites.folder')}</span>
                <Select bind:value={site.folder} options={[{ value: '', label: t('sites.no_folder') }, ...folders.map((f) => ({ value: f, label: f }))]} />
              </label>
              <label><span>{t('sites.protocol')}</span>
                <Select bind:value={site.protocol} options={protocols.map((p) => ({ value: p, label: t(`sites.protocol.${p}`) }))} />
              </label>
              <div class="row2">
                <label class="grow"><span>{t('files.connect.host')}</span><input class="field mono" bind:value={site.host} onblur={() => site && tidyHost(site)} onpaste={() => setTimeout(() => site && tidyHost(site))} /></label>
                <label class="small"><span>{t('files.connect.port')}</span>
                  <input class="field mono" inputmode="numeric" value={site.port ?? ''} oninput={(e) => (site.port = port(e.currentTarget.value))} />
                </label>
              </div>
              <label><span>{t('sites.logon')}</span>
                <Select bind:value={site.logon} options={(['normal', 'ask', 'key', 'anonymous'] as const).map((l) => ({ value: l, label: t(`sites.logon.${l}`) }))} />
              </label>
              {#if site.logon !== 'anonymous'}
                <label><span>{t('files.connect.user')}</span><input class="field mono" bind:value={site.user} /></label>
              {/if}
              {#if site.logon === 'normal'}
                <label><span>{t('files.connect.password')}</span>
                  <input
                    class="field mono"
                    type="password"
                    placeholder={site.savedPassword ? t('sites.password_saved') : ''}
                    value={passwords[site.id] ?? ''}
                    oninput={(e) => (passwords[site.id] = e.currentTarget.value)}
                  />
                </label>
                <div class="indent">
                  <Checkbox
                    bind:checked={() => savePassword[site.id] ?? true, (v) => (savePassword[site.id] = v)}
                    label={t('files.connect.remember')}
                    title={t('files.connect.remember_hint')}
                  />
                </div>
              {:else if site.logon === 'key'}
                <label><span>{t('sites.keyfile')}</span>
                  <span class="with-button"><input class="field mono" bind:value={site.keyfile} /><button class="control" onclick={browseKey}>{t('files.browse')}</button></span>
                </label>
              {/if}
              <label><span>{t('sites.remote_dir')}</span><input class="field mono" bind:value={site.remoteDir} placeholder="/" /></label>
              <label><span>{t('sites.local_dir')}</span>
                <span class="with-button"><input class="field mono" bind:value={site.localDir} /><button class="control" onclick={browseLocal}>{t('files.browse')}</button></span>
              </label>
            {:else if tab === 'advanced'}
              <label><span>{t('sites.timeout')}</span>
                <input class="field mono small-input" inputmode="numeric" value={site.timeout ?? ''} placeholder="20" oninput={(e) => (site.timeout = port(e.currentTarget.value))} />
              </label>
            {:else if tab === 'transfer'}
              <label><span>{t('sites.exists')}</span>
                <Select bind:value={site.exists} options={(['ask', 'overwrite', 'overwrite_newer', 'skip'] as const).map((a) => ({ value: a, label: t(`sites.exists.${a}`) }))} />
              </label>
              <label><span>{t('sites.pace')}</span>
                <Select
                  value={site.pace ?? 0}
                  options={[0, 100, 250, 500, 1000].map((ms) => ({ value: ms, label: ms ? `${ms} ms` : t('sites.pace.none') }))}
                  onchange={(v) => site && (site.pace = v)}
                />
              </label>
              <p class="muted note">{t('sites.pace_hint')}</p>
            {:else}
              <div class="section-label inline">{t('sites.tab.sync')}</div>
              <label><span>{t('sites.repo')}</span><input class="field mono" bind:value={site.repo} placeholder="owner/repository" /></label>
              <label><span>{t('sites.marker')}</span>
                <Select bind:value={site.marker} options={(['ask', 'on', 'off'] as const).map((m) => ({ value: m, label: t(`sites.marker.${m}`) }))} />
              </label>
              <label><span>{t('sites.post_sync')}</span><input class="field mono" bind:value={site.postSync} placeholder={t('sites.post_sync_hint')} /></label>
              <div class="section-label inline">{t('sites.sync_paths')}</div>
              {#if topLevel.length}
                {@const s = site}
                <p class="muted note">{(s.syncPaths ?? []).length ? t('sites.sync_paths_some', { count: (s.syncPaths ?? []).length }) : t('sites.sync_paths_all')}</p>
                <div class="sync-paths">
                  {#each topLevel as e (e.name)}
                    <Checkbox
                      bind:checked={() => (s.syncPaths ?? []).includes(e.name), (on) => toggleSyncPath(s, e.name, on)}
                      label={e.dir ? `${e.name}/` : e.name}
                    />
                  {/each}
                </div>
              {:else}
                <p class="muted note">{t('sites.sync_paths_no_repo')}</p>
              {/if}
            {/if}
          </div>
        {:else if selectedFolder !== null}
          {@const f = selectedFolder}
          <div class="form">
            <label><span>{t('sites.folder_name')}</span>
              <input class="field" value={f} onchange={(e) => renameFolder(f, e.currentTarget.value)} />
            </label>
          </div>
        {:else}
          <p class="muted hint">{t('sites.pick')}</p>
        {/if}
      </section>
    </div>
    <footer>
      {#if error}<span class="status-removed error" title={error}>{error}</span>{/if}
      <span class="spacer"></span>
      <button class="control" disabled={!site || !site.host.trim()} onclick={connect}>{t('common.connect')}</button>
      <button class="control primary" onclick={ok}>{t('common.ok')}</button>
      <button class="control" onclick={onClose}>{t('common.cancel')}</button>
    </footer>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgb(0 0 0 / 0.55);
    z-index: 10;
  }

  .window {
    width: 820px;
    height: 540px;
    max-width: calc(100vw - 32px);
    max-height: calc(100vh - 32px);
    display: flex;
    flex-direction: column;
    border: 1px solid var(--line-control);
    border-radius: 6px;
    background: var(--panel);
    outline: none;
  }

  header,
  footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    flex: none;
  }

  header {
    border-bottom: 1px solid var(--line);
  }

  footer {
    border-top: 1px solid var(--line);
  }

  h2 {
    flex: 1;
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-strong);
  }

  .close {
    border: 0;
    background: none;
    color: var(--muted);
    font: inherit;
    cursor: pointer;
  }

  .body {
    flex: 1;
    min-height: 0;
    display: flex;
  }

  aside {
    width: 240px;
    flex: none;
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--line);
  }

  .tree {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }

  .node {
    display: block;
    width: 100%;
    padding: 6px 14px;
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    font-size: 12.5px;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
  }

  .node.nested {
    padding-left: 30px;
  }

  .node.folder {
    color: var(--muted);
  }

  .node.selected {
    background: var(--selected-bg);
    box-shadow: inset 2px 0 0 var(--selected-mark);
    color: var(--text-strong);
  }

  .empty,
  .hint {
    padding: 12px 14px;
    margin: 0;
  }

  .tree-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 10px 12px;
    border-top: 1px solid var(--line);
  }

  .editor {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .tabs {
    display: flex;
    border-bottom: 1px solid var(--line);
    padding: 0 8px;
    flex: none;
  }

  .tab {
    height: 38px;
    padding: 0 12px;
    border: 0;
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: 12.5px;
    cursor: pointer;
  }

  .tab.active {
    color: var(--text-strong);
    box-shadow: inset 0 -2px 0 var(--selected-mark);
  }

  .form {
    flex: 1;
    overflow-y: auto;
    padding: 14px 18px;
  }

  label,
  .indent {
    display: flex;
    align-items: center;
    gap: 14px;
    min-height: 40px;
  }

  label > span:first-child {
    width: 130px;
    flex: none;
    color: var(--muted);
  }

  .indent {
    padding-left: 144px;
    min-height: 30px;
  }

  label .field {
    flex: 1;
    min-width: 0;
  }

  .row2 {
    display: flex;
    gap: 14px;
  }

  .row2 .grow {
    flex: 1;
  }

  .row2 .small span:first-child {
    width: auto;
  }

  .row2 .small .field {
    width: 70px;
    flex: none;
  }

  .note {
    margin: 4px 0 0 144px;
    font-size: 11.5px;
    line-height: 1.5;
  }

  .small-input {
    max-width: 90px;
  }

  .sync-paths {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 6px 12px;
    max-height: 180px;
    overflow: auto;
    font-family: var(--font-mono);
    font-size: 12px;
  }

  .with-button {
    flex: 1;
    display: flex;
    gap: 8px;
    min-width: 0;
  }

  .with-button .field {
    flex: 1;
    min-width: 0;
  }

  .section-label.inline {
    padding: 0 0 8px;
    border: 0;
  }

  .spacer {
    flex: 1;
  }

  .error {
    max-width: 50%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
