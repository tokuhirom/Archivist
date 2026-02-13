-- Archivist DB schema (SQLite)
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO schema_meta(key, value) VALUES ('schema_version', '2');

CREATE TABLE IF NOT EXISTS pages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  raw_url         TEXT NOT NULL,
  normalized_url  TEXT NOT NULL,
  host            TEXT NOT NULL,
  title           TEXT NOT NULL DEFAULT '',
  text            TEXT NOT NULL DEFAULT '',
  excerpt         TEXT NOT NULL DEFAULT '',
  text_len        INTEGER NOT NULL DEFAULT 0,
  captured_at_ms  INTEGER NOT NULL,
  content_hash    TEXT NOT NULL,
  url_hash        TEXT NOT NULL,
  canonical_url   TEXT,
  is_deleted      INTEGER NOT NULL DEFAULT 0,
  meta_json       TEXT NOT NULL DEFAULT '{}'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pages_dedupe
ON pages(normalized_url, content_hash);

CREATE INDEX IF NOT EXISTS idx_pages_host_time
ON pages(host, captured_at_ms DESC);

CREATE INDEX IF NOT EXISTS idx_pages_captured_at
ON pages(captured_at_ms DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts
USING fts5(
  title,
  text,
  content='pages',
  content_rowid='id',
  tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS pages_ai AFTER INSERT ON pages BEGIN
  INSERT INTO pages_fts(rowid, title, text) VALUES (new.id, new.title, new.text);
END;

CREATE TRIGGER IF NOT EXISTS pages_ad AFTER DELETE ON pages BEGIN
  INSERT INTO pages_fts(pages_fts, rowid, title, text) VALUES ('delete', old.id, old.title, old.text);
END;

CREATE TRIGGER IF NOT EXISTS pages_au AFTER UPDATE ON pages BEGIN
  INSERT INTO pages_fts(pages_fts, rowid, title, text) VALUES ('delete', old.id, old.title, old.text);
  INSERT INTO pages_fts(rowid, title, text) VALUES (new.id, new.title, new.text);
END;

CREATE TABLE IF NOT EXISTS app_kv (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
