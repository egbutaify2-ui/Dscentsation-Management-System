import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { z } from 'zod';

const workspaceRoot = fileURLToPath(new URL('../../', import.meta.url));

export default defineConfig(({ mode }) => {
  const rawEnv = loadEnv(mode, workspaceRoot, '');
  const parsedEnv = z
    .object({
      VITE_API_PROXY_TARGET: z.string().url().default('http://localhost:4000'),
    })
    .parse(rawEnv);

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target: parsedEnv.VITE_API_PROXY_TARGET,
          changeOrigin: false,
        },
      },
    },
  };
});
