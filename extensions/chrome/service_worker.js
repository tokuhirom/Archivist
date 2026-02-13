// Archivist Capture (MV3) service worker.
// Captures pages when loading is complete and sends them to the local Archivist app.

const DEFAULTS = {
  ingestUrl: "http://127.0.0.1:17373/capture",
  token: "",
  delayMs: 2000,
  filterMode: "denylist",
  domainList: ["mail.google.com", "accounts.google.com"]
};

const sentCache = new Map(); // urlHash -> lastSentAtMs

const ICON_OK = {
  "16": "icons/icon-16.png",
  "48": "icons/icon-48.png",
  "128": "icons/icon-128.png"
};
const ICON_ERROR = {
  "16": "icons/icon-error-16.png",
  "48": "icons/icon-error-48.png",
  "128": "icons/icon-error-128.png"
};

function setIconOk() {
  chrome.action.setIcon({ path: ICON_OK });
  chrome.action.setTitle({ title: "Archivist Capture" });
}

function setIconError() {
  chrome.action.setIcon({ path: ICON_ERROR });
  chrome.action.setTitle({ title: "Archivist Capture - Connection failed" });
}

function sha1Hex(input) {
  // Minimal SHA-1 using WebCrypto for dedupe (not for security).
  const enc = new TextEncoder().encode(input);
  return crypto.subtle.digest("SHA-1", enc).then(buf => {
    const b = new Uint8Array(buf);
    return Array.from(b).map(x => x.toString(16).padStart(2, "0")).join("");
  });
}

function normalizeUrl(raw) {
  // Best-effort normalization:
  // - Prefer dropping fragments
  // - Remove common tracking parameters
  // - Keep scheme/host/path as-is (avoid risky canonicalization)
  const u = new URL(raw);
  u.hash = "";

  const dropPrefixes = ["utm_"];
  const dropKeys = new Set(["gclid", "fbclid", "yclid", "mc_cid", "mc_eid"]);

  for (const key of Array.from(u.searchParams.keys())) {
    if (dropKeys.has(key) || dropPrefixes.some(p => key.startsWith(p))) {
      u.searchParams.delete(key);
    }
  }
  return u.toString();
}

async function migrateStorage() {
  const data = await chrome.storage.sync.get(null);
  if (data.denylist && !data.domainList) {
    await chrome.storage.sync.set({
      domainList: data.denylist,
      filterMode: "denylist"
    });
    await chrome.storage.sync.remove("denylist");
  }
}

async function shouldSkipByFilter(url) {
  const { filterMode, domainList } = await chrome.storage.sync.get(DEFAULTS);
  const host = new URL(url).hostname;
  const inList = (domainList || []).some(x => x === host);
  if (filterMode === "allowlist") {
    return !inList;
  }
  return inList;
}

async function captureAndSend(tabId) {
  const cfg = await chrome.storage.sync.get(DEFAULTS);
  if (!cfg.token) return;

  const tab = await chrome.tabs.get(tabId);
  if (!tab || !tab.url) return;

  if (tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://")) return;
  if (await shouldSkipByFilter(tab.url)) return;

  const normalized = normalizeUrl(tab.url);
  const urlHash = await sha1Hex(normalized);

  const last = sentCache.get(urlHash) || 0;
  const now = Date.now();

  // Throttle: do not send the same normalized URL too frequently.
  if (now - last < 10 * 60 * 1000) return; // 10 minutes
  sentCache.set(urlHash, now);

  // Inject Readability.js for article extraction.
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['Readability.js']
  });

  // Extract article content using Readability, with innerText fallback.
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const canonical = document.querySelector('link[rel="canonical"]')?.href || null;
      try {
        const docClone = document.cloneNode(true);
        const article = new Readability(docClone).parse();
        if (article && article.textContent) {
          return {
            canonical,
            title: article.title || document.title || "",
            text: article.textContent,
          };
        }
      } catch { /* fall through */ }
      return {
        canonical,
        title: document.title || "",
        text: document.body?.innerText || "",
      };
    }
  });

  const payload = results?.[0]?.result;
  if (!payload) return;

  // Basic size guard to avoid huge sends.
  if (payload.text.length > 2_000_000) return; // 2MB chars

  const body = {
    raw_url: tab.url,
    normalized_url: normalized,
    canonical_url: payload.canonical,
    title: payload.title,
    text: payload.text,
    captured_at_ms: now
  };

  try {
    const resp = await fetch(cfg.ingestUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${cfg.token}`
      },
      body: JSON.stringify(body)
    });
    if (resp.ok) {
      setIconOk();
    } else {
      setIconError();
    }
  } catch {
    setIconError();
  }
}

migrateStorage();

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "complete") return;
  chrome.storage.sync.get(DEFAULTS).then(cfg => {
    const delay = Number(cfg.delayMs || 0);
    setTimeout(() => captureAndSend(tabId), delay);
  });
});
