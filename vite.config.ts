import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// NEXUS AI — Phase 1 is UI-only. No backend proxy, no external APIs.
// base './' keeps the build portable for future Tauri (Windows desktop) packaging.
export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
