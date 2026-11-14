import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// NEXUS AI — the React frontend. Phase 1 was UI-only; Phase 2 added the Rust core in
// `crates/` and the Tauri shell in `src-tauri/`, whose build output must never be
// watched: Vite's file watcher dies with EBUSY on the freshly linked DLL
// (`target/debug/deps/nexus_ai_lib.dll`) while `tauri dev` is writing it.
// base './' keeps the build portable for the Windows desktop bundle.
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
    watch: {
      ignored: ['**/target/**', '**/src-tauri/**', '**/crates/**', '**/*.log'],
    },
  },
});
