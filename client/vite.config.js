import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true,
    port: 5173,
    // /shared vive fuera de /client
    fs: { allow: ['..'] },
  },
  preview: { host: true, port: 4173 },
  build: {
    target: 'es2020',
    outDir: 'dist',
    chunkSizeWarningLimit: 1500,
  },
});
