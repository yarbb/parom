<script lang="ts" module>
  /** The issue being written survives closing the dialog (cleared once created). */
  const saved = $state({ title: '', body: '', labels: [] as string[] });
</script>

<script lang="ts">
  import IssueLabel from './IssueLabel.svelte';
  import { onMount } from 'svelte';
  import { t } from '../lib/i18n';
  import { createIssue, listLabels, renderMarkdown, type Item, type Label } from '../lib/issues.svelte';
  import Checkbox from './Checkbox.svelte';
  import Markdown from './Markdown.svelte';
  import MarkdownEditor from './MarkdownEditor.svelte';
  import Modal from './Modal.svelte';

  // New issue: title, Markdown body with a preview GitHub renders, labels.
  let { slug, onClose, onCreated }: { slug: string; onClose: () => void; onCreated: (issue: Item) => void } = $props();

  let labels = $state<Label[]>([]);
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
      preview = saved.body.trim() ? await renderMarkdown(slug, saved.body) : '';
    } catch (e) {
      error = String(e);
    }
  }

  function toggle(name: string, on: boolean) {
    saved.labels = on ? [...saved.labels, name] : saved.labels.filter((n) => n !== name);
  }

  async function submit(e?: SubmitEvent) {
    e?.preventDefault();
    if (!saved.title.trim() || busy) {
      return;
    }
    busy = true;
    error = '';
    try {
      const issue = await createIssue(slug, { title: saved.title.trim(), body: saved.body, labels: saved.labels });
      saved.title = '';
      saved.body = '';
      saved.labels = [];
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
    <input class="field wide-field" placeholder={t('github.new_issue.name')} aria-label={t('github.new_issue.name')} bind:value={saved.title} />
    {#if preview === null}
      <MarkdownEditor bind:value={saved.body} rows={9} placeholder={t('github.new_issue.body')} />
    {:else}
      <div class="preview">
        {#if preview}<Markdown html={preview} text={saved.body} />{:else}<span class="muted">{t('github.no_description')}</span>{/if}
      </div>
    {/if}
    {#if labels.length}
      <div class="label-title">{t('github.new_issue.labels')}</div>
      <div class="labels">
        {#each labels as l (l.name)}
          <Checkbox bind:checked={() => saved.labels.includes(l.name), (on) => toggle(l.name, on)} label={l.name}>
            <IssueLabel name={l.name} color={l.color} />
          </Checkbox>
        {/each}
      </div>
    {/if}
    {#if error}<p class="status-removed error">{error}</p>{/if}
  </form>
  {#snippet actions()}
    <button class="control" type="button" onclick={showPreview}>{preview === null ? t('github.new_issue.preview') : t('github.new_issue.write')}</button>
    <span class="grow"></span>
    <button class="control" type="button" onclick={onClose}>{t('common.cancel')}</button>
    <button class="control primary" type="submit" form="new-issue" disabled={busy || !saved.title.trim()}>{t('github.new_issue.create')}</button>
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
