import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = { target: 'http://127.0.0.1:4123', changeOrigin: true, headers: { origin: 'http://127.0.0.1:4123' } };

export default defineConfig({
  root: path.resolve(import.meta.dirname),
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
  server: { port: 5173, proxy: { '/api': api, '/proxy': api } },
});
