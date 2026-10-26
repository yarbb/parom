<script lang="ts">
  import { onMount } from 'svelte';
  import { getVersion } from '@tauri-apps/api/app';
  import { isTauri } from '@tauri-apps/api/core';
  import { call } from '../lib/daemon';
  import { availableLocales, currentLocale, t } from '../lib/i18n';
  import { prefs, type Prefs } from '../lib/prefs.svelte';
  import Checkbox from './Checkbox.svelte';

  // Boards P1-P12. Pages whose features exist are live; the rest show their
  // settings disabled until the feature lands, so nothing pretends to work.
  let { onClose }: { onClose: () => void } = $props();

  type Page =
    | 'interface' | 'language' | 'file_lists' | 'file_editing'
    | 'sftp_keys' | 'transfers' | 'timeouts'
    | 'account' | 'repositories' | 'marker_history'
    | 'logging' | 'updates';

  const groups: { title: string; pages: Page[] }[] = [
    { title: 'prefs.group.general', pages: ['interface', 'language', 'file_lists', 'file_editing'] },
    { title: 'prefs.group.connection', pages: ['sftp_keys', 'transfers', 'timeouts'] },
    { title: 'prefs.group.github', pages: ['account', 'repositories'] },
    { title: 'prefs.group.sync', pages: ['marker_history'] },
    { title: 'prefs.group.advanced', pages: ['logging', 'updates'] },
  ];
  const pageKey: Record<Page, string> = {
    interface: 'prefs.interface', language: 'prefs.language', file_lists: 'prefs.file_lists', file_editing: 'prefs.file_editing',
    sftp_keys: 'prefs.sftp_keys', transfers: 'prefs.transfers', timeouts: 'prefs.timeouts',
    account: 'prefs.account', repositories: 'prefs.repositories', marker_history: 'prefs.marker_history',
    logging: 'prefs.logging', updates: 'prefs.updates',
  };
  const later: Partial<Record<Page, string>> = {
    file_editing: 'prefs.later.editing',
    account: 'prefs.later.github',
    repositories: 'prefs.later.github',
    marker_history: 'prefs.later.sync',
    logging: 'prefs.later.logging',
  };

  let page = $state<Page>('interface');
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

  onMount(() => {
    void loadTrusted();
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

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }

  const num = (v: string, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
  };
</script>

<div class="backdrop">
  <div class="window" role="dialog" aria-modal="true" aria-label={t('prefs.title')} tabindex="-1" {onkeydown}>
    <header>
      <h2>{t('prefs.title')}</h2>
      <button class="close" aria-label={t('common.cancel')} onclick={onClose}>✕</button>
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
            <select class="field" bind:value={draft.density}>
              <option value="comfortable">{t('prefs.density.comfortable')}</option>
              <option value="compact">{t('prefs.density.compact')}</option>
            </select>
          </label>
          <label class="row"><span>{t('prefs.size_units')}</span>
            <select class="field" bind:value={draft.sizeUnits}>
              <option value="binary">{t('prefs.size_units.binary')}</option>
              <option value="decimal">{t('prefs.size_units.decimal')}</option>
            </select>
          </label>
          <label class="row"><span>{t('prefs.font_size')}</span>
            <select class="field" bind:value={draft.fontScale}>
              {#each [90, 100, 110, 125, 150] as s (s)}<option value={s}>{s}%</option>{/each}
            </select>
          </label>
          <div class="row"><span></span><Checkbox bind:checked={draft.hideAddress} label={t('prefs.hide_address')} /></div>
          <div class="row"><span></span><Checkbox bind:checked={draft.showHidden} label={t('prefs.show_hidden')} /></div>
          <div class="row"><span>{t('prefs.accent')}</span><select class="field" disabled><option>{t('prefs.accent.neutral')}</option></select></div>
        {:else if page === 'language'}
          <label class="row"><span>{t('prefs.language')}</span>
            <select class="field" bind:value={draft.language}>
              {#each locales as l (l.code)}<option value={l.code}>{l.name}</option>{/each}
            </select>
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
            <select class="field" bind:value={draft.dateFormat}>
              <option value="short">Oct 26</option>
              <option value="iso">2026-10-26 12:04</option>
            </select>
          </label>
          <label class="row"><span>{t('prefs.double_click')}</span>
            <select class="field" bind:value={draft.doubleClick}>
              <option value="transfer">{t('prefs.double_click.transfer')}</option>
              <option value="nothing">{t('prefs.double_click.nothing')}</option>
            </select>
          </label>
          <div class="row"><span></span><Checkbox bind:checked={draft.rememberDirs} label={t('prefs.remember_dirs')} /></div>
          <div class="row"><span></span><Checkbox bind:checked={draft.showHidden} label={t('prefs.show_hidden')} /></div>
        {:else if page === 'file_editing'}
          <label class="row"><span>{t('prefs.default_editor')}</span><select class="field" disabled><option>{t('prefs.system_default')}</option></select></label>
          <div class="row"><span></span><Checkbox checked={true} disabled label={t('prefs.upload_on_save')} /></div>
        {:else if page === 'sftp_keys'}
          <div class="section-label inline">{t('prefs.trusted_hosts')}</div>
          {#each trusted as e (e.key)}
            <div class="row list-row">
              <span class="grow mono">{e.host}:{e.port} <span class="muted">{e.kind === 'ssh' ? 'SSH' : 'TLS'}</span></span>
              <span class="mono muted fp" title={e.fingerprint}>{e.fingerprint}</span>
              <button class="control small" onclick={() => forget(e)}>{t('prefs.forget')}</button>
            </div>
          {:else}
            <p class="muted">{t('prefs.no_trusted')}</p>
          {/each}
          <div class="row"><span></span><Checkbox checked={false} disabled label={t('prefs.ssh_agent')} /></div>
        {:else if page === 'transfers'}
          <label class="row"><span>{t('prefs.exists_default')}</span>
            <select class="field" bind:value={draft.existsDefault}>
              {#each ['ask', 'overwrite', 'overwrite_newer', 'skip'] as a (a)}<option value={a}>{t(`sites.exists.${a}`)}</option>{/each}
            </select>
          </label>
          <label class="row"><span>{t('prefs.simultaneous')}</span><select class="field" disabled><option>1</option></select></label>
          <div class="row"><span></span><Checkbox checked={false} disabled label={t('prefs.temp_upload')} /></div>
        {:else if page === 'timeouts'}
          <label class="row"><span>{t('prefs.connect_timeout')}</span>
            <input class="field mono short" inputmode="numeric" value={draft.connectTimeout} oninput={(e) => (draft.connectTimeout = num(e.currentTarget.value, 20))} />
            <span class="muted">{t('prefs.seconds')}</span>
          </label>
        {:else if page === 'account' || page === 'repositories'}
          <div class="row"><span>{t('prefs.sign_in_method')}</span><select class="field" disabled><option>{t('github.sign_in_browser')}</option></select></div>
        {:else if page === 'marker_history'}
          <div class="row"><span></span><Checkbox checked={true} disabled label={t('prefs.create_marker')} /></div>
          <div class="row"><span></span><Checkbox checked={true} disabled label={t('prefs.backup_first')} /></div>
        {:else if page === 'logging'}
          <div class="row"><span></span><Checkbox checked={true} disabled label={t('prefs.write_log')} /></div>
        {:else if page === 'updates'}
          <div class="row"><span>{t('prefs.current_version')}</span><span class="mono">v{version}</span></div>
          <p class="muted">{t('prefs.updates_source')}</p>
        {/if}
      </section>
    </div>
    <footer>
      {#if error}<span class="status-removed error" title={error}>{error}</span>{/if}
      <span class="spacer"></span>
      <button class="control" onclick={onClose}>{t('common.cancel')}</button>
      <button class="control" onclick={apply}>{t('common.apply')}</button>
      <button class="control primary" onclick={ok}>{t('common.ok')}</button>
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
    height: 560px;
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

  select.field {
    height: 28px;
  }
</style>
