<script lang="ts">
  import { t } from '../lib/i18n';

  interface Props {
    state: string;
    error?: boolean;
    ok?: boolean;
    /** Part of `state` to blur (the server address when it is hidden). */
    secret?: string | null;
    /** Latest engine message (status line, error, failing server reply). */
    message?: { level: string; text: string } | null;
    version: string;
    /** Opens or closes the message log. */
    onLog?: () => void;
    logOpen?: boolean;
    /** Transfers in the queue, for its button while the log is open (0: no button). */
    queued?: number;
    queueOpen?: boolean;
    onQueue?: () => void;
  }

  let { state, secret = null, error = false, ok = false, message = null, version, onLog, logOpen = false, queued = 0, queueOpen = false, onQueue }: Props = $props();
  const parts = $derived(secret && state.includes(secret) ? state.split(secret) : null);
  const logLabel = $derived(t('log.title'));
</script>

<footer class="mono muted">
  <span class="side"><span class:status-removed={error} class:status-new={ok} aria-hidden="true">●</span>
    {#if parts}{parts[0]}<span class="secret">{secret}</span>{parts.slice(1).join(secret ?? "")}{:else}{state}{/if}</span
  >
  <span class="message" class:status-removed={message?.level === 'error' || message?.level === 'reply'} title={message?.text ?? ''}>
    {logOpen ? '' : (message?.text ?? '')}
  </span>
  <span class="side right">
    {#if onQueue && queued}
      <button class="log-button mono" class:open={queueOpen} onclick={onQueue}>{t('queue.button', { count: queued })}</button>
    {/if}
    {#if onLog}<button class="log-button mono" class:open={logOpen} onclick={onLog}>{logLabel}</button>{/if}
    {version}
  </span>
</footer>

<style>
  /* Equal outer columns keep the message centred in the window. */
  footer {
    height: 24px;
    flex: none;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, auto) minmax(0, 1fr);
    align-items: center;
    gap: 16px;
    padding: 0 14px;
    border-top: 1px solid var(--line);
    font-size: 11px;
  }

  .side {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .right {
    text-align: right;
  }

  .log-button {
    margin-right: 12px;
    padding: 0 6px;
    border: 1px solid var(--line-control);
    border-radius: 3px;
    background: none;
    color: var(--muted);
    font-size: 10.5px;
    cursor: pointer;
  }

  .log-button.open,
  .log-button:hover {
    color: var(--text-strong);
  }

  .message {
    max-width: 50vw;
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
