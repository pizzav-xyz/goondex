import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

function getProxyPort() {
  const portFile = resolve(__dirname, '.proxy-port');
  if (!existsSync(portFile)) return null;
  try {
    return Number(readFileSync(portFile, 'utf-8').trim());
  } catch {
    return null;
  }
}

const proxyPort = getProxyPort();

/**
 * The dev-only loopback exception. `connect-src http://127.0.0.1:*` exists so
 * the Vite dev server can reach the local proxy; a shipped production build
 * talks only to same-origin `/api` and must not permit connections to any
 * loopback port, so the exception is stripped at build time here.
 */
function devCspPlugin() {
  return {
    name: 'strip-dev-csp-exception',
    transformIndexHtml(html: string, ctx: { server?: unknown }) {
      if (ctx.server) return html
      return html.replace(' http://127.0.0.1:* http://localhost:*', '')
    },
  };
}

export { devCspPlugin }

export default defineConfig({
  root: '.',
  envPrefix: 'R34_',
  plugins: [vue(), devCspPlugin()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    hmr: false,
    watch: { usePolling: true },
    proxy: proxyPort
      ? {
          '/api': {
            target: `http://127.0.0.1:${proxyPort}`,
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api/, ''),
          },
        }
      : undefined,
  },
});
