<script lang="ts">
  // Under a pane's list, like FileZilla's second list: what is inside the
  // folder clicked last, without opening it. On the server side listings come
  // from the session's cache, else one listing after a short pause (no request
  // per click).
  import FileList from './FileList.svelte';
  import Splitter from './Splitter.svelte';
  import { type FileRow } from '../lib/files';
  import { prefs } from '../lib/prefs.svelte';
  import { t } from '../lib/i18n';

  interface Props {
    /** The folder to show; null until one is clicked. */
    path: string | null;
    /** The folder open in the list above (a double-click there needs no preview listing). */
    current: string;
    /** The folder's rows (`fresh`: not from a cache); null when it cannot be read. */
    list: (path: string, fresh: boolean) => Promise<FileRow[] | null>;
    join: (dir: string, name: string) => string;
    /** Opens a folder in the list above. */
    onOpen: (path: string) => void;
    /** Enter or double-click on files: transfer them. */
    onActivate: (rows: FileRow[], dir: string) => void;
    /** Folders not listed yet (server side). */
    unscanned?: (path: string) => boolean;
    /** Preference that turns this panel off. */
    pref: 'localPreview' | 'serverPreview';
    /** Tallest the panel may get (the list above keeps room). */
    max: number;
  }

  let { path, current, list, join, onOpen, onActivate, unscanned, pref, max }: Props = $props();
  /** One height for both panes' panels, so they line up. */
  const height = $derived(Math.max(60, Math.min(prefs.value.previewHeight, max)));

  let rows = $state<FileRow[]>([]);
  let shown = $state<string | null>(null);
  let loading = $state(false);
  let failed = $state(false);
  let selected = $state<FileRow[]>([]);
  let gen = 0;

  async function load(target: string, fresh: boolean) {
    const mine = ++gen;
    loading = true;
    const got = await list(target, fresh).catch(() => null);
    if (mine !== gen) {
      return;
    }
    loading = false;
    failed = got === null;
    rows = got ?? [];
    shown = target;
  }

  $effect(() => {
    const target = path;
    if (target === null) {
      gen++;
      rows = [];
      shown = null;
      loading = false;
      return;
    }
    const timer = setTimeout(() => target !== current && void load(target, false), 250);
    return () => clearTimeout(timer);
  });

  const name = $derived(shown ? shown.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || shown : null);
</script>

<Splitter
  axis="y"
  label={t('ui.resize')}
  onMove={(d) => (prefs.value.previewHeight = Math.max(60, Math.min(max, height - d)))}
  onEnd={() => prefs.persist()}
  onReset={() => prefs.set('previewHeight', 180)}
/>
<div class="preview" style:height="{height}px">
  <div class="section-label head">
    <span title={shown ?? ''}>{t('preview.title')}{#if name}<span class="picked mono">{name}</span>{/if}</span>
    <span class="buttons">
      <button class="control small" disabled={!shown || loading} onclick={() => shown && load(shown, true)}>{t('files.refresh')}</button>
      <button class="control small" title={t('preview.hide_hint')} aria-label={t('preview.hide')} onclick={() => prefs.set(pref, false)}>×</button>
    </span>
  </div>
  <FileList
    label={t('preview.title')}
    {rows}
    canGoUp={false}
    onUp={() => {}}
    onOpenDir={(row) => shown && onOpen(join(shown, row.name))}
    onActivate={(picked) => shown && onActivate(picked, shown)}
    folder={shown ?? ''}
    unscanned={unscanned && ((row) => row.dir && !!shown && unscanned(join(shown, row.name)))}
    bind:selected
    {loading}
    error={failed ? t('preview.failed') : ''}
    emptyText={shown ? t('files.empty') : t('preview.hint')}
  />
</div>

<style>
  .preview {
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: none;
  }
</style>
