import './style.css';
import { invoke } from "@tauri-apps/api/tauri";
import { mountRoot } from "./ui";

type SearchRow = {
  id: number;
  title: string;
  normalized_url: string;
  host: string;
  captured_at_ms: number;
  excerpt: string;
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

async function runSearch() {
  const q = (el("q") as HTMLInputElement).value.trim();
  const hostFilter = (el("hostFilter") as HTMLInputElement).value.trim();

  results = await invoke<SearchRow[]>("search_pages", { query: q, hostFilter: hostFilter || null });
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

function renderResults() {
  const list = el("results");
  list.innerHTML = results.map(r => {
    const isSel = r.id === selectedId;
    return `
      <div class="item ${isSel ? "sel" : ""}" data-id="${r.id}">
        <div class="title">${escapeHtml(r.title || "(no title)")}</div>
        <div class="meta">${escapeHtml(r.host)} · ${escapeHtml(fmtTime(r.captured_at_ms))}</div>
        <div class="excerpt">${escapeHtml(r.excerpt || "")}</div>
      </div>
    `;
  }).join("");

  for (const node of Array.from(list.querySelectorAll(".item"))) {
    node.addEventListener("click", () => {
      const id = Number((node as HTMLElement).dataset.id);
      select(id);
    });
  }
}

function renderPreview(page: Page | null) {
  const box = el("preview");
  if (!page) {
    box.innerHTML = `<div class="empty">No selection</div>`;
    return;
  }
  box.innerHTML = `
    <div class="p-title">${escapeHtml(page.title || "(no title)")}</div>
    <div class="p-meta">
      <a href="#" id="openUrl">${escapeHtml(page.normalized_url)}</a>
      <span> · ${escapeHtml(fmtTime(page.captured_at_ms))}</span>
      <span> · ${escapeHtml(page.host)}</span>
    </div>
    <pre class="p-text">${escapeHtml(page.text || "")}</pre>
  `;
  el("openUrl").addEventListener("click", async (e) => {
    e.preventDefault();
    await invoke("open_in_browser", { url: page.normalized_url });
  });
}

async function loadSettings() {
  const token = await invoke<string>("get_token");
  (el("token") as HTMLInputElement).value = token;
}

async function loadDomainStats() {
  const stats = await invoke<DomainStat[]>("domain_stats");
  const box = el("domainStats");
  box.innerHTML = stats.map(s => `
    <div class="stat">
      <div class="host">${escapeHtml(s.host)}</div>
      <div class="nums">${s.cnt} pages · ${s.total_chars} chars · last ${escapeHtml(fmtTime(s.last_seen_ms))}</div>
    </div>
  `).join("");
}

let searchTimer: number | null = null;
function debounceSearch() {
  if (searchTimer) window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => runSearch(), 250);
}

window.addEventListener("DOMContentLoaded", async () => {
  mountRoot();
  await loadSettings();
  await loadDomainStats();

  (el("q") as HTMLInputElement).addEventListener("input", debounceSearch);
  (el("hostFilter") as HTMLInputElement).addEventListener("input", debounceSearch);
  el("refreshStats").addEventListener("click", () => loadDomainStats());
  el("searchBtn").addEventListener("click", () => runSearch());

  // Initial search
  await runSearch();
});


