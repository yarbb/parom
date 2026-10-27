<script lang="ts">
  import { t } from '../lib/i18n';
  import { ui } from '../lib/ui.svelte';

  // Board So (signed out), and the same card when no repository is chosen yet.
  interface Props {
    name: string;
    repoMissing?: boolean;
    onAddRepo?: () => void;
  }

  let { name, repoMissing = false, onAddRepo }: Props = $props();
</script>

<div class="signed-out">
  <div class="card">
    {#if repoMissing}
      <h1>{t('github.no_repo.title')}</h1>
      <p class="muted">{t('github.no_repo.body')}</p>
      <div class="actions">
        <button class="control primary" onclick={onAddRepo}>{t('github.add_repo')}</button>
      </div>
    {:else}
      <h1>{t('github.signed_out.title', { name })}</h1>
      <p class="muted">{t('github.signed_out.body', { name })}</p>
      <div class="actions">
        <button class="control primary" onclick={() => (ui.githubSignIn = 'browser')}>{t('github.sign_in_browser')}</button>
        <button class="control" onclick={() => (ui.githubSignIn = 'token')}>{t('github.sign_in_token')}</button>
      </div>
      <p class="muted small">{t('github.signed_out.footer')}</p>
    {/if}
  </div>
</div>

<style>
  .signed-out {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }

  .card {
    max-width: 420px;
  }

  h1 {
    margin: 0 0 8px;
    font-size: 16px;
    font-weight: 600;
    color: var(--text-strong);
  }

  p {
    margin: 0 0 16px;
    line-height: 1.5;
  }

  .actions {
    display: flex;
    gap: 8px;
    margin-bottom: 16px;
  }

  .small {
    font-size: 11.5px;
  }
</style>
