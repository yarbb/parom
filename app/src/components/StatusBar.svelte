<script lang="ts">
  interface Props {
    state: string;
    error?: boolean;
    ok?: boolean;
    /** Latest engine message (status line, error, failing server reply). */
    message?: { level: string; text: string } | null;
    version: string;
  }

  let { state, error = false, ok = false, message = null, version }: Props = $props();
</script>

<footer class="mono muted">
  <span class="side"><span class:status-removed={error} class:status-new={ok} aria-hidden="true">●</span> {state}</span>
  <span class="message" class:status-removed={message?.level === 'error' || message?.level === 'reply'} title={message?.text ?? ''}>
    {message?.text ?? ''}
  </span>
  <span class="side right">{version}</span>
</footer>

<style>
  footer {
    height: 24px;
    flex: none;
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 0 14px;
    border-top: 1px solid var(--line);
    font-size: 11px;
  }

  .side {
    flex: none;
    white-space: nowrap;
  }

  .message {
    flex: 1;
    min-width: 0;
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
