<script lang="ts">
  import { onMount } from 'svelte';
  import { isTauri } from '@tauri-apps/api/core';
  import { open } from '@tauri-apps/plugin-dialog';
  import { localJoin, type FileRow } from '../lib/files';
  import { t } from '../lib/i18n';
  import { listLocal, localHome, localRoots } from '../lib/local';
  import FileList from './FileList.svelte';

  interface Props {
    /** Current directory and separator, for downloads into it. */
    path?: string;
    separator?: string;
    canUpload: boolean;
    onUpload: (files: { name: string; local: string }[]) => void;
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

  export async function load(dir: string) {
    loading = true;
    error = '';
    try {
      const res = await listLocal(dir);
      path = res.path;
      parent = res.parent;
      separator = res.separator;
      rows = res.rows;
      atRoots = false;
      typed = res.path;
    } catch (e) {
      error = String(e);
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
    onUpload(files.filter((f) => !f.dir).map((f) => ({ name: f.name, local: localJoin(path, f.name, separator) })));
  }

  onMount(async () => {
    if (!isTauri()) {
      error = t('files.error.desktop_only');
      return;
    }
    roots = await localRoots();
    await load(await localHome());
  });
</script>

<section class="pane">
  <div class="section-label head">
    <span>{t('files.local')}</span>
    <span class="buttons">
      <button class="control small" onclick={browse} title={t('files.browse_hint')}>{t('files.browse')}</button>
      <button class="control small" disabled={!canUpload || !selected.some((r) => !r.dir)} onclick={() => upload(selected)}>
        {t('files.upload')} →
      </button>
    </span>
  </div>
  <form class="pathbar" onsubmit={(e) => (e.preventDefault(), typed && load(typed))}>
    <input class="field mono" aria-label={t('files.local_path')} bind:value={typed} />
  </form>
  <FileList
    label={t('files.local')}
    {rows}
    canGoUp={!atRoots && (parent !== null || roots.length > 1)}
    onUp={up}
    onOpenDir={(row) => load(atRoots ? row.name : localJoin(path, row.name, separator))}
    onActivate={upload}
    bind:selected
    {loading}
    {error}
    emptyText={t('files.empty')}
  />
</section>
