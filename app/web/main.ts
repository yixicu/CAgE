// Establish Tailwind's layer order before Svelte's scoped component styles.
import './style.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { initializeTheme } from './themes/preference';
import { initializeFontScale } from './appearance/font-scale';

initializeTheme();
initializeFontScale();

mount(App, { target: document.getElementById('app')! });
