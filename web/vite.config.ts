import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

// Served from https://<user>.github.io/NumNotes/ in production.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/NumNotes/' : '/',
  plugins: [svelte()],
  build: { target: 'es2022', chunkSizeWarningLimit: 2048 },
  worker: { format: 'es' },
}));
