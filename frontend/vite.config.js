import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
        // Proxy API requests to Express backend during dev
        proxy: process.env.VITE_PROXY_BACKEND === 'true' ? {
            '/api': {
                target: 'http://127.0.0.1:1337',
                changeOrigin: true,
                configure: (proxy) => {
                    proxy.on('error', (err) => {
                        if (err.code === 'ECONNREFUSED') return;
                        console.error('proxy error', err);
                    });
                }
            }
        } : {}
    },
    build: {
        outDir: '../backend/public',
        emptyOutDir: true,
        rollupOptions: {
            output: {
                manualChunks: undefined
            }
        }
    }
})
