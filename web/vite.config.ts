import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFile } from 'node:fs/promises';

export default defineConfig({
  base: './',
  plugins: [react(), {
    name: 'runtime-deployment-for-development',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const path = request.url?.split('?')[0];
        if (!path || !/^\/(imd-deployment\.json|abi\/[A-Za-z0-9_]+\.json)$/.test(path)) return next();
        try {
          const file = await readFile(new URL(`../dist${path}`, import.meta.url));
          response.setHeader('Content-Type', 'application/json');
          response.end(file);
        } catch { response.statusCode = 503; response.end('Run npm run build before starting development.'); }
      });
    },
  }],
  build: { outDir: '../dist', emptyOutDir: true, sourcemap: false },
});
