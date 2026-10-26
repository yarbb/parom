// Theme selection: dark, light or follow the system. Stored per machine until
// Preferences (M2) move it into the daemon's settings.
export type ThemeChoice = 'dark' | 'light' | 'system';

const storageKey = 'theme';
const media = window.matchMedia('(prefers-color-scheme: light)');

export function loadTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(storageKey);
    if (v === 'dark' || v === 'light' || v === 'system') {
      return v;
    }
  } catch {
    // Storage can be unavailable; fall back to the default.
  }
  return 'system';
}

export function applyTheme(choice: ThemeChoice): void {
  const resolved = choice === 'system' ? (media.matches ? 'light' : 'dark') : choice;
  document.documentElement.dataset.theme = resolved;
  try {
    localStorage.setItem(storageKey, choice);
  } catch {
    // Not fatal: the choice just will not persist.
  }
}

export function watchSystemTheme(getChoice: () => ThemeChoice): () => void {
  const listener = () => {
    if (getChoice() === 'system') {
      applyTheme('system');
    }
  };
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
}
