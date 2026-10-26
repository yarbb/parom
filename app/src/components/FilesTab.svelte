<script lang="ts">
  import { t } from '../lib/i18n';
  import type { EngineState } from '../lib/types';

  // Layout only for now: connecting and the file lists come with M1.4.
  let { engine }: { engine: EngineState } = $props();

  let host = $state('');
  let user = $state('');
  let password = $state('');
  let port = $state('');
</script>

<form class="connect" onsubmit={(e) => e.preventDefault()}>
  <input class="field mono host" placeholder={t('files.connect.host')} aria-label={t('files.connect.host')} bind:value={host} />
  <input class="field mono user" placeholder={t('files.connect.user')} aria-label={t('files.connect.user')} bind:value={user} />
  <input
    class="field mono password"
    type="password"
    placeholder={t('files.connect.password')}
    aria-label={t('files.connect.password')}
    bind:value={password}
  />
  <input
    class="field mono port"
    inputmode="numeric"
    placeholder={t('files.connect.port')}
    aria-label={t('files.connect.port')}
    bind:value={port}
  />
  <button class="control primary" type="submit" disabled={engine !== 'ready' || !host}>{t('common.connect')}</button>
</form>

<div class="panes">
  <section class="pane">
    <div class="section-label">{t('files.local')}</div>
  </section>
  <section class="pane">
    <div class="section-label">{t('files.remote')}</div>
  </section>
</div>

<style>
  .connect {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 16px;
    border-bottom: 1px solid var(--line);
    flex: none;
  }

  .host {
    width: 200px;
  }

  .user {
    width: 120px;
  }

  .password {
    width: 140px;
  }

  .port {
    width: 70px;
  }

  .panes {
    flex: 1;
    display: flex;
    min-height: 0;
  }

  .pane {
    flex: 1;
    min-width: 0;
    border-right: 1px solid var(--line);
  }

  .pane:last-child {
    border-right: 0;
  }
</style>
