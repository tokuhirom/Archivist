# Archivist

![alt text](image.png)

Archivist is a **local-first personal web archive**.

It automatically captures the pages you read in Chrome (title + canonicalized URL + visible text) and stores them locally in SQLite (FTS5), so you can search everything later from a menu-bar app.

> Privacy note: Archivist is designed to be local-first. The Chrome extension only *sends* captured text to your local app. The app never sends your stored content back to the extension.

---

## Features

- **Automatic capture** after a page finishes loading (with a small delay)
- **Local SQLite + FTS5** full-text search
- **Two-pane search UI** (results on the left, preview on the right)
- **Domain stats** (count / total chars per host)
- **No “content return path”** from the app to the extension (one-way ingest)

Planned / optional:
- “Agent search” (rerank / Q&A) via an OpenAI-compatible API, scoped to search results only

---

## Repository layout

- `apps/archivist-tauri/` — Tauri desktop app (macOS)
- `extensions/chrome/` — Chrome MV3 extension

---

## Requirements (macOS)

- Node.js 18+ (Node 20+ recommended)
- Rust toolchain (stable)
- Tauri prerequisites for macOS (Xcode command line tools)

---

## Quick start

### 1) Start the desktop app

```bash
cd apps/archivist-tauri
npm install
npm run tauri dev
```

On first launch, Archivist generates a local ingest token and shows it in **Settings**.

By default, the app listens on:

- `http://127.0.0.1:17373`

---

### 2) Install the Chrome extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select `extensions/chrome`

Then open the extension **Options** page and set:

- `Ingest URL`: `http://127.0.0.1:17373/capture`
- `Token`: copy from the Archivist app Settings

---

## How capture works

1. Chrome detects `tab.status == "complete"`
2. Waits a short delay (default: 2000ms)
3. Extracts:
   - `document.title`
   - `link[rel=canonical]` (if present)
   - `document.body.innerText`
4. Normalizes the URL (drops fragments + common tracking params)
5. Sends JSON to the app over `127.0.0.1` with `Authorization: Bearer <token>`

---

## Database schema

Archivist uses SQLite with FTS5 (`pages_fts`) and a `pages` table for metadata.

See: `apps/archivist-tauri/src-tauri/sql/schema.sql`

---

## Security model (practical)

- The ingest server only listens on `127.0.0.1`
- Requests require a random token (Bearer auth)
- The extension does not receive stored content back from the app

This is intended to be “reasonable for personal use” rather than “high assurance”.

---

## Architecture notes

### Why rusqlite instead of tauri-plugin-sql?

Tauri has an official `tauri-plugin-sql` for SQLite access, but Archivist uses `rusqlite` directly because:

- The app runs an **Axum HTTP server** (`127.0.0.1:17373`) to receive page captures from the Chrome extension. This server needs Rust-side DB access, which `tauri-plugin-sql` does not expose.
- Using a single `Arc<Mutex<Connection>>` shared between Tauri commands (reads) and Axum handlers (writes) keeps the architecture simple.
- Using both `tauri-plugin-sql` and `rusqlite` would create two separate connections to the same SQLite file, adding complexity for no benefit.

### Development notes

- Capture is intentionally simple at first:
  - no SPA route tracking (yet)
  - no iframe traversal (yet)
- Start with a denylist for sensitive domains in the extension options.

---

## License

MIT.
