# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## General Rules

- Write all documentation, code comments, and CLAUDE.md content in English.
- Always create a topic branch and open a PR for each change. Do not commit directly to main.
- Do not mix unrelated changes in the same PR.

## Build & Development Commands

```bash
# Install frontend dependencies
make setup

# Start development (Vite dev server on :1420 + Tauri backend with hot reload)
make dev

# Production build (macOS app bundle)
make build

# Rust lint
make lint

# Remove build artifacts (dist + cargo clean)
make clean
```

Alternatively, from `apps/archivist-tauri/`:
```bash
npm run tauri dev     # dev mode
npm run tauri build   # production build
```

There are no tests yet in this project.

## Architecture

Archivist is a **local-first personal web archive** with two components:

### Tauri Desktop App (`apps/archivist-tauri/`)

- **Frontend**: Vanilla TypeScript + Vite (no framework). All UI logic in `src/main.ts`, DOM template in `src/ui.ts`.
- **Backend**: Single-file Rust backend (`src-tauri/src/main.rs`) that runs:
  1. **Axum HTTP server** on `127.0.0.1:17373` — receives captured pages from the Chrome extension via `POST /capture` (Bearer token auth).
  2. **Tauri commands** — `search_pages`, `get_page`, `domain_stats`, `get_token`, `open_in_browser` — called from the frontend via `@tauri-apps/api`.
- **Database**: SQLite with FTS5 (`archivist.sqlite` in app data dir). Schema in `src-tauri/sql/schema.sql`. Triggers auto-maintain the FTS index. WAL mode enabled.
- **Auth**: Random 32-byte hex token stored in `token.txt` in app data dir, validated via SHA-256 comparison on each HTTP request.

### Chrome Extension (`extensions/chrome/`)

- MV3 extension with `service_worker.js` as background script.
- On `tabs.onUpdated` (status=complete), waits `delayMs` (default 2s), then injects a content script to extract title, canonical URL, and body text.
- Normalizes URL (strips fragments + tracking params), deduplicates via in-memory SHA-1 cache (10-min throttle), then POSTs JSON to the Tauri app.
- One-way data flow only — extension sends to app, never receives stored content back.
- Options page (`options.html` / `options.js`) configures: ingest URL, token, delay, domain denylist.

### Data Flow

```
Chrome tab load → Extension extracts DOM → normalizes URL → POST /capture →
Axum validates token → computes hashes → INSERT OR IGNORE into SQLite →
FTS5 triggers update search index → Frontend queries via Tauri commands
```

### Key Design Decisions

- **Deduplication** is dual-layer: extension-side SHA-1 cache (time-based) + DB unique constraint on `(normalized_url, content_hash)`.
- **Excerpts** (2400 chars) are computed at ingest time and stored alongside full text.
- **Search** returns max 80 results, ordered by `captured_at_ms DESC`. Domain stats limited to 200 hosts.
- All state is shared via `Arc<Mutex<rusqlite::Connection>>` — no ORM.
- Frontend uses 250ms debounced search input.

## Key File Locations

- Rust backend entry point: `apps/archivist-tauri/src-tauri/src/main.rs`
- Frontend entry point: `apps/archivist-tauri/src/main.ts`
- DB schema: `apps/archivist-tauri/src-tauri/sql/schema.sql`
- Chrome extension service worker: `extensions/chrome/service_worker.js`
- Tauri config: `apps/archivist-tauri/src-tauri/tauri.conf.json`
