<script lang="ts">
  import { onMount } from 'svelte';
  import { getVersion } from '@tauri-apps/api/app';
  import { isTauri } from '@tauri-apps/api/core';
  import { open as openDialog } from '@tauri-apps/plugin-dialog';
  import { call } from '../lib/daemon';
  import { availableLocales, currentLocale, t } from '../lib/i18n';
  import { prefs, type Prefs } from '../lib/prefs.svelte';
  import Checkbox from './Checkbox.svelte';
  import Select from './Select.svelte';
  import Ferry from './Ferry.svelte';
  import { fly } from 'svelte/transition';
  import { ms } from '../lib/motion';
  import Modal from './Modal.svelte';
  import { sites } from '../lib/sites.svelte';
  import { host } from '../lib/sync/host';
  import { openInEditor } from '../lib/local';
  import { APP_INSTALL_URL, github, openGitHub } from '../lib/github.svelte';
  import { repo } from '../lib/repo.svelte';
  import { ui } from '../lib/ui.svelte';

  // Boards P1-P12. Pages whose features exist are live; the rest show their
  // settings disabled until the feature lands, so nothing pretends to work.
  let { onClose }: { onClose: () => void } = $props();

  type Page =
    | 'interface' | 'language' | 'file_lists' | 'file_editing'
    | 'sftp_keys' | 'transfers' | 'timeouts'
    | 'account' | 'repositories' | 'marker_history'
    | 'logging' | 'updates' | 'shortcuts';

  const groups: { title: string; pages: Page[] }[] = [
    { title: 'prefs.group.general', pages: ['interface', 'language', 'file_lists', 'file_editing'] },
    { title: 'prefs.group.connection', pages: ['sftp_keys', 'transfers', 'timeouts'] },
    { title: 'prefs.group.github', pages: ['account', 'repositories'] },
    { title: 'prefs.group.sync', pages: ['marker_history'] },
    { title: 'prefs.group.advanced', pages: ['shortcuts', 'logging', 'updates'] },
  ];
  const pageKey: Record<Page, string> = {
    interface: 'prefs.interface', language: 'prefs.language', file_lists: 'prefs.file_lists', file_editing: 'prefs.file_editing',
    sftp_keys: 'prefs.sftp_keys', transfers: 'prefs.transfers', timeouts: 'prefs.timeouts',
    account: 'prefs.account', repositories: 'prefs.repositories', marker_history: 'prefs.marker_history',
    logging: 'prefs.logging', updates: 'prefs.updates', shortcuts: 'prefs.shortcuts',
  };
  const later: Partial<Record<Page, string>> = {
    logging: 'prefs.later.logging',
  };

  let page = $state<Page>((ui.preferencesPage as Page | null) ?? 'interface');
  ui.preferencesPage = null;
  const accents = ['neutral', 'blue', 'green', 'purple', 'orange', 'pink', 'teal'] as const;
  /** Dark-theme shade of each accent, for the little sample next to the list. */
  const swatch: Record<(typeof accents)[number], string> = {
    neutral: 'var(--text-strong)',
    blue: '#4f9dff',
    green: '#3fb950',
    purple: '#a78bfa',
    orange: '#f0883e',
    pink: '#f472b6',
    teal: '#2dd4bf',
  };
  let customEditor = $state(prefs.value.editorPath !== '');

  async function browseEditor() {
    if (isTauri()) {
      const file = await openDialog({ multiple: false, directory: false });
      if (typeof file === 'string') {
        draft.editorPath = file;
      }
    }
  }
  let draft = $state<Prefs>({ ...prefs.value });
  let error = $state('');
  let version = $state('');
  const locales = availableLocales();

  interface TrustEntry {
    key: string;
    kind: string;
    host: string;
    port: number;
    fingerprint: string;
  }
  let trusted = $state<TrustEntry[]>([]);

  async function loadTrusted() {
    try {
      trusted = (await call<{ entries: TrustEntry[] }>('trust.list')).entries;
    } catch {
      trusted = [];
    }
  }

  async function forget(entry: TrustEntry) {
    await call('trust.forget', { key: entry.key }).catch(() => {});
    await loadTrusted();
  }

  let historyFolder = $state('');
  let defaultBackups = $state('');

  async function browseBackups() {
    if (isTauri()) {
      const dir = await openDialog({ multiple: false, directory: true, defaultPath: draft.backupDir || defaultBackups || undefined });
      if (typeof dir === 'string') {
        draft.backupDir = dir;
      }
    }
  }

  /** The marker choice per site is saved right away, like the Site Manager. */
  async function setMarker(id: string, marker: 'ask' | 'on' | 'off') {
    await sites.save(sites.folders, sites.list.map((s) => (s.id === id ? { ...s, marker } : s))).catch((e) => (error = String(e)));
  }

  onMount(() => {
    void loadTrusted();
    if (isTauri()) {
      void host.paths().then((p) => ((historyFolder = p.history), (defaultBackups = p.backups))).catch(() => {});
    }
    if (isTauri()) {
      void getVersion().then((v) => (version = v));
    }
  });

  async function apply(): Promise<boolean> {
    const languageChanged = draft.language !== currentLocale();
    try {
      await prefs.save($state.snapshot(draft) as Prefs);
      error = '';
    } catch (e) {
      error = String((e as Error).message ?? e);
      return false;
    }
    if (languageChanged) {
      // Messages are formatted at render time; a reload redraws everything in the new language.
      location.reload();
    }
    return true;
  }

  async function ok() {
    if (await apply()) {
      onClose();
    }
  }

  // Closing with unsaved changes asks first (Escape, the cross, a click outside).
  let confirmClose = $state(false);
  const dirty = () => JSON.stringify($state.snapshot(draft)) !== JSON.stringify($state.snapshot(prefs.value));

  function requestClose() {
    if (dirty()) {
      confirmClose = true;
    } else {
      onClose();
    }
  }

  let pressedOutside = false;

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && !confirmClose) {
      e.preventDefault();
      requestClose();
    }
  }

  /** Every shortcut, for the Keyboard shortcuts page. */
  const shortcuts: [string, string][] = [
    ['Ctrl+S', 'menu.site_manager'],
    ['Ctrl+,', 'menu.preferences'],
    ['Ctrl+1 / Ctrl+2', 'prefs.keys.tabs'],
    ['Ctrl+L', 'log.title'],
    ['Ctrl+R', 'menu.reconnect'],
    ['Ctrl+D', 'common.disconnect'],
    ['Ctrl+= / Ctrl+- / Ctrl+0', 'prefs.keys.zoom'],
    ['Enter', 'prefs.keys.enter'],
    ['Backspace', 'prefs.keys.up'],
    ['F2', 'fileop.rename.title'],
    ['Delete', 'prefs.keys.delete'],
    ['F5', 'files.refresh'],
    ['Ctrl+A', 'menu.select_all'],
    ['Shift / Ctrl + click', 'prefs.keys.select'],
    ['Shift + drag', 'prefs.keys.move'],
    ['Escape', 'prefs.keys.escape'],
  ];

  const num = (v: string, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
  };
</script>

<div
  class="backdrop"
  role="presentation"
  onmousedown={(e) => (pressedOutside = e.target === e.currentTarget)}
  onclick={(e) => e.target === e.currentTarget && pressedOutside && requestClose()}
>
  <div class="window" role="dialog" aria-modal="true" aria-label={t('prefs.title')} tabindex="-1" {onkeydown}>
    <header>
      <h2>{t('prefs.title')}</h2>
      <button class="close" aria-label={t('common.cancel')} onclick={requestClose}>✕</button>
    </header>
    <div class="body">
      <nav>
        {#each groups as g (g.title)}
          <div class="group">{t(g.title)}</div>
          {#each g.pages as p (p)}
            <button class="page" class:active={page === p} onclick={() => (page = p)}>{t(pageKey[p])}</button>
          {/each}
        {/each}
      </nav>
      <section class="content">
        {#key page}
        <div in:fly={{ y: 6, duration: ms(180) }}>
        <h3>{t(pageKey[page])}</h3>
        {#if later[page]}
          <p class="muted note">{t(later[page]!)}</p>
        {/if}

        {#if page === 'interface'}
          <div class="row"><span>{t('prefs.theme')}</span>
            <span class="segmented">
              {#each ['dark', 'light', 'system'] as th (th)}
                <button class:on={draft.theme === th} onclick={() => (draft.theme = th as Prefs['theme'])}>{t(`prefs.theme.${th}`)}</button>
              {/each}
            </span>
          </div>
          <label class="row"><span>{t('prefs.density')}</span>
            <Select bind:value={draft.density} options={[{ value: 'comfortable', label: t('prefs.density.comfortable') }, { value: 'compact', label: t('prefs.density.compact') }]} />
          </label>
          <label class="row"><span>{t('prefs.size_units')}</span>
            <Select bind:value={draft.sizeUnits} options={[{ value: 'binary', label: t('prefs.size_units.binary') }, { value: 'decimal', label: t('prefs.size_units.decimal') }]} />
          </label>
          <label class="row"><span>{t('prefs.font_size')}</span>
            <Select bind:value={draft.fontScale} options={[80, 90, 100, 110, 125, 150, 175].map((s) => ({ value: s, label: `${s}%` }))} />
          </label>
          <div class="row"><span></span><Checkbox bind:checked={draft.hideAddress} label={t('prefs.hide_address')} /></div>
          <label class="row"><span>{t('prefs.hide_style')}</span>
            <Select bind:value={draft.hideStyle} options={[{ value: 'blur', label: t('prefs.hide_style.blur') }, { value: 'text', label: t('prefs.hide_style.text') }]} />
          </label>
          <div class="row"><span></span><Checkbox bind:checked={draft.showHidden} label={t('prefs.show_hidden')} /></div>
          <div class="row"><span></span><Checkbox bind:checked={draft.snapLayouts} label={t('prefs.snap_layouts')} /></div>
          <label class="row"><span>{t('prefs.accent')}</span>
            <Select bind:value={draft.accent} options={accents.map((a) => ({ value: a, label: t(`prefs.accent.${a}`) }))} />
            <span class="swatch" style:background={swatch[draft.accent]} aria-hidden="true"></span>
          </label>
        {:else if page === 'language'}
          <label class="row"><span>{t('prefs.language')}</span>
            <Select bind:value={draft.language} options={locales.map((l) => ({ value: l.code, label: l.name }))} />
          </label>
          <div class="section-label inline">{t('prefs.translations')}</div>
          {#each locales as l (l.code)}
            <div class="row list-row"><span class="grow">{l.name}</span><span class="muted mono">{l.code === 'en' ? t('prefs.built_in') : `${l.coverage}%`}</span></div>
          {/each}
          <div class="row"><span></span><button class="control" disabled>{t('prefs.check_translations')}</button></div>
        {:else if page === 'file_lists'}
          <div class="row"><span></span><Checkbox bind:checked={draft.foldersFirst} label={t('prefs.folders_first')} /></div>
          <div class="row"><span></span><Checkbox bind:checked={draft.caseSensitive} label={t('prefs.case_sensitive')} /></div>
          <label class="row"><span>{t('prefs.date_format')}</span>
            <Select bind:value={draft.dateFormat} options={[{ value: 'short', label: 'Oct 26' }, { value: 'iso', label: '2026-10-26 12:04' }]} />
          </label>
          <label class="row"><span>{t('prefs.double_click')}</span>
            <Select bind:value={draft.doubleClick} options={[{ value: 'transfer', label: t('prefs.double_click.transfer') }, { value: 'nothing', label: t('prefs.double_click.nothing') }]} />
          </label>
          <div class="row"><span></span><Checkbox bind:checked={draft.rememberDirs} label={t('prefs.remember_dirs')} /></div>
          <div class="row"><span></span><Checkbox bind:checked={draft.showHidden} label={t('prefs.show_hidden')} /></div>
          <div class="row"><span></span><Checkbox bind:checked={draft.forwardSlashes} label={t('prefs.forward_slashes')} /></div>
          <div class="row"><span></span><Checkbox bind:checked={draft.markTwins} label={t('prefs.mark_twins')} /></div>
          <div class="row"><span></span><Checkbox bind:checked={draft.warnSharedServer} label={t('prefs.warn_shared')} /></div>
        {:else if page === 'file_editing'}
          <div class="row"><span>{t('prefs.default_editor')}</span>
            <span class="segmented">
              <button class:on={!customEditor} onclick={() => ((customEditor = false), (draft.editorPath = ''))}>{t('prefs.system_default')}</button>
              <button class:on={customEditor} onclick={() => (customEditor = true)}>{t('prefs.custom_editor')}</button>
            </span>
          </div>
          {#if customEditor}
            <label class="row"><span>{t('prefs.custom_editor_path')}</span>
              <input class="field mono grow" bind:value={draft.editorPath} />
              <button class="control" onclick={browseEditor}>{t('files.browse')}</button>
            </label>
          {/if}
          <div class="row"><span></span><Checkbox bind:checked={draft.editUploadOnSave} label={t('prefs.upload_on_save')} /></div>
          <div class="row"><span></span><Checkbox bind:checked={draft.editAsk} disabled={!draft.editUploadOnSave} label={t('prefs.edit_ask')} /></div>
        {:else if page === 'sftp_keys'}
          <div class="section-label inline">{t('prefs.trusted_hosts')}</div>
          {#each trusted as e (e.key)}
            <div class="row list-row">
              <span class="grow mono">{e.host}:{e.port} <span class="muted">{e.kind === 'ssh' ? 'SSH' : e.kind === 'tls' ? 'TLS' : t('prefs.plain_ftp')}</span></span>
              <span class="mono muted fp" title={e.fingerprint}>{e.fingerprint}</span>
              <button class="control small" onclick={() => forget(e)}>{t('prefs.forget')}</button>
            </div>
          {:else}
            <p class="muted">{t('prefs.no_trusted')}</p>
          {/each}
          <div class="row"><span></span><Checkbox checked={false} disabled label={t('prefs.ssh_agent')} /></div>
        {:else if page === 'transfers'}
          <label class="row"><span>{t('prefs.exists_default')}</span>
            <Select bind:value={draft.existsDefault} options={(['ask', 'overwrite', 'overwrite_newer', 'skip'] as const).map((a) => ({ value: a, label: t(`sites.exists.${a}`) }))} />
          </label>
          <label class="row"><span>{t('prefs.simultaneous')}</span>
            <Select bind:value={draft.simultaneous} options={[1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }))} />
          </label>
          <p class="muted">{t('prefs.simultaneous_hint')}</p>
          <div class="row"><span></span><Checkbox checked={false} disabled label={t('prefs.temp_upload')} /></div>
        {:else if page === 'timeouts'}
          <label class="row"><span>{t('prefs.connect_timeout')}</span>
            <input class="field mono short" inputmode="numeric" value={draft.connectTimeout} oninput={(e) => (draft.connectTimeout = num(e.currentTarget.value, 20))} />
            <span class="muted">{t('prefs.seconds')}</span>
          </label>
          <div class="row"><span></span><Checkbox bind:checked={draft.autoReconnect} label={t('prefs.auto_reconnect')} /></div>
        {:else if page === 'account'}
          {#if github.user}
            <div class="row">
              <span>{t('prefs.signed_in_as')}</span>
              <span class="mono grow">@{github.user.login}{github.user.name ? ` (${github.user.name})` : ''}</span>
              <button class="control" onclick={() => github.signOut()}>{t('github.sign_out')}</button>
            </div>
            {#if github.user.kind === 'app'}
              <div class="row"><span></span><button class="control" onclick={() => openGitHub(APP_INSTALL_URL)}>{t('github.install_app')}</button></div>
            {/if}
          {:else}
            <p class="muted">{t('prefs.signed_out')}</p>
            <div class="row">
              <span></span>
              <button class="control primary" onclick={() => (ui.githubSignIn = 'browser')}>{t('github.sign_in_browser')}</button>
              <button class="control" onclick={() => (ui.githubSignIn = 'token')}>{t('github.sign_in_token')}</button>
            </div>
          {/if}
          <p class="muted">{t('prefs.token_storage')}</p>
        {:else if page === 'repositories'}
          {#each repo.choices as c (c.dir)}
            <div class="row list-row">
              <span class="mono grow path" title={c.dir}>{c.dir}</span>
              {#if c.site}
                <span class="muted">{t('prefs.repo_site', { site: c.site })}</span>
              {:else}
                <button class="control small" onclick={() => repo.remove(c.dir)}>{t('common.remove')}</button>
              {/if}
            </div>
          {:else}
            <p class="muted">{t('prefs.no_repos')}</p>
          {/each}
          {#if prefs.value.hiddenRepos.length}
            <div class="section-label inline">{t('prefs.hidden_repos')}</div>
            {#each prefs.value.hiddenRepos as dir (dir)}
              <div class="row list-row">
                <span class="mono grow path" title={dir}>{dir}</span>
                <button class="control small" onclick={() => repo.unhide(dir)}>{t('prefs.show_again')}</button>
              </div>
            {/each}
          {/if}
          <p class="muted">{t('prefs.repos_hint')}</p>
        {:else if page === 'marker_history'}
          <div class="row"><span></span><Checkbox bind:checked={draft.syncScanEdits} label={t('prefs.scan_edits')} /></div>
          <div class="row"><span></span><Checkbox bind:checked={draft.syncLock} label={t('prefs.lock_server')} /></div>
          <div class="row"><span></span><Checkbox bind:checked={draft.syncBackup} label={t('prefs.backup_first')} /></div>
          <div class="row"><span></span><Checkbox bind:checked={draft.syncCloseIssues} label={t('prefs.close_issues')} /></div>
          <label class="row"><span>{t('prefs.backup_keep')}</span>
            <Select bind:value={draft.backupKeep} options={[1, 3, 5, 10, 20].map((n) => ({ value: n, label: String(n) }))} />
          </label>
          <label class="row"><span>{t('prefs.backup_folder')}</span>
            <input class="field mono grow" placeholder={defaultBackups} bind:value={draft.backupDir} />
            <button class="control" onclick={browseBackups}>{t('files.browse')}</button>
          </label>
          <div class="row"><span></span><Checkbox bind:checked={draft.syncPreview} label={t('prefs.sync_preview')} /></div>
          <div class="section-label inline">{t('prefs.ask_before_sync')}</div>
          <div class="row"><span></span><Checkbox bind:checked={draft.syncAskVersionsDiffer} label={t('prefs.ask_versions_differ')} /></div>
          <div class="row"><span></span><Checkbox bind:checked={draft.syncAskSomeoneElse} label={t('prefs.ask_someone_else')} /></div>
          <div class="row"><span></span><Checkbox bind:checked={draft.syncAskLocalOnly} label={t('prefs.ask_local_only')} /></div>
          <div class="section-label inline">{t('prefs.known_servers')}</div>
          {#each sites.list as s (s.id)}
            <label class="row list-row">
              <span class="grow">{s.name}</span>
              <Select
                value={s.marker}
                options={(['ask', 'on', 'off'] as const).map((m) => ({ value: m, label: t(`sites.marker.${m}`) }))}
                onchange={(v) => setMarker(s.id, v)}
              />
            </label>
          {:else}
            <p class="muted">{t('sites.empty')}</p>
          {/each}
          <div class="row"><span>{t('prefs.history_folder')}</span>
            <span class="mono grow path">{historyFolder}</span>
            <button class="control small" disabled={!historyFolder} onclick={() => openInEditor(historyFolder, '')}>{t('backups.open')}</button>
          </div>
        {:else if page === 'logging'}
          <div class="row"><span></span><Checkbox checked={true} disabled label={t('prefs.write_log')} /></div>
        {:else if page === 'shortcuts'}
          <dl class="keys">
            {#each shortcuts as [keys, what] (keys)}
              <dt class="mono">{keys}</dt>
              <dd>{t(what)}</dd>
            {/each}
          </dl>
          <p class="muted">{t('prefs.keys.later')}</p>
        {:else if page === 'updates'}
          <div class="row"><span>{t('prefs.current_version')}</span><span class="mono">v{version}</span></div>
          <p class="muted">{t('prefs.updates_source')}</p>
        {/if}
        </div>
        {/key}
      </section>
    </div>
    <footer>
      <Ferry />
      {#if error}<span class="status-removed error" title={error}>{error}</span>{/if}
      <span class="spacer"></span>
      <button class="control" onclick={onClose}>{t('common.cancel')}</button>
      <button class="control" onclick={apply}>{t('common.apply')}</button>
      <button class="control primary" onclick={ok}>{t('common.ok')}</button>
    </footer>
  </div>
</div>

{#if confirmClose}
  <Modal title={t('prefs.unsaved.title')} onCancel={() => (confirmClose = false)}>
    <p>{t('prefs.unsaved.body')}</p>
    {#snippet actions()}
      <button class="control" onclick={() => (confirmClose = false)}>{t('common.cancel')}</button>
      <button class="control" onclick={() => ((confirmClose = false), onClose())}>{t('prefs.unsaved.discard')}</button>
      <button class="control primary" onclick={() => ((confirmClose = false), ok())}>{t('prefs.unsaved.save')}</button>
    {/snippet}
  </Modal>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgb(0 0 0 / 0.55);
    z-index: 10;
    animation: fade-in var(--motion) ease-out;
  }

  .keys {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 6px 18px;
    margin: 0 0 14px;
  }

  .keys dt {
    color: var(--text-strong);
  }

  .keys dd {
    margin: 0;
  }

  .window {
    width: 820px;
    height: 560px;
    max-width: calc(100vw - 32px);
    max-height: calc(100vh - 32px);
    display: flex;
    flex-direction: column;
    border: 1px solid var(--line-control);
    border-radius: 6px;
    background: var(--panel);
    outline: none;
    animation: pop-in var(--motion) ease-out;
    box-shadow: 0 16px 48px rgb(0 0 0 / 0.45);
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

  h3 {
    margin: 0 0 12px;
    font-size: 13px;
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

  nav {
    width: 200px;
    flex: none;
    overflow-y: auto;
    padding: 6px 0;
    border-right: 1px solid var(--line);
  }

  .group {
    padding: 12px 16px 4px;
    color: var(--muted);
    font-size: 10.5px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .page {
    display: block;
    width: 100%;
    padding: 7px 16px;
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    font-size: 12.5px;
    text-align: left;
    cursor: pointer;
  }

  .page {
    transition:
      background-color var(--motion-fast),
      color var(--motion-fast);
  }

  .page:hover:not(.active) {
    background: color-mix(in srgb, var(--selected-bg) 60%, transparent);
  }

  .page.active {
    background: var(--selected-bg);
    box-shadow: inset 2px 0 0 var(--selected-mark);
    color: var(--text-strong);
  }

  .content {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    padding: 16px 20px;
  }

  .note {
    margin: 0 0 12px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 14px;
    min-height: 40px;
    border-bottom: 1px solid var(--line-row);
  }

  .row > span:first-child {
    width: 200px;
    flex: none;
    color: var(--muted);
  }

  .list-row > span:first-child {
    width: auto;
    color: var(--text);
  }

  .grow {
    flex: 1;
    min-width: 0;
  }

  .path {
    font-size: 11.5px;
    word-break: break-all;
  }

  .fp {
    max-width: 260px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row .field {
    min-width: 200px;
  }

  .row .short {
    min-width: 0;
    width: 70px;
  }

  .segmented {
    display: inline-flex;
    border: 1px solid var(--line-control);
    border-radius: 4px;
    overflow: hidden;
  }

  .segmented button {
    height: 28px;
    padding: 0 14px;
    border: 0;
    border-right: 1px solid var(--line-control);
    background: var(--panel);
    color: var(--text);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  .segmented button:last-child {
    border-right: 0;
  }

  .segmented button.on {
    background: var(--primary-bg);
    color: var(--primary-fg);
    font-weight: 600;
  }

  .section-label.inline {
    padding: 14px 0 6px;
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

  .swatch {
    width: 14px;
    height: 14px;
    flex: none;
    border-radius: 50%;
    border: 1px solid var(--line-control);
  }
</style>
