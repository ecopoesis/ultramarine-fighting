import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Hot-seat web UI over the pure TS engine in src/. The engine is browser-safe
// (ES2022, structuredClone, no Node APIs), so the app imports it directly.
export default defineConfig({
  plugins: [react()],
  server: { open: false, port: 5173 },
});
