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

  interface Certificate {
    subject: string;
    issuer: string;
    alt_names: string[];
    fingerprint_sha256: string;
    valid_from: string;
    valid_until: string;
    self_signed: boolean;
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
  {:else if r.type === 'certificate'}
    {@const leaf = (r.certificates as Certificate[] | undefined)?.[0]}
    <Modal title={t('dialog.cert.title')} onCancel={() => reply(r, { trust: false })}>
      <p>{t('dialog.cert.body', { host: String(r.host), port: String(r.port) })}</p>
      <ul class="warnings status-modified">
        {#if r.hostname_mismatch}<li>{t('dialog.cert.mismatch')}</li>{/if}
        {#if leaf?.self_signed}<li>{t('dialog.cert.self_signed')}</li>{/if}
        {#if leaf && Date.parse(leaf.valid_until) < Date.now()}<li>{t('dialog.cert.expired')}</li>{/if}
        {#if leaf && Date.parse(leaf.valid_from) > Date.now()}<li>{t('dialog.cert.not_yet_valid')}</li>{/if}
        {#if r.weak_algorithms}<li>{t('dialog.cert.weak')}</li>{/if}
      </ul>
      {#if leaf}
        <dl class="details">
          <dt>{t('dialog.cert.subject')}</dt>
          <dd class="mono">{leaf.subject}{leaf.alt_names.length ? ` (${leaf.alt_names.join(', ')})` : ''}</dd>
          <dt>{t('dialog.cert.issuer')}</dt>
          <dd class="mono">{leaf.issuer}</dd>
          <dt>{t('dialog.cert.valid')}</dt>
          <dd class="mono">{leaf.valid_from.slice(0, 10)} – {leaf.valid_until.slice(0, 10)}</dd>
          <dt>{t('dialog.cert.fingerprint')}</dt>
          <dd class="mono fingerprint">{leaf.fingerprint_sha256}</dd>
          <dt>{t('dialog.cert.connection')}</dt>
          <dd class="mono">{r.tls} · {r.cipher}</dd>
        </dl>
      {/if}
      <p class="muted">{t('dialog.hostkey.hint')}</p>
      {#snippet actions()}
        <button class="control" onclick={() => reply(r, { trust: false })}>{t('common.cancel')}</button>
        <button class="control primary" onclick={() => reply(r, { trust: true })}>{t('dialog.hostkey.trust')}</button>
      {/snippet}
    </Modal>
  {:else if r.type === 'insecure_connection'}
    <Modal title={t('dialog.insecure.title')} onCancel={() => reply(r, { allow: false })}>
      <p>{t('dialog.insecure.body', { host: String(r.host), port: String(r.port) })}</p>
      <p class="status-modified">{t('dialog.insecure.warning')}</p>
      {#snippet actions()}
        <button class="control primary" onclick={() => reply(r, { allow: false })}>{t('common.cancel')}</button>
        <button class="control" onclick={() => reply(r, { allow: true })}>{t('dialog.insecure.allow')}</button>
      {/snippet}
    </Modal>
  {:else if r.type === 'tls_no_resumption'}
    <Modal title={t('dialog.resumption.title')} onCancel={() => reply(r, { allow: false })}>
      <p>{t('dialog.resumption.body', { host: String(r.host), port: String(r.port) })}</p>
      {#snippet actions()}
        <button class="control primary" onclick={() => reply(r, { allow: false })}>{t('common.cancel')}</button>
        <button class="control" onclick={() => reply(r, { allow: true })}>{t('dialog.resumption.allow')}</button>
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

  .warnings {
    margin: 0 0 10px;
    padding-left: 18px;
  }

  .warnings:empty {
    display: none;
  }

  .details {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 4px 12px;
    margin: 0 0 10px;
    font-size: 11.5px;
  }

  dt {
    color: var(--muted);
  }

  dd {
    margin: 0;
    word-break: break-all;
  }

  .prompt {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 10px;
  }
</style>
