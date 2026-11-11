import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({
  server: { port: 5173, fs: { allow: ['..'] }, proxy: { '/api': process.env.API_PROXY ?? 'http://127.0.0.1:2567' } },
  build: { outDir: 'dist', chunkSizeWarningLimit: 2000, rollupOptions: { input: { main: resolve(__dirname, 'index.html'), admin: resolve(__dirname, 'admin.html') } } },
});
