import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Avoid crossorigin module tags that break file:// loads in packaged Electron.
    modulePreload: false,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true
  }
});
