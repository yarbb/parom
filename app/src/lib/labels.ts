// Colour labels on folders (right-click → Color label). Kept in the app's
// preferences on this computer only: nothing goes to the server or to git.
import { prefs } from './prefs.svelte';

export const labelColors = {
  red: '#f87171',
  orange: '#fb923c',
  yellow: '#facc15',
  green: '#4ade80',
  blue: '#60a5fa',
  purple: '#c084fc',
  gray: '#9ca3af',
} as const;

export type LabelColor = keyof typeof labelColors;

/** Key of a folder: local path, or server + path (sites by id, quick connections by address). */
export const localLabelKey = (path: string) => `local:${path}`;
export const remoteLabelKey = (server: string, path: string) => `remote:${server}:${path}`;

export function labelOf(key: string): LabelColor | null {
  return (prefs.value.folderLabels[key] as LabelColor | undefined) ?? null;
}

export async function setLabel(keys: string[], color: LabelColor | null): Promise<void> {
  const next = { ...prefs.value.folderLabels };
  for (const key of keys) {
    if (color) {
      next[key] = color;
    } else {
      delete next[key];
    }
  }
  await prefs.set('folderLabels', next);
}
