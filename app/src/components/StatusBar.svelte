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

  .message {
    max-width: 50vw;
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
