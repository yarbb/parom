// Dragging files out of the app (to Explorer, the desktop, other apps):
// the system's own drag through tauri-plugin-drag, started when a row drag
// leaves the window. Only existing files can be handed over, so server files
// are downloaded to a temp folder first.
import { Channel, invoke, isTauri } from '@tauri-apps/api/core';

/** A small label image for the drag cursor ("3 items"). */
function labelImage(text: string): string {
  const scale = window.devicePixelRatio || 1;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = `${12 * scale}px sans-serif`;
  const width = Math.ceil(ctx.measureText(text).width + 20 * scale);
  canvas.width = width;
  canvas.height = 26 * scale;
  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.roundRect(0, 0, width, canvas.height, 5 * scale);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = `${12 * scale}px sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 10 * scale, canvas.height / 2);
  return canvas.toDataURL('image/png');
}

/** Hands absolute file paths to the system's drag and drop (copy). */
export async function dragOut(paths: string[], label: string): Promise<void> {
  if (!isTauri() || !paths.length) {
    return;
  }
  const onEvent = new Channel<unknown>();
  await invoke('plugin:drag|start_drag', { item: paths, image: labelImage(label), options: { mode: 'copy' }, onEvent });
}

/** Whether a mouse position is outside the window (a drag leaving it). */
export function outsideWindow(x: number, y: number): boolean {
  return x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight;
}
