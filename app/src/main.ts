import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { applyTheme, loadTheme } from './lib/theme';

applyTheme(loadTheme());

const app = mount(App, { target: document.getElementById('app')! });

export default app;
