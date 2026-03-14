import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
        // Proxy API requests to Express backend during dev
        proxy: {
            '/api/auth': 'http://127.0.0.1:5001',
            '/api': 'http://127.0.0.1:5000'
        }
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
