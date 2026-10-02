/**
 * The single source of the site's display name on the frontend.
 *
 * Both places the browser shows it — the app bar and the document title — read
 * this constant, so a rename touches one line instead of drifting apart. The
 * title gets its value at build time: vite.config.ts injects this constant into
 * index.html, which is why the `<title>` there must keep the exact
 * `%SITE_NAME%` placeholder that `SITE_NAME_TOKEN` names.
 *
 * The `goondex/0.1` client id in proxy_config.py is a separate, deliberate
 * copy: the Python proxy cannot import a TypeScript module, and that string is
 * a wire-level identity sent to e621 rather than a display name.
 */
export const SITE_NAME = 'goondex'
