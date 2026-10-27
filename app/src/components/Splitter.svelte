<script lang="ts">
  // A thin handle between two areas. Dragging it reports how far the mouse
  // moved (px) along its axis; double-click asks for the default size.
  interface Props {
    /** "x": a vertical bar that resizes widths; "y": a horizontal bar for heights. */
    axis: 'x' | 'y';
    onMove: (delta: number) => void;
    onEnd?: () => void;
    onReset?: () => void;
    label: string;
  }

  let { axis, onMove, onEnd, onReset, label }: Props = $props();
  let last = 0;
  let dragging = $state(false);

  function down(e: PointerEvent) {
    if (e.button !== 0) {
      return;
    }
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    last = axis === 'x' ? e.clientX : e.clientY;
    dragging = true;
  }

  function move(e: PointerEvent) {
    if (!dragging) {
      return;
    }
    const now = axis === 'x' ? e.clientX : e.clientY;
    if (now !== last) {
      onMove(now - last);
      last = now;
    }
  }

  function up() {
    if (dragging) {
      dragging = false;
      onEnd?.();
    }
  }
</script>

<div
  class="splitter {axis}"
  class:dragging
  role="separator"
  aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
  aria-label={label}
  title={label}
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
  ondblclick={() => onReset?.()}
></div>

<style>
  .splitter {
    flex: none;
    position: relative;
    z-index: 2;
    background: transparent;
  }

  .splitter.x {
    width: 5px;
    margin: 0 -2px;
    cursor: col-resize;
  }

  .splitter.y {
    height: 5px;
    margin: -2px 0;
    cursor: row-resize;
  }

  .splitter:hover,
  .splitter.dragging {
    background: var(--line-control);
  }
</style>
