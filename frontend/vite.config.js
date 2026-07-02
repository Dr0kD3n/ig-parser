import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** Не светим query (token) в консоли при ошибках proxy */
function configureApiProxy(proxy) {
  proxy.on('error', (err, req, res) => {
    const path = (req.url || '').split('?')[0];
    console.warn(`[vite] proxy ${path}: ${err.code || err.message}`);
    if (res && !res.headersSent && typeof res.writeHead === 'function') {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Backend unavailable' }));
    }
  });
}

const apiTarget = process.env.VITE_API_URL || 'http://127.0.0.1:5000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api/auth': {
        target: process.env.VITE_AUTH_URL || 'https://botback-production-1011.up.railway.app',
        changeOrigin: true,
        secure: false,
      },
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        secure: false,
        configure: configureApiProxy,
      },
      '/profile-photos': {
        target: apiTarget,
        changeOrigin: true,
        secure: false,
      },
    },
    watch: {
      ignored: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
    },
  },
  build: {
    outDir: '../backend/public',
    emptyOutDir: true,
  },
});
