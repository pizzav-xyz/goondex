#!/usr/bin/env bash
# Boots the proxy and the Vite dev server together for a Playwright run and
# forwards signals to both, so Ctrl-C leaves no orphaned processes holding the
# ports. Playwright's `webServer` cannot do this: it starts one command and kills
# only that process tree, and Vite reads `.proxy-port` once at startup, so the
# proxy must already be listening before Vite launches.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${R34_PROXY_PORT:=34000}"
export R34_PROXY_PORT

rm -f .proxy-port

cleanup() {
  [ -n "${PROXY_PID:-}" ] && kill "$PROXY_PID" 2>/dev/null || true
  [ -n "${VITE_PID:-}" ] && kill "$VITE_PID" 2>/dev/null || true
  rm -f .proxy-port
}
trap cleanup EXIT INT TERM

uv run proxy.py &
PROXY_PID=$!

for _ in $(seq 1 100); do
  [ -f .proxy-port ] && break
  sleep 0.1
done
if [ ! -f .proxy-port ]; then
  echo "proxy failed to start; see its output above" >&2
  exit 1
fi

# The port is deliberately fixed rather than auto-incremented: the proxy is
# already bound, so Vite taking 5173 would leave the app on a URL the specs
# would have to discover instead of declaring.
npx vite --port 5173 --strictPort &
VITE_PID=$!

wait "$VITE_PID"