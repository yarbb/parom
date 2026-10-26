<script lang="ts">
  interface Props {
    state: string;
    error?: boolean;
    version: string;
  }

  let { state, error = false, version }: Props = $props();
</script>

<footer class="mono muted">
  <span><span class:status-removed={error} aria-hidden="true">●</span> {state}</span>
  <span>{version}</span>
</footer>

<style>
  footer {
    height: 24px;
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 14px;
    border-top: 1px solid var(--line);
    font-size: 11px;
  }
</style>
