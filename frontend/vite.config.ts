import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// GEPPETTO_BACKEND_PORT moves the /api and /ws proxy off 8000 (scripts/replay_demo.sh uses it to run beside another stack).
// loadEnv also reads the shell environment for the GEPPETTO_ prefix; nothing here reaches the browser bundle.
export default defineConfig(({ mode }) => {
  const backendPort = loadEnv(mode, '.', 'GEPPETTO_').GEPPETTO_BACKEND_PORT || '8000';
  return {
    plugins: [react()],
    // A worktree may symlink node_modules from the main checkout: keep the link path so files stay inside the served root.
    resolve: { preserveSymlinks: true },
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': { target: `http://localhost:${backendPort}`, changeOrigin: true },
        '/ws': { target: `ws://localhost:${backendPort}`, ws: true, changeOrigin: true },
      },
    },
    build: { chunkSizeWarningLimit: 1500 },
  };
});
