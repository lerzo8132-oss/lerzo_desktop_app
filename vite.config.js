import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiBaseUrl = env.VITE_API_BASE_URL || 'https://app.lerzo.com';
  const appEnv = env.VITE_APP_ENV || 'production';

  return {
    base: './',
    define: {
      'import.meta.env.VITE_API_BASE_URL': JSON.stringify(apiBaseUrl),
      'import.meta.env.VITE_APP_ENV': JSON.stringify(appEnv),
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      // Avoid crossorigin module tags that break file:// loads in packaged Electron.
      modulePreload: false,
    },
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
    },
  };
});
