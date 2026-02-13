// Archivist Tauri app backend.
// - Runs a local ingest server on 127.0.0.1:17373 (Axum)
// - Stores pages in SQLite (FTS5)
// - Exposes Tauri commands for UI search

#![allow(clippy::needless_return)]

use axum::{
  extract::State,
  http::{HeaderMap, StatusCode},
  routing::{get, post},
  Json, Router,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{net::SocketAddr, path::PathBuf, sync::Arc};
use tauri::Manager;
use tauri::tray::MouseButton;
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_opener::OpenerExt;
use tokio::sync::Mutex;

#[derive(Clone)]
struct AppState {
  db: Arc<Mutex<rusqlite::Connection>>,
  token: Arc<String>,
  ingest_url: Arc<String>,
}

#[derive(Debug, Deserialize)]
struct CapturePayload {
  raw_url: String,
  normalized_url: String,
  canonical_url: Option<String>,
  title: String,
  text: String,
  captured_at_ms: i64,
}

fn sha256_hex(s: &str) -> String {
  let mut h = Sha256::new();
  h.update(s.as_bytes());
  let out = h.finalize();
  hex::encode(out)
}

fn excerpt(text: &str) -> String {
  let trimmed = text.trim();
  let max = 2400usize;
  let mut s = trimmed.chars().take(max).collect::<String>();
  if trimmed.chars().count() > max {
    s.push('\u{2026}');
  }
  s
}

async fn healthz(State(state): State<AppState>, headers: HeaderMap) -> StatusCode {
  if !check_auth(&state, &headers) {
    return StatusCode::UNAUTHORIZED;
  }
  StatusCode::OK
}

async fn capture(State(state): State<AppState>, headers: HeaderMap, Json(p): Json<CapturePayload>) -> (StatusCode, String) {
  if !check_auth(&state, &headers) {
    return (StatusCode::UNAUTHORIZED, "unauthorized".into());
  }

  if p.normalized_url.is_empty() || p.raw_url.is_empty() {
    return (StatusCode::BAD_REQUEST, "missing url".into());
  }

  let host = match url::Url::parse(&p.normalized_url) {
    Ok(u) => u.host_str().unwrap_or("").to_string(),
    Err(_) => return (StatusCode::BAD_REQUEST, "invalid normalized_url".into()),
  };

  let text_len = p.text.chars().count() as i64;
  let url_hash = sha256_hex(&p.normalized_url);
  let content_hash = sha256_hex(&(p.normalized_url.clone() + "\n" + &p.text));

  let ex = excerpt(&p.text);

  let conn = state.db.lock().await;

  let r = conn.execute(
    r#"
    INSERT OR IGNORE INTO pages
      (raw_url, normalized_url, host, title, text, excerpt, text_len, captured_at_ms, content_hash, url_hash, canonical_url, is_deleted, meta_json)
    VALUES
      (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 0, '{}')
    "#,
    rusqlite::params![
      p.raw_url,
      p.normalized_url,
      host,
      p.title,
      p.text,
      ex,
      text_len,
      p.captured_at_ms,
      content_hash,
      url_hash,
      p.canonical_url
    ],
  );

  match r {
    Ok(_) => (StatusCode::OK, "ok".into()),
    Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, format!("db error: {e}")),
  }
}

fn check_auth(state: &AppState, headers: &HeaderMap) -> bool {
  let Some(v) = headers.get("authorization") else { return false; };
  let Ok(s) = v.to_str() else { return false; };
  let s = s.trim();
  let Some(rest) = s.strip_prefix("Bearer ") else { return false; };
  rest == state.token.as_str()
}

#[derive(Debug, Serialize)]
struct SearchRow {
  id: i64,
  title: String,
  normalized_url: String,
  host: String,
  captured_at_ms: i64,
  excerpt: String,
  snippet: String,
}

#[derive(Debug, Serialize)]
struct Page {
  id: i64,
  title: String,
  normalized_url: String,
  host: String,
  captured_at_ms: i64,
  excerpt: String,
  text: String,
}

#[derive(Debug, Serialize)]
struct DomainStat {
  host: String,
  cnt: i64,
  total_chars: i64,
  last_seen_ms: i64,
}

#[tauri::command]
async fn get_token(state: tauri::State<'_, AppState>) -> Result<String, String> {
  Ok(state.token.as_ref().clone())
}

fn build_fts_query(raw: &str) -> String {
  let terms: Vec<&str> = raw.split_whitespace().filter(|t| !t.is_empty()).collect();
  if terms.len() <= 1 {
    return format!("\"{}\"", raw.replace('"', "\"\""));
  }
  terms
    .iter()
    .map(|t| format!("\"{}\"", t.replace('"', "\"\"")))
    .collect::<Vec<_>>()
    .join(" AND ")
}

#[tauri::command]
async fn search_pages(state: tauri::State<'_, AppState>, query: String, host_filter: Option<String>) -> Result<Vec<SearchRow>, String> {
  let q = query.trim();
  let conn = state.db.lock().await;

  let mut out = Vec::new();

  if q.is_empty() {
    let mut stmt = conn.prepare(
      r#"
      SELECT id, title, normalized_url, host, captured_at_ms, excerpt
      FROM pages
      WHERE is_deleted = 0
      ORDER BY captured_at_ms DESC
      LIMIT 80
      "#,
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map([], |r| {
      Ok(SearchRow{
        id: r.get(0)?,
        title: r.get(1)?,
        normalized_url: r.get(2)?,
        host: r.get(3)?,
        captured_at_ms: r.get(4)?,
        excerpt: r.get(5)?,
        snippet: String::new(),
      })
    }).map_err(|e| e.to_string())?;

    for row in rows {
      out.push(row.map_err(|e| e.to_string())?);
    }
    return Ok(out);
  }

  let mut sql = r#"
    SELECT p.id, p.title, p.normalized_url, p.host, p.captured_at_ms, p.excerpt,
           snippet(pages_fts, 1, '[[mark]]', '[[/mark]]', '…', 30)
    FROM pages_fts f
    JOIN pages p ON p.id = f.rowid
    WHERE pages_fts MATCH ?1
      AND p.is_deleted = 0
  "#.to_string();

  if host_filter.as_ref().map(|s| !s.trim().is_empty()).unwrap_or(false) {
    sql.push_str(" AND p.host = ?2 ");
  }

  sql.push_str(" ORDER BY p.captured_at_ms DESC LIMIT 80 ");

  let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

  let map_row = |r: &rusqlite::Row| -> rusqlite::Result<SearchRow> {
    Ok(SearchRow{
      id: r.get(0)?,
      title: r.get(1)?,
      normalized_url: r.get(2)?,
      host: r.get(3)?,
      captured_at_ms: r.get(4)?,
      excerpt: r.get(5)?,
      snippet: r.get(6)?,
    })
  };

  let fts_query = build_fts_query(q);

  let rows = if host_filter.as_ref().map(|s| !s.trim().is_empty()).unwrap_or(false) {
    stmt.query_map(rusqlite::params![fts_query, host_filter.unwrap()], map_row)
      .map_err(|e| e.to_string())?
  } else {
    stmt.query_map(rusqlite::params![fts_query], map_row)
      .map_err(|e| e.to_string())?
  };

  for row in rows {
    out.push(row.map_err(|e| e.to_string())?);
  }
  Ok(out)
}

#[tauri::command]
async fn get_page(state: tauri::State<'_, AppState>, id: i64) -> Result<Page, String> {
  let conn = state.db.lock().await;
  let mut stmt = conn.prepare(
    r#"
    SELECT id, title, normalized_url, host, captured_at_ms, excerpt, text
    FROM pages
    WHERE id = ?1 AND is_deleted = 0
    "#,
  ).map_err(|e| e.to_string())?;

  let p = stmt.query_row(rusqlite::params![id], |r| {
    Ok(Page{
      id: r.get(0)?,
      title: r.get(1)?,
      normalized_url: r.get(2)?,
      host: r.get(3)?,
      captured_at_ms: r.get(4)?,
      excerpt: r.get(5)?,
      text: r.get(6)?,
    })
  }).map_err(|e| e.to_string())?;

  Ok(p)
}

#[tauri::command]
async fn domain_stats(state: tauri::State<'_, AppState>) -> Result<Vec<DomainStat>, String> {
  let conn = state.db.lock().await;
  let mut stmt = conn.prepare(
    r#"
    SELECT host, COUNT(*) AS cnt, SUM(text_len) AS total_chars, MAX(captured_at_ms) AS last_seen
    FROM pages
    WHERE is_deleted = 0
    GROUP BY host
    ORDER BY total_chars DESC
    LIMIT 200
    "#,
  ).map_err(|e| e.to_string())?;

  let rows = stmt.query_map([], |r| {
    Ok(DomainStat{
      host: r.get(0)?,
      cnt: r.get(1)?,
      total_chars: r.get(2)?,
      last_seen_ms: r.get(3)?,
    })
  }).map_err(|e| e.to_string())?;

  let mut out = Vec::new();
  for row in rows {
    out.push(row.map_err(|e| e.to_string())?);
  }
  Ok(out)
}

#[derive(Debug, Serialize)]
struct GlobalStats {
  total_pages: i64,
  total_chars: i64,
  total_bytes: i64,
  domain_count: i64,
  oldest_ms: Option<i64>,
  newest_ms: Option<i64>,
}

#[tauri::command]
async fn global_stats(state: tauri::State<'_, AppState>) -> Result<GlobalStats, String> {
  let conn = state.db.lock().await;
  conn.query_row(
    r#"
    SELECT
      COUNT(*) AS total_pages,
      COALESCE(SUM(text_len), 0) AS total_chars,
      COALESCE(SUM(LENGTH(text)), 0) AS total_bytes,
      COUNT(DISTINCT host) AS domain_count,
      MIN(captured_at_ms) AS oldest_ms,
      MAX(captured_at_ms) AS newest_ms
    FROM pages
    WHERE is_deleted = 0
    "#,
    [],
    |r| {
      Ok(GlobalStats {
        total_pages: r.get(0)?,
        total_chars: r.get(1)?,
        total_bytes: r.get(2)?,
        domain_count: r.get(3)?,
        oldest_ms: r.get(4)?,
        newest_ms: r.get(5)?,
      })
    },
  ).map_err(|e| e.to_string())
}

#[tauri::command]
async fn open_in_browser(app: tauri::AppHandle, url: String) -> Result<(), String> {
  app.opener().open_url(&url, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_ingest_url(state: tauri::State<'_, AppState>) -> Result<String, String> {
  Ok(state.ingest_url.as_ref().clone())
}

#[tauri::command]
async fn get_port(app: tauri::AppHandle) -> Result<u16, String> {
  let dir = app_data_dir(&app);
  Ok(load_port(&dir))
}

#[tauri::command]
async fn set_port(app: tauri::AppHandle, port: u16) -> Result<(), String> {
  if port == 0 {
    return Err("port must be > 0".into());
  }
  let dir = app_data_dir(&app);
  save_port(&dir, port);
  Ok(())
}

#[tauri::command]
async fn get_autostart(app: tauri::AppHandle) -> Result<bool, String> {
  app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
async fn set_autostart(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
  let mgr = app.autolaunch();
  if enabled {
    mgr.enable().map_err(|e| e.to_string())
  } else {
    mgr.disable().map_err(|e| e.to_string())
  }
}

fn app_data_dir(app: &tauri::AppHandle) -> PathBuf {
  app.path()
    .app_data_dir()
    .unwrap_or_else(|_| std::env::current_dir().unwrap())
}

const DEFAULT_PORT: u16 = 17373;

fn load_port(dir: &PathBuf) -> u16 {
  let path = dir.join("port.txt");
  if let Ok(s) = std::fs::read_to_string(&path) {
    if let Ok(p) = s.trim().parse::<u16>() {
      if p > 0 { return p; }
    }
  }
  DEFAULT_PORT
}

fn save_port(dir: &PathBuf, port: u16) {
  std::fs::create_dir_all(dir).ok();
  let _ = std::fs::write(dir.join("port.txt"), port.to_string());
}

fn load_or_create_token(dir: &PathBuf) -> String {
  std::fs::create_dir_all(dir).ok();
  let path = dir.join("token.txt");
  if let Ok(s) = std::fs::read_to_string(&path) {
    let t = s.trim().to_string();
    if !t.is_empty() { return t; }
  }
  let t = {
    let mut b = [0u8; 32];
    getrandom::getrandom(&mut b).ok();
    hex::encode(b)
  };
  let _ = std::fs::write(&path, &t);
  t
}

fn open_db(dir: &PathBuf) -> rusqlite::Connection {
  std::fs::create_dir_all(dir).ok();
  let p = dir.join("archivist.sqlite");
  let conn = rusqlite::Connection::open(p).expect("open sqlite");
  conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;").ok();
  conn.execute_batch(include_str!("../sql/schema.sql")).expect("initialize schema");
  migrate_fts_to_trigram(&conn);
  conn
}

fn migrate_fts_to_trigram(conn: &rusqlite::Connection) {
  let version: String = conn
    .query_row(
      "SELECT value FROM schema_meta WHERE key = 'schema_version'",
      [],
      |r| r.get(0),
    )
    .unwrap_or_else(|_| "1".to_string());

  if version.as_str() >= "2" {
    return;
  }

  conn.execute_batch(
    r#"
    DROP TRIGGER IF EXISTS pages_ai;
    DROP TRIGGER IF EXISTS pages_ad;
    DROP TRIGGER IF EXISTS pages_au;
    DROP TABLE IF EXISTS pages_fts;

    CREATE VIRTUAL TABLE pages_fts USING fts5(
      title, text,
      content='pages', content_rowid='id',
      tokenize='trigram'
    );

    INSERT INTO pages_fts(rowid, title, text)
      SELECT id, title, text FROM pages WHERE is_deleted = 0;

    CREATE TRIGGER pages_ai AFTER INSERT ON pages BEGIN
      INSERT INTO pages_fts(rowid, title, text) VALUES (new.id, new.title, new.text);
    END;
    CREATE TRIGGER pages_ad AFTER DELETE ON pages BEGIN
      INSERT INTO pages_fts(pages_fts, rowid, title, text) VALUES ('delete', old.id, old.title, old.text);
    END;
    CREATE TRIGGER pages_au AFTER UPDATE ON pages BEGIN
      INSERT INTO pages_fts(pages_fts, rowid, title, text) VALUES ('delete', old.id, old.title, old.text);
      INSERT INTO pages_fts(rowid, title, text) VALUES (new.id, new.title, new.text);
    END;

    UPDATE schema_meta SET value = '2' WHERE key = 'schema_version';
    "#,
  )
  .expect("migrate FTS to trigram");
}

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
    .setup(|app| {
      let dir = app_data_dir(&app.handle());
      let token = load_or_create_token(&dir);
      let conn = open_db(&dir);

      // Bind to configured port (saved in port.txt, default 17373)
      let port = load_port(&dir);
      let addr: SocketAddr = format!("127.0.0.1:{}", port).parse().unwrap();
      let listener = std::net::TcpListener::bind(addr)
        .expect(&format!("failed to bind ingest server on port {port}"));
      listener.set_nonblocking(true).ok();
      let ingest_url = format!("http://127.0.0.1:{}/capture", port);

      let state = AppState {
        db: Arc::new(Mutex::new(conn)),
        token: Arc::new(token),
        ingest_url: Arc::new(ingest_url),
      };

      let state2 = state.clone();
      tauri::async_runtime::spawn(async move {
        let router = Router::new()
          .route("/healthz", get(healthz))
          .route("/capture", post(capture))
          .with_state(state2);

        let listener = tokio::net::TcpListener::from_std(listener).expect("convert listener");
        axum::serve(listener, router).await.unwrap();
      });

      app.manage(state);

      // Build system tray
      let show = tauri::menu::MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
      let quit = tauri::menu::MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
      let menu = tauri::menu::Menu::with_items(app, &[&show, &quit])?;

      tauri::tray::TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .on_menu_event(|app: &tauri::AppHandle, event: tauri::menu::MenuEvent| {
          match event.id().as_ref() {
            "show" => {
              if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
              }
            }
            "quit" => {
              app.exit(0);
            }
            _ => {}
          }
        })
        .on_tray_icon_event(|tray: &tauri::tray::TrayIcon, event: tauri::tray::TrayIconEvent| {
          if let tauri::tray::TrayIconEvent::Click { button: MouseButton::Left, .. } = event {
            if let Some(w) = tray.app_handle().get_webview_window("main") {
              if w.is_visible().unwrap_or(false) {
                let _ = w.hide();
              } else {
                let _ = w.show();
                let _ = w.set_focus();
              }
            }
          }
        })
        .build(app)?;

      // Intercept window close -> hide instead
      if let Some(window) = app.get_webview_window("main") {
        let w = window.clone();
        window.on_window_event(move |event| {
          if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = w.hide();
          }
        });
      }

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      get_token,
      get_ingest_url,
      get_port,
      set_port,
      search_pages,
      get_page,
      domain_stats,
      global_stats,
      open_in_browser,
      get_autostart,
      set_autostart
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
