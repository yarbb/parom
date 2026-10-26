<script lang="ts">
  import { t } from '../lib/i18n';

  // Signed-out state (board So). Sign-in arrives with the GitHub tab (M4).
  let { name }: { name: string } = $props();
</script>

<div class="signed-out">
  <div class="card">
    <h1>{t('github.signed_out.title', { name })}</h1>
    <p class="muted">{t('github.signed_out.body', { name })}</p>
    <div class="actions">
      <button class="control primary" disabled>{t('github.sign_in_browser')}</button>
      <button class="control" disabled>{t('github.sign_in_token')}</button>
    </div>
    <p class="muted small">{t('github.signed_out.footer')}</p>
  </div>
</div>

<style>
  .signed-out {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
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
