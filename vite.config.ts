import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Hot-seat web UI over the pure TS engine in src/. The engine is browser-safe
// (ES2022, structuredClone, no Node APIs), so the app imports it directly.
export default defineConfig({
  plugins: [react()],
  // host: true binds 0.0.0.0 (all interfaces) so a remote machine can reach the dev
  // server at <this-machine-ip>:5173, not just localhost.
  server: { open: false, port: 5173, host: true },
  preview: { port: 5173, host: true },
});
