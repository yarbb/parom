<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../lib/i18n';
  import { createIssue, listLabels, renderMarkdown, type Item, type Label } from '../lib/issues.svelte';
  import Checkbox from './Checkbox.svelte';
  import Markdown from './Markdown.svelte';
  import Modal from './Modal.svelte';

  // New issue: title, Markdown body with a preview GitHub renders, labels.
  let { slug, onClose, onCreated }: { slug: string; onClose: () => void; onCreated: (issue: Item) => void } = $props();

  let title = $state('');
  let body = $state('');
  let labels = $state<Label[]>([]);
  let chosen = $state<string[]>([]);
  let preview = $state<string | null>(null);
  let busy = $state(false);
  let error = $state('');

  onMount(() => {
    listLabels(slug)
      .then((l) => (labels = l))
      .catch(() => (labels = []));
  });

  async function showPreview() {
    if (preview !== null) {
      preview = null;
      return;
    }
    try {
      preview = body.trim() ? await renderMarkdown(slug, body) : '';
    } catch (e) {
      error = String(e);
    }
  }

  function toggle(name: string, on: boolean) {
    chosen = on ? [...chosen, name] : chosen.filter((n) => n !== name);
  }

  async function submit(e?: SubmitEvent) {
    e?.preventDefault();
    if (!title.trim() || busy) {
      return;
    }
    busy = true;
    error = '';
    try {
      const issue = await createIssue(slug, { title: title.trim(), body, labels: chosen });
      onCreated(issue);
      onClose();
    } catch (err) {
      error = String(err);
    } finally {
      busy = false;
    }
  }
</script>

<Modal title={t('github.new_issue.title', { repo: slug })} wide onCancel={onClose}>
  <form id="new-issue" onsubmit={submit}>
    <input class="field wide-field" placeholder={t('github.new_issue.name')} aria-label={t('github.new_issue.name')} bind:value={title} />
    {#if preview === null}
      <textarea class="field body" rows="9" placeholder={t('github.new_issue.body')} aria-label={t('github.new_issue.body')} bind:value={body}></textarea>
    {:else}
      <div class="preview">
        {#if preview}<Markdown html={preview} text={body} />{:else}<span class="muted">{t('github.no_description')}</span>{/if}
      </div>
    {/if}
    {#if labels.length}
      <div class="label-title">{t('github.new_issue.labels')}</div>
      <div class="labels">
        {#each labels as l (l.name)}
          <Checkbox bind:checked={() => chosen.includes(l.name), (on) => toggle(l.name, on)} label={l.name} />
        {/each}
      </div>
    {/if}
    {#if error}<p class="status-removed error">{error}</p>{/if}
  </form>
  {#snippet actions()}
    <button class="control" type="button" onclick={showPreview}>{preview === null ? t('github.new_issue.preview') : t('github.new_issue.write')}</button>
    <span class="grow"></span>
    <button class="control" type="button" onclick={onClose}>{t('common.cancel')}</button>
    <button class="control primary" type="submit" form="new-issue" disabled={busy || !title.trim()}>{t('github.new_issue.create')}</button>
  {/snippet}
</Modal>

<style>
  form {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .wide-field {
    width: 100%;
  }

  textarea.body {
    width: 100%;
    padding: 6px 9px;
    resize: vertical;
    border: 1px solid var(--line-control);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text);
    font-family: Consolas, 'Cascadia Code', ui-monospace, monospace;
    font-size: 12px;
  }

  .preview {
    min-height: 160px;
    max-height: 320px;
    overflow: auto;
    padding: 8px 10px;
    border: 1px solid var(--line);
    border-radius: 4px;
  }

  .label-title {
    color: var(--muted);
    font-size: 10.5px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .labels {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    max-height: 100px;
    overflow: auto;
  }

  .error {
    margin: 0;
    word-break: break-word;
  }

  .grow {
    flex: 1;
  }
</style>
