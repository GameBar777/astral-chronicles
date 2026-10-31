import { defineConfig } from 'vite';
export default defineConfig({
  server: { port: 5173, fs: { allow: ['..'] }, proxy: { '/api': process.env.API_PROXY ?? 'http://127.0.0.1:2567' } },
  build: { outDir: 'dist', chunkSizeWarningLimit: 2000 },
});
