import { mount } from 'svelte';
// Bundled fonts (OFL), so every computer shows the same letters.
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import './app.css';
import App from './App.svelte';
import { applyTheme, loadTheme } from './lib/theme';

applyTheme(loadTheme());

// The webview's own menu (Back, Reload, Inspect) makes no sense in the app;
// keep it only where text can be edited (copy and paste).
document.addEventListener('contextmenu', (e) => {
  const target = e.target as HTMLElement | null;
  if (!target?.closest('input, textarea, [contenteditable]')) {
    e.preventDefault();
  }
});

const app = mount(App, { target: document.getElementById('app')! });

export default app;
