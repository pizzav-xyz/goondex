# trawl-comb

A fast, modern client for Rule34 and e621. Built with Vue 3, Vuetify 3, and TypeScript.

## Features

- **Search** — tag-based search with autocomplete and rating filters
- **Duration filter** — filter videos by length (e.g. `duration:>30`) with client-side probing
- **Lightbox** — fullscreen image/video viewer with tag browsing and watchlist support
- **Watchlist** — track posts you've seen, with watched mode toggle
- **Video buffering** — pre-buffer next/previous videos for instant playback
- **Dark/light theme** — Material Design 3 with customizable accent colors
- **Date tags** — natural language date filters (`date:week`, `date:month`, `date:30day`)

## Tech Stack

- **Frontend**: Vue 3 + Vuetify 3 + Pinia + Vue Router
- **HTTP**: ofetch with per-source request queues and rate limiting
- **Proxy**: Python (uv) — CORS proxy with per-source routing, transport policy, and date-tag resolution
- **Build**: Vite 6 + TypeScript (strict mode)
- **Tests**: Vitest + Playwright

## Getting Started

### Prerequisites

- Node.js 18+
- Python 3.10+ with [uv](https://docs.astral.sh/uv/)
- tmux (for dev mode)

### Setup

```bash
git clone https://github.com/pizzav-xyz/trawl-comb.git
cd trawl-comb
npm install
```

Create a `.env` file:

```
R34_API_KEY=your_api_key
R34_USER_ID=your_user_id
```

The `R34_` prefix is historical and intentionally unchanged: these names are
part of every existing deployment's configuration, and `localStorage` keys
keep the prefix for the same reason. Renaming either would break upgrades
silently.

### Development

```bash
npm run dev
```

This starts both the Python proxy (port 34000) and Vite dev server in a tmux session. The proxy handles CORS and rate limiting for the Rule34 API.

### Build

```bash
npm run build
```

### Test

```bash
npm run test        # unit tests
npm run test:watch  # watch mode
```

E2E tests require the dev server running on `:5173`:

```bash
npx playwright test tests/e2e/
```

## Project Structure

```
src/
├── api/           # API client with rate limiting and caching
├── components/    # Vue components (SearchBar, ImageGrid, Lightbox, etc.)
├── composables/   # Composition API hooks
├── constants/     # Theme accents, dev config
├── plugins/       # Vuetify setup
├── router/        # Vue Router (single route)
├── stores/        # Pinia stores (settings, watched)
├── styles/        # CSS tokens and global styles
├── types/         # TypeScript type definitions
├── utils/         # Cache, duration filtering
└── views/         # SearchView (main view)
proxy.py           # Python CORS proxy
```

## Environment Variables

| Variable | Description |
|---|---|
| `R34_API_KEY` | Rule34 API key |
| `R34_USER_ID` | Rule34 user ID |
| `R34_PROXY_PORT` | Proxy port (default: 34000) |
| `E621_LOGIN` | e621 login (optional; anonymous reads when unset) |
| `E621_API_KEY` | e621 API key (optional; anonymous reads when unset) |

## Rate Limits

Two limiters stack, and the effective interval is the larger of the two:

| | Client queue | Proxy |
|---|---|---|
| Rule34 | 800 ms | 800 ms |
| e621 | 1000 ms | 1000 ms |

Rule34's rate limiter starts rejecting at ≈1.25 req/s, so 800 ms is the floor.
e621 is held to ≤1 req/s, fully serialized — its 429 comes from Cloudflare's
load shedder rather than a documented quota, so parallel requests are what
actually trip it. e621 also needs a descriptive non-browser `User-Agent`; the
proxy sends one, and browser impersonation is deliberately not used.

## License

MIT
