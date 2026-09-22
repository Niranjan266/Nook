import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const API = process.env.VITE_API_TARGET || 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': { target: API, changeOrigin: true },
      '/uploads': { target: API, changeOrigin: true },
      '/socket.io': { target: API, ws: true, changeOrigin: true },
    },
  },
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        /**
         * Vendor code in its own long-lived chunks. It changes far less often
         * than the app, so after a deploy the service worker's cache-first
         * /assets rule keeps serving these from disk and only the app chunk
         * is fetched again.
         */
        manualChunks: {
          react: ['react', 'react-dom', 'react/jsx-runtime', 'scheduler'],
          motion: ['framer-motion'],
          net: ['socket.io-client'],
          store: ['zustand', 'idb-keyval'],
        },
      },
    },
  },
});
