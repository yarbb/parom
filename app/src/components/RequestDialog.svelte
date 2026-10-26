<script lang="ts">
  import { connection, type EngineRequest } from '../lib/connection.svelte';
  import { formatSize } from '../lib/files';
  import { t } from '../lib/i18n';
  import Modal from './Modal.svelte';

  // Answers the oldest pending engine request; the rest wait their turn.
  let req = $derived<EngineRequest | undefined>(connection.requests[0]);

  let answers = $state<string[]>([]);
  let secret = $state('');

  $effect(() => {
    if (req) {
      answers = ((req.prompts as unknown[] | undefined) ?? []).map(() => '');
      secret = '';
    }
  });

  interface Prompt {
    prompt: string;
    echo: boolean;
  }

  let prompts = $derived((req?.prompts as Prompt[] | undefined) ?? []);

  const reply = (r: EngineRequest, fields: Record<string, unknown>) => connection.answer(r, fields);
</script>

{#if req}
  {@const r = req}
  {#if r.type === 'hostkey'}
    <Modal title={t('dialog.hostkey.title')} onCancel={() => reply(r, { trust: false })}>
      <p>{t('dialog.hostkey.body', { host: String(r.host), port: String(r.port) })}</p>
      <p class="mono fingerprint">{r.fingerprint}</p>
      <p class="muted">{t('dialog.hostkey.hint')}</p>
      {#snippet actions()}
        <button class="control" onclick={() => reply(r, { trust: false })}>{t('common.cancel')}</button>
        <button class="control primary" onclick={() => reply(r, { trust: true })}>{t('dialog.hostkey.trust')}</button>
      {/snippet}
    </Modal>
  {:else if r.type === 'password' || r.type === 'keyfile_password'}
    <Modal title={t(r.type === 'password' ? 'dialog.password.title' : 'dialog.keyfile.title')} onCancel={() => reply(r, {})}>
      <form id="secret-form" onsubmit={(e) => (e.preventDefault(), reply(r, { password: secret }))}>
        {#if r.file}<p class="mono">{r.file}</p>{/if}
        <input class="field mono wide" type="password" aria-label={t('files.connect.password')} bind:value={secret} />
      </form>
      {#snippet actions()}
        <button class="control" onclick={() => reply(r, {})}>{t('common.cancel')}</button>
        <button class="control primary" type="submit" form="secret-form">{t('common.ok')}</button>
      {/snippet}
    </Modal>
  {:else if r.type === 'interactive'}
    <Modal title={String(r.name || t('dialog.interactive.title'))} onCancel={() => reply(r, {})}>
      <form id="interactive-form" onsubmit={(e) => (e.preventDefault(), reply(r, { responses: answers }))}>
        {#if r.instruction}<p>{r.instruction}</p>{/if}
        {#each prompts as p, i (i)}
          <label class="prompt">
            <span>{p.prompt}</span>
            <input class="field mono wide" type={p.echo ? 'text' : 'password'} bind:value={answers[i]} />
          </label>
        {/each}
      </form>
      {#snippet actions()}
        <button class="control" onclick={() => reply(r, {})}>{t('common.cancel')}</button>
        <button class="control primary" type="submit" form="interactive-form">{t('common.ok')}</button>
      {/snippet}
    </Modal>
  {:else if r.type === 'file_exists'}
    <Modal title={t('dialog.exists.title')} onCancel={() => reply(r, { action: 'skip' })}>
      <p class="mono">{r.download ? r.local_file : `${r.remote_path}/${r.remote_file}`}</p>
      <p class="muted">
        {t('dialog.exists.sizes', {
          source: formatSize(Number(r.download ? r.remote_size : r.local_size)),
          target: formatSize(Number(r.download ? r.local_size : r.remote_size)),
        })}
      </p>
      {#snippet actions()}
        <button class="control" onclick={() => reply(r, { action: 'skip' })}>{t('dialog.exists.skip')}</button>
        <button class="control" onclick={() => reply(r, { action: 'overwrite_newer' })}>{t('dialog.exists.newer')}</button>
        <button class="control primary" onclick={() => reply(r, { action: 'overwrite' })}>{t('dialog.exists.overwrite')}</button>
      {/snippet}
    </Modal>
  {:else}
    <Modal title={t('dialog.unsupported.title')} onCancel={() => reply(r, {})}>
      <p>{t('dialog.unsupported.body', { type: r.type })}</p>
      {#snippet actions()}
        <button class="control primary" onclick={() => reply(r, {})}>{t('common.ok')}</button>
      {/snippet}
    </Modal>
  {/if}
{/if}

<style>
  p {
    margin: 0 0 10px;
    word-break: break-all;
  }

  .fingerprint {
    color: var(--text-strong);
  }

  .wide {
    width: 100%;
  }

  .prompt {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 10px;
  }
</style>
