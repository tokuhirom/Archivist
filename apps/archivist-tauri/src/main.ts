import './style.css';
import { invoke } from "@tauri-apps/api/core";
import { mountRoot } from "./ui";

type SearchRow = {
  id: number;
  title: string;
  normalized_url: string;
  host: string;
  captured_at_ms: number;
  excerpt: string;
  snippet: string;
};

type Page = SearchRow & {
  text: string;
};

type DomainStat = {
  host: string;
  cnt: number;
  total_chars: number;
  last_seen_ms: number;
};

type GlobalStats = {
  total_pages: number;
  total_chars: number;
  total_bytes: number;
  domain_count: number;
  oldest_ms: number | null;
  newest_ms: number | null;
};

const el = (id: string) => document.getElementById(id)!;

function fmtTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleString();
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

let results: SearchRow[] = [];
let selectedId: number | null = null;
let currentQuery = "";

async function runSearch() {
  const q = (el("q") as HTMLInputElement).value.trim();
  const hostFilter = (el("hostFilter") as HTMLInputElement).value.trim();
  currentQuery = q;

  const sort = (el("sortOrder") as HTMLSelectElement).value;
  results = await invoke<SearchRow[]>("search_pages", { query: q, hostFilter: hostFilter || null, sort });
  renderResults();
  if (results.length > 0) {
    await select(results[0].id);
  } else {
    selectedId = null;
    renderPreview(null);
  }
}

async function select(id: number) {
  selectedId = id;
  const page = await invoke<Page>("get_page", { id });
  renderResults();
  renderPreview(page);
}

function highlightText(text: string, query: string): string {
  const escaped = escapeHtml(text);
  if (!query) return escaped;
  const terms = query.split(/\s+/).filter(t => t.length > 0);
  if (terms.length === 0) return escaped;
  const pattern = terms
    .map(t => escapeHtml(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const re = new RegExp(`(${pattern})`, "gi");
  return escaped.replace(re, "<mark>$1</mark>");
}

function snippetHtml(r: SearchRow): string {
  if (r.snippet) {
    const escaped = escapeHtml(r.snippet);
    return escaped
      .replaceAll("[[mark]]", "<mark>")
      .replaceAll("[[/mark]]", "</mark>");
  }
  return escapeHtml(r.excerpt || "");
}

function renderResults() {
  const list = el("results");
  list.innerHTML = results.map(r => {
    const isSel = r.id === selectedId;
    return `
      <div class="item ${isSel ? "sel" : ""}" data-id="${r.id}">
        <div class="title"><img class="favicon" src="https://www.google.com/s2/favicons?sz=32&domain=${encodeURIComponent(r.host)}" alt="" />${escapeHtml(r.title || "(no title)")}</div>
        <div class="meta">${escapeHtml(r.host)} · ${escapeHtml(fmtTime(r.captured_at_ms))}</div>
        <div class="excerpt">${snippetHtml(r)}</div>
      </div>
    `;
  }).join("");

  for (const node of Array.from(list.querySelectorAll(".item"))) {
    node.addEventListener("click", () => {
      const id = Number((node as HTMLElement).dataset.id);
      select(id);
    });
  }

  const selEl = list.querySelector(".item.sel");
  if (selEl) {
    selEl.scrollIntoView({ block: "nearest" });
  }
}

function renderPreview(page: Page | null) {
  const box = el("preview");
  if (!page) {
    box.innerHTML = `<div class="empty">No selection</div>`;
    return;
  }
  const textHtml = highlightText(page.text || "", currentQuery);
  box.innerHTML = `
    <div class="p-title">${escapeHtml(page.title || "(no title)")}</div>
    <div class="p-meta">
      <a href="#" id="openUrl">${escapeHtml(page.normalized_url)}</a>
      <span> · ${escapeHtml(fmtTime(page.captured_at_ms))}</span>
      <span> · ${escapeHtml(page.host)}</span>
    </div>
    <pre class="p-text">${textHtml}</pre>
  `;
  el("openUrl").addEventListener("click", async (e) => {
    e.preventDefault();
    await invoke("open_in_browser", { url: page.normalized_url });
  });
  const firstMark = box.querySelector(".p-text mark");
  if (firstMark) {
    firstMark.scrollIntoView({ block: "center" });
  }
}

async function loadSettings() {
  const token = await invoke<string>("get_token");
  (el("token") as HTMLInputElement).value = token;

  const ingestUrl = await invoke<string>("get_ingest_url");
  (el("ingestUrl") as HTMLInputElement).value = ingestUrl;

  const port = await invoke<number>("get_port");
  (el("portInput") as HTMLInputElement).value = String(port);

  try {
    const enabled = await invoke<boolean>("get_autostart");
    (el("autostart") as HTMLInputElement).checked = enabled;
  } catch (e) {
    console.error("get_autostart:", e);
  }
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

async function loadGlobalStats() {
  try {
    const s = await invoke<GlobalStats>("global_stats");
    const box = el("globalStats");
    const timeRange = s.oldest_ms && s.newest_ms
      ? `${fmtTime(s.oldest_ms)} — ${fmtTime(s.newest_ms)}`
      : "—";
    box.innerHTML = `
      <div class="global-stats">
        <div class="gs-item"><div class="gs-val">${s.total_pages.toLocaleString()}</div><div class="gs-label">pages</div></div>
        <div class="gs-item"><div class="gs-val">${s.domain_count.toLocaleString()}</div><div class="gs-label">domains</div></div>
        <div class="gs-item"><div class="gs-val">${fmtBytes(s.total_bytes)}</div><div class="gs-label">stored</div></div>
        <div class="gs-item"><div class="gs-val">${s.total_chars.toLocaleString()}</div><div class="gs-label">chars</div></div>
      </div>
      <div class="gs-time">Period: ${escapeHtml(timeRange)}</div>
    `;
  } catch (e) {
    console.error("loadGlobalStats:", e);
    el("globalStats").innerHTML = `<div class="empty">Failed to load</div>`;
  }
}

async function loadDomainStats() {
  try {
    const stats = await invoke<DomainStat[]>("domain_stats");
    const box = el("domainStats");
    box.innerHTML = stats.length === 0
      ? `<div class="empty">No data</div>`
      : stats.map(s => `
        <div class="stat">
          <div class="host">${escapeHtml(s.host)}</div>
          <div class="nums">${s.cnt} pages · ${s.total_chars.toLocaleString()} chars · last ${escapeHtml(fmtTime(s.last_seen_ms))}</div>
        </div>
      `).join("");
  } catch (e) {
    console.error("loadDomainStats:", e);
    el("domainStats").innerHTML = `<div class="empty">Failed to load</div>`;
  }
}

type ViewName = "search" | "stats" | "settings";

function switchView(view: ViewName) {
  // Toggle view visibility
  for (const v of ["search", "stats", "settings"] as const) {
    el(`view-${v}`).style.display = v === view ? "" : "none";
  }

  // Show search bar only on search view
  el("searchBar").style.display = view === "search" ? "" : "none";

  // Update nav active state
  for (const link of Array.from(document.querySelectorAll(".nav-item"))) {
    const a = link as HTMLElement;
    if (a.dataset.view === view) {
      a.classList.add("active");
    } else {
      a.classList.remove("active");
    }
  }

  // Lazy-load data when switching views
  if (view === "stats") { loadGlobalStats(); loadDomainStats(); }
  if (view === "settings") loadSettings();
}

let searchTimer: number | null = null;
function debounceSearch() {
  if (searchTimer) window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => runSearch(), 250);
}

window.addEventListener("DOMContentLoaded", async () => {
  mountRoot();

  // Nav click handlers
  for (const link of Array.from(document.querySelectorAll(".nav-item"))) {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const view = (link as HTMLElement).dataset.view as ViewName;
      switchView(view);
    });
  }

  function handleSearchKeydown(e: KeyboardEvent) {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    if (results.length === 0) return;
    e.preventDefault();

    const idx = results.findIndex(r => r.id === selectedId);
    let next: number;
    if (e.key === "ArrowDown") {
      next = idx < results.length - 1 ? idx + 1 : idx;
    } else {
      next = idx > 0 ? idx - 1 : 0;
    }
    if (results[next].id !== selectedId) {
      select(results[next].id);
    }
  }

  (el("q") as HTMLInputElement).addEventListener("keydown", handleSearchKeydown);
  (el("hostFilter") as HTMLInputElement).addEventListener("keydown", handleSearchKeydown);
  el("preview").addEventListener("keydown", handleSearchKeydown);
  (el("q") as HTMLInputElement).addEventListener("input", debounceSearch);
  (el("hostFilter") as HTMLInputElement).addEventListener("input", debounceSearch);
  (el("sortOrder") as HTMLSelectElement).addEventListener("change", () => runSearch());
  el("refreshStats").addEventListener("click", () => { loadGlobalStats(); loadDomainStats(); });
  el("searchBtn").addEventListener("click", () => runSearch());
  (el("autostart") as HTMLInputElement).addEventListener("change", async (e) => {
    const enabled = (e.target as HTMLInputElement).checked;
    try {
      await invoke("set_autostart", { enabled });
    } catch (err) {
      console.error("set_autostart:", err);
    }
  });
  el("savePort").addEventListener("click", async () => {
    const port = Number((el("portInput") as HTMLInputElement).value);
    const msg = el("portMsg");
    if (!port || port < 1 || port > 65535) {
      msg.textContent = "Invalid port (1-65535)";
      msg.style.color = "#c00";
      return;
    }
    try {
      await invoke("set_port", { port });
      msg.textContent = "Saved (restart to apply)";
      msg.style.color = "#080";
    } catch (err) {
      msg.textContent = String(err);
      msg.style.color = "#c00";
    }
  });

  // Initial search
  await runSearch();
});
