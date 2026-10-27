<script lang="ts">
  import { onDestroy } from 'svelte';
  import { APP_INSTALL_URL, github, openGitHub, TOKEN_URL, type DeviceCode } from '../lib/github.svelte';
  import { t } from '../lib/i18n';
  import { ui } from '../lib/ui.svelte';
  import Modal from './Modal.svelte';

  // Board Dg (device code) and the personal access token dialog.
  let token = $state('');
  let error = $state('');
  let busy = $state(false);
  let code = $state<DeviceCode | null>(null);
  let copied = $state(false);
  let done = $state(false);
  /** Bumped to stop a running poll loop. */
  let attempt = 0;

  function close() {
    attempt++;
    ui.githubSignIn = '';
    token = '';
    error = '';
    code = null;
    copied = false;
    busy = false;
  }

  onDestroy(() => attempt++);

  $effect(() => {
    if (ui.githubSignIn === 'browser' && !code && !error) {
      void startDevice();
    }
  });

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function startDevice() {
    const mine = ++attempt;
    done = false;
    try {
      const c = await github.startDevice();
      if (mine !== attempt) {
        return;
      }
      code = c;
      let interval = c.interval;
      const until = Date.now() + c.expires_in * 1000;
      while (mine === attempt && Date.now() < until) {
        await sleep(interval * 1000);
        if (mine !== attempt) {
          return;
        }
        try {
          if (await github.pollDevice(c)) {
            done = true;
            return;
          }
        } catch (e) {
          const reason = String(e);
          if (reason === 'slow_down') {
            interval += 5;
          } else if (reason === 'access_denied') {
            error = t('github.device.denied');
            return;
          } else if (reason !== 'expired_token') {
            error = reason;
            return;
          } else {
            break;
          }
        }
      }
      if (mine === attempt) {
        error = t('github.device.expired');
      }
    } catch (e) {
      if (mine === attempt) {
        error = String(e);
      }
    }
  }

  async function copyCode() {
    if (code) {
      await navigator.clipboard.writeText(code.user_code).catch(() => {});
      copied = true;
    }
  }

  async function submitToken(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = '';
    try {
      await github.signInWithToken(token);
      close();
    } catch (err) {
      error = t('github.token.rejected', { reason: String(err) });
    } finally {
      busy = false;
    }
  }
</script>

{#if ui.githubSignIn === 'browser'}
  <Modal title={t('github.device.title')} onCancel={close}>
    {#if done}
      <p>{t('github.device.done', { login: github.user?.login ?? '' })}</p>
      <p class="muted">{t('github.device.install')}</p>
    {:else if error}
      <p class="status-removed">{error}</p>
    {:else if code}
      <p class="muted">{t('github.device.step1')}</p>
      <div class="code-row">
        <span class="mono code">{code.user_code}</span>
        <button class="control" onclick={copyCode}>{copied ? t('github.device.copied') : t('github.device.copy')}</button>
      </div>
      <p class="muted">{t('github.device.step2', { url: code.verification_uri.replace(/^https:\/\//, '') })}</p>
      <div class="code-row">
        <button class="control" onclick={() => (void copyCode(), openGitHub(code!.verification_uri))}>{t('github.device.open')}</button>
      </div>
      <p class="muted">{t('github.device.waiting')}</p>
    {:else}
      <p class="muted">{t('files.loading')}</p>
    {/if}
    {#snippet actions()}
      {#if done}
        <button class="control" onclick={() => openGitHub(APP_INSTALL_URL)}>{t('github.device.install_button')}</button>
        <button class="control primary" onclick={close}>{t('common.ok')}</button>
      {:else if error}
        <button class="control" onclick={close}>{t('common.cancel')}</button>
        <button class="control primary" onclick={() => ((error = ''), (code = null))}>{t('github.device.retry')}</button>
      {:else}
        <button class="control" onclick={close}>{t('common.cancel')}</button>
      {/if}
    {/snippet}
  </Modal>
{:else if ui.githubSignIn === 'token'}
  <Modal title={t('github.token.title')} onCancel={close}>
    <form id="github-token" onsubmit={submitToken}>
      <p class="muted">{t('github.token.body')}</p>
      <p class="muted mono small">{t('github.token.permissions')}</p>
      <p><button type="button" class="link" onclick={() => openGitHub(TOKEN_URL)}>{t('github.token.create')}</button></p>
      <input class="field mono wide" type="password" autocomplete="off" placeholder="github_pat_…" aria-label={t('github.token.label')} bind:value={token} />
      {#if error}<p class="status-removed error">{error}</p>{/if}
    </form>
    {#snippet actions()}
      <button class="control" onclick={close}>{t('common.cancel')}</button>
      <button class="control primary" type="submit" form="github-token" disabled={busy || !token.trim()}>
        {busy ? t('github.token.checking') : t('github.sign_in')}
      </button>
    {/snippet}
  </Modal>
{/if}

<style>
  p {
    margin: 0 0 10px;
  }

  .code-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 14px;
  }

  .code {
    font-size: 22px;
    letter-spacing: 0.12em;
    color: var(--text-strong);
  }

  .wide {
    width: 100%;
  }

  .small {
    font-size: 11.5px;
  }

  .error {
    margin-top: 10px;
    word-break: break-word;
  }

  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--text-strong);
    font: inherit;
    text-decoration: underline;
    cursor: pointer;
  }
</style>
