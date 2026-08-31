import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, '');
  const proxyTarget =
    process.env.BRIDGE_PROXY_TARGET || env.BRIDGE_PROXY_TARGET || 'http://127.0.0.1:4170';
  const open = (process.env.SALESBOT_DEV_OPEN || env.SALESBOT_DEV_OPEN || 'true') !== 'false';

  return {
    envDir: repoRoot,
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 4173,
      strictPort: true,
      open,
      proxy: {
        '/bridge': {
          target: proxyTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/bridge/, ''),
        },
      },
    },
  };
});
