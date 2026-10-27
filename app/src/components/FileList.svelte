<script lang="ts">
  import { untrack } from 'svelte';
  import {
    clickSelection,
    formatFullTime,
    formatSize,
    formatTime,
    sortRows,
    visibleRange,
    type FileRow,
    type Sort,
    type SortKey,
  } from '../lib/files';
  import { t } from '../lib/i18n';
  import { prefs } from '../lib/prefs.svelte';
  import FolderUp from '@lucide/svelte/icons/folder-up';
  import FileIcon from './FileIcon.svelte';
  import { dragThreshold, paneDrag, type PaneSide } from '../lib/panedrag.svelte';
  import { outsideWindow } from '../lib/dragout';

  interface Props {
    rows: FileRow[];
    /** Shows a ".." row that calls onUp. */
    canGoUp: boolean;
    onUp: () => void;
    onOpenDir: (row: FileRow) => void;
    /** Enter or double-click on files (e.g. transfer them). */
    onActivate: (rows: FileRow[]) => void;
    selected?: FileRow[];
    loading?: boolean;
    error?: string;
    emptyText?: string;
    label: string;
    /** Right click: the rows it applies to (empty for the blank area). */
    onContextMenu?: (e: MouseEvent, rows: FileRow[]) => void;
    /** F2, Delete and F5 on the selection. */
    /** F2, Delete (Shift+Delete: without asking) and F5 on the selection. */
    onCommand?: (command: 'rename' | 'delete' | 'refresh', rows: FileRow[], quick?: boolean) => void;
    /** Rows can be dragged to the other pane. */
    dragFrom?: PaneSide;
    /** The folder shown: a new listing of the same folder keeps scroll and selection. */
    folder?: string;
    /** Folders not listed yet in this session (shown with a "?"). */
    unscanned?: (row: FileRow) => boolean;
    /** Colour label of a folder, if any. */
    labelOf?: (row: FileRow) => string | null;
    /** A row drag started (e.g. to prepare server files for dragging out). */
    onDragStart?: (rows: FileRow[]) => void;
    /** A row drag left the window: hand the rows to the system's drag and drop. */
    onDragOut?: (rows: FileRow[]) => void;
  }

  let {
    rows,
    canGoUp,
    onUp,
    onOpenDir,
    onActivate,
    selected = $bindable([]),
    loading = false,
    error = '',
    emptyText = '',
    label,
    onContextMenu,
    onCommand,
    dragFrom,
    folder = '',
    unscanned,
    labelOf,
    onDragStart,
    onDragOut,
  }: Props = $props();

  // Only the rows in view are in the DOM, so 100k entries stay cheap.
  let rowHeight = $derived(prefs.value.density === 'compact' ? 24 : 30);
  let decimal = $derived(prefs.value.sizeUnits === 'decimal');
  let iso = $derived(prefs.value.dateFormat === 'iso');

  let sort = $state<Sort>({ key: 'name', desc: false });
  let shown = $derived(prefs.value.showHidden ? rows : rows.filter((r) => !r.name.startsWith('.')));
  let sorted = $derived(
    sortRows(shown, sort, { foldersFirst: prefs.value.foldersFirst, caseSensitive: prefs.value.caseSensitive }),
  );
  let offset = $derived(canGoUp ? 1 : 0);
  let count = $derived(sorted.length + offset);

  let viewport: HTMLDivElement;
  let scrollTop = $state(0);
  let height = $state(0);
  let range = $derived(visibleRange(scrollTop, height, rowHeight, count));
  let indices = $derived(Array.from({ length: range.end - range.start }, (_, k) => range.start + k));

  let selection = $state(new Set<number>());
  let anchor: number | null = null;
  let focusIndex = $state(-1);

  // Rows that appeared or changed in a new listing of the same folder.
  let flashing = $state(new Set<string>());
  let flashTimer: ReturnType<typeof setTimeout> | null = null;
  let previous: { folder: string; rows: Map<string, string>; selected: Set<string> } | null = null;
  const stamp = (r: FileRow) => `${r.dir}:${r.size}:${r.time}`;

  // A new listing or sort order invalidates indexes. The same folder again
  // (refresh, after an upload or a new folder) keeps its place.
  $effect(() => {
    const rows = sorted;
    const now = new Map(rows.map((r) => [r.name, stamp(r)]));
    const same = previous !== null && previous.folder === folder;
    const keep = same ? previous!.selected : new Set<string>();
    const fresh = same && previous!.rows.size ? rows.filter((r) => previous!.rows.get(r.name) !== stamp(r)).map((r) => r.name) : [];
    untrack(() => {
      selection = new Set(rows.flatMap((r, i) => (keep.has(r.name) ? [i + offset] : [])));
      anchor = null;
      focusIndex = -1;
      if (viewport && !same) {
        viewport.scrollTop = 0;
        scrollTop = 0;
      }
      if (fresh.length && fresh.length < 50) {
        flashing = new Set(fresh);
        if (flashTimer) {
          clearTimeout(flashTimer);
        }
        flashTimer = setTimeout(() => (flashing = new Set()), 1400);
        // Bring the first new row into view: new names are often off screen.
        const first = rows.findIndex((r) => r.name === fresh[0]);
        if (viewport && first >= 0) {
          const top = (first + offset) * rowHeight;
          if (top < viewport.scrollTop || top + rowHeight > viewport.scrollTop + height) {
            viewport.scrollTop = Math.max(0, top - height / 3);
            scrollTop = viewport.scrollTop;
          }
        }
      }
    });
    previous = { folder, rows: now, selected: new Set() };
  });

  $effect(() => {
    const names = new Set([...selection].filter((i) => i >= offset && i < count).map((i) => sorted[i - offset]?.name));
    if (previous) {
      previous.selected = names as Set<string>;
    }
  });

  $effect(() => {
    selected = [...selection].filter((i) => i >= offset && i < count).map((i) => sorted[i - offset]);
  });

  const rowAt = (i: number): FileRow | null => (i < offset ? null : sorted[i - offset]);

  function setSort(key: SortKey) {
    sort = sort.key === key ? { key, desc: !sort.desc } : { key, desc: false };
  }

  function open(i: number) {
    const row = rowAt(i);
    if (!row) {
      onUp();
    } else if (row.dir) {
      onOpenDir(row);
    } else if (prefs.value.doubleClick === 'transfer') {
      onActivate([row]);
    }
  }

  function reveal(i: number) {
    const top = i * rowHeight;
    if (top < viewport.scrollTop) {
      viewport.scrollTop = top;
    } else if (top + rowHeight > viewport.scrollTop + height) {
      viewport.scrollTop = top + rowHeight - height;
    }
  }

  function click(e: MouseEvent, i: number) {
    selection = clickSelection(selection, anchor, i, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey });
    if (!e.shiftKey) {
      anchor = i;
    }
    focusIndex = i;
    viewport.focus();
  }

  const rowsOf = (set: Set<number>) => [...set].filter((i) => i >= offset && i < count).map((i) => sorted[i - offset]);

  function contextMenu(e: MouseEvent, i: number | null) {
    if (!onContextMenu) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (i === null) {
      selection = new Set();
      onContextMenu(e, []);
      return;
    }
    if (!selection.has(i)) {
      selection = new Set([i]);
      anchor = i;
    }
    focusIndex = i;
    viewport.focus();
    onContextMenu(e, rowsOf(selection));
  }

  function move(to: number, extend: boolean) {
    if (count === 0) {
      return;
    }
    const i = Math.max(0, Math.min(count - 1, to));
    selection = extend && anchor !== null ? clickSelection(selection, anchor, i, { ctrl: false, shift: true }) : new Set([i]);
    if (!extend) {
      anchor = i;
    }
    focusIndex = i;
    reveal(i);
  }

  function onkeydown(e: KeyboardEvent) {
    const page = Math.max(1, Math.floor(height / rowHeight) - 1);
    switch (e.key) {
      case 'ArrowDown':
        move(focusIndex + 1, e.shiftKey);
        break;
      case 'ArrowUp':
        move(focusIndex < 0 ? 0 : focusIndex - 1, e.shiftKey);
        break;
      case 'PageDown':
        move(focusIndex + page, e.shiftKey);
        break;
      case 'PageUp':
        move(focusIndex - page, e.shiftKey);
        break;
      case 'Home':
        move(0, e.shiftKey);
        break;
      case 'End':
        move(count - 1, e.shiftKey);
        break;
      case 'Backspace':
        if (canGoUp) {
          onUp();
        }
        break;
      case 'F2':
        if (selected.length === 1) {
          onCommand?.('rename', selected);
        }
        break;
      case 'Delete':
        if (selected.length) {
          onCommand?.('delete', selected, e.shiftKey);
        }
        break;
      case 'F5':
        onCommand?.('refresh', selected);
        break;
      case 'Enter': {
        const files = selected.filter((r) => !r.dir);
        if (selected.length === 1 && selected[0].dir) {
          onOpenDir(selected[0]);
        } else if (files.length) {
          onActivate(files);
        } else if (focusIndex === 0 && canGoUp) {
          onUp();
        }
        break;
      }
      case 'a':
        if (e.ctrlKey || e.metaKey) {
          selection = new Set(Array.from({ length: sorted.length }, (_, k) => k + offset));
          break;
        }
        return;
      default:
        return;
    }
    e.preventDefault();
  }

  // A press on a row becomes a drag once the mouse moves a few pixels.
  let pressed: { x: number; y: number; i: number } | null = null;

  function press(e: MouseEvent, i: number) {
    if (dragFrom && e.button === 0 && i >= offset && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      pressed = { x: e.clientX, y: e.clientY, i };
    }
  }

  function onWindowMove(e: MouseEvent) {
    if (paneDrag.active) {
      if (paneDrag.active.from === dragFrom) {
        if (onDragOut && outsideWindow(e.clientX, e.clientY)) {
          // Out of the window: the system's drag takes over from here.
          const rows = paneDrag.active.rows;
          paneDrag.active = null;
          paneDrag.over = null;
          onDragOut(rows);
          return;
        }
        paneDrag.move(e.clientX, e.clientY, e.shiftKey);
      }
      return;
    }
    if (!pressed || !dragFrom) {
      return;
    }
    if (!(e.buttons & 1)) {
      pressed = null;
      return;
    }
    if (Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) < dragThreshold) {
      return;
    }
    if (!selection.has(pressed.i)) {
      selection = new Set([pressed.i]);
      anchor = pressed.i;
      focusIndex = pressed.i;
    }
    pressed = null;
    const dragged = rowsOf(selection);
    if (dragged.length) {
      paneDrag.active = { from: dragFrom, rows: dragged, x: e.clientX, y: e.clientY, move: e.shiftKey };
      paneDrag.move(e.clientX, e.clientY, e.shiftKey);
      onDragStart?.(dragged);
    }
  }

  function onWindowUp() {
    pressed = null;
    if (paneDrag.active && paneDrag.active.from === dragFrom) {
      paneDrag.end();
    }
  }

  const arrow = (key: SortKey) => (sort.key === key ? (sort.desc ? ' ↓' : ' ↑') : '');
</script>

<svelte:window
  onmousemove={onWindowMove}
  onmouseup={onWindowUp}
  onkeydown={(e) => e.key === 'Shift' && paneDrag.active && (paneDrag.active.move = true)}
  onkeyup={(e) => e.key === 'Shift' && paneDrag.active && (paneDrag.active.move = false)}
/>

<div class="list">
  <div class="header muted">
    <button class="col name" onclick={() => setSort('name')}>{t('files.name')}{arrow('name')}</button>
    <button class="col size" onclick={() => setSort('size')}>{t('files.size')}{arrow('size')}</button>
    <button class="col time" onclick={() => setSort('time')}>{t('files.modified')}{arrow('time')}</button>
  </div>
  <div
    class="viewport"
    role="listbox"
    aria-label={label}
    aria-multiselectable="true"
    tabindex="0"
    bind:this={viewport}
    bind:clientHeight={height}
    onscroll={() => (scrollTop = viewport.scrollTop)}
    oncontextmenu={(e) => contextMenu(e, null)}
    {onkeydown}
  >
    {#key folder}
    <div class="spacer" style:height="{count * rowHeight}px">
      {#each indices as i (i)}
        {@const row = rowAt(i)}
        <div
          class="row"
          class:selected={selection.has(i)}
          class:flash={!!row && flashing.has(row.name)}
          class:focused={focusIndex === i}
          role="option"
          tabindex="-1"
          aria-selected={selection.has(i)}
          style:transform="translateY({i * rowHeight}px)"
          style:height="{rowHeight}px"
          onmousedown={(e) => press(e, i)}
          onclick={(e) => click(e, i)}
          ondblclick={() => open(i)}
          oncontextmenu={(e) => (i < offset ? e.preventDefault() : contextMenu(e, i))}
          onkeydown={() => {}}
        >
          {#if row}
            <span class="col name mono" title={row.name}><FileIcon name={row.name} dir={row.dir} link={row.link} unknown={!!unscanned?.(row)} color={row.dir ? (labelOf?.(row) ?? null) : null} /><span class="label">{row.name}</span></span>
            <span class="col size mono muted">{row.dir ? '' : formatSize(row.size, decimal)}</span>
            <span class="col time mono muted" title={formatFullTime(row.time)}>{formatTime(row.time, Date.now(), iso)}</span>
          {:else}
            <span class="col name mono"><span class="file-icon-up" aria-hidden="true"><FolderUp size={14} strokeWidth={1.6} /></span><span class="label">..</span></span>
          {/if}
        </div>
      {/each}
    </div>
    {/key}
    {#if loading || error || (count === 0 && emptyText)}
      <div class="overlay" class:status-removed={!!error}>
        {loading ? t('files.loading') : error || emptyText}
      </div>
    {/if}
  </div>
</div>

<style>
  .list {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .header {
    display: flex;
    gap: 10px;
    height: 26px;
    padding: 0 14px;
    border-bottom: 1px solid var(--line-row);
    flex: none;
  }

  .header button {
    border: 0;
    padding: 0;
    background: none;
    color: inherit;
    font: inherit;
    font-size: 11px;
    text-align: left;
    cursor: pointer;
  }

  .viewport {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    position: relative;
    outline: none;
  }

  .spacer {
    position: relative;
  }

  .spacer {
    animation: fade-in var(--motion) ease-out;
  }

  .row {
    transition:
      background-color var(--motion-fast),
      box-shadow var(--motion-fast);
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    height: 30px;
    padding: 0 14px;
    border-bottom: 1px solid var(--line-row);
    font-size: 12px;
    cursor: default;
    user-select: none;
  }

  .row.selected {
    background: var(--selected-bg);
    box-shadow: inset 2px 0 0 var(--selected-mark);
    color: var(--text-strong);
  }

  .viewport:focus-visible .row.focused {
    outline: 1px dotted var(--muted);
    outline-offset: -1px;
  }

  .col {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .name {
    flex: 1;
    min-width: 0;
  }

  .row.flash {
    animation: flash 1.4s ease-out;
  }

  .row .name {
    display: flex;
    align-items: center;
    gap: 7px;
  }

  .row .name .label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .file-icon-up {
    display: inline-flex;
    flex: none;
    color: var(--muted);
  }

  .size {
    width: 70px;
    text-align: right;
    flex: none;
  }

  .header .size {
    text-align: right;
  }

  .time {
    width: 110px;
    flex: none;
  }

  .overlay {
    position: absolute;
    top: 40px;
    left: 0;
    right: 0;
    text-align: center;
    color: var(--muted);
    pointer-events: none;
  }
</style>
