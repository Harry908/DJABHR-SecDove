import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react()],

    // Allow providing a base path at build time (useful if hosting under a subpath)
    base: env.VITE_BASE || '/',

    define: {
      // Keep process.env minimal - Vite exposes import.meta.env to the app
      'process.env': {}
    },

    server: {
      port: Number(env.VITE_DEV_PORT) || 5173,
      proxy: {
        // In development, proxy any /api requests to the backend API
        // VITE_API_URL in .env usually contains the full path (e.g. https://host/api)
        // strip the trailing /api when forming the target
        '/api': {
          target: (env.VITE_API_URL || 'http://localhost:8000').replace(/\/api$/, ''),
          changeOrigin: true,
          secure: false,
          rewrite: (path) => path.replace(/^\/api/, '/api')
        },
        // websocket target (used for socket.io in development)
        '/ws': {
          target: env.VITE_SOCKET_URL || 'http://localhost:8000',
          ws: true,
          changeOrigin: true
        }
      }
    },

    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      sourcemap: false,
      minify: 'terser'
    }
  };
});

