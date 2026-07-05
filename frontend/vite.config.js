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

/** Подсказка: с VPN открывать 127.0.0.1, не localhost (Windows → ::1) */
function vpnLocalhostHint() {
  return {
    name: 'vpn-localhost-hint',
    configureServer(server) {
      server.httpServer?.once('listening', () => {
        const port = server.config.server.port || 5173;
        console.log('');
        console.log('  ➜  Local:   http://127.0.0.1:' + port + '/  ← с VPN используй этот URL');
        console.log('  ➜  Local:   http://localhost:' + port + '/');
        console.log('');
      });
    },
  };
}

const apiTarget = process.env.VITE_API_URL || 'http://127.0.0.1:5001';

export default defineConfig({
  plugins: [react(), vpnLocalhostHint()],
  server: {
    // 0.0.0.0 — не только loopback; localhost на Windows часто идёт в ::1, VPN ломает IPv6
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    hmr: {
      // WebSocket HMR строго через IPv4 loopback — стабильнее с VPN
      host: '127.0.0.1',
      port: 5173,
      clientPort: 5173,
      protocol: 'ws',
    },
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
