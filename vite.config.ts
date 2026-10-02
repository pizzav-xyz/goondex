import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { SITE_NAME } from './src/constants/site';

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
 * The token index.html carries in its <title>; it is replaced with SITE_NAME so
 * the document title and the app bar can never disagree.
 */
const SITE_NAME_TOKEN = '%SITE_NAME%';

/**
 * Post-processes index.html on its way to the browser. Two jobs, both
 * template-literal substitutions that cannot silently no-op:
 *
 * 1. Fill the title placeholder with the site name.
 * 2. Strip the dev-only loopback CSP exception. `connect-src
 *    http://127.0.0.1:*` exists so the Vite dev server can reach the local
 *    proxy; a shipped production build talks only to same-origin `/api` and must
 *    not permit connections to any loopback port, so it is removed at build
 *    time.
 */
function indexHtmlPlugin() {
  return {
    name: 'index-html-substitutions',
    transformIndexHtml(html: string, ctx: { server?: unknown }) {
      if (!html.includes(SITE_NAME_TOKEN)) {
        throw new Error(
          `index.html is missing the ${SITE_NAME_TOKEN} title placeholder; ` +
            'the site name has no other source, so the title would ship empty.',
        );
      }
      let out = html.replace(SITE_NAME_TOKEN, SITE_NAME);
      if (!ctx.server) {
        out = out.replace(' http://127.0.0.1:* http://localhost:*', '');
      }
      return out;
    },
  };
}

export { indexHtmlPlugin }

export default defineConfig({
  root: '.',
  envPrefix: 'R34_',
  plugins: [vue(), indexHtmlPlugin()],
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
