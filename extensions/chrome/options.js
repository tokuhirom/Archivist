const DEFAULTS = {
  ingestUrl: "http://127.0.0.1:17373/capture",
  token: "",
  delayMs: 2000,
  denylist: ["mail.google.com", "accounts.google.com"]
};

function setStatus(text, cls) {
  const el = document.getElementById("status");
  el.textContent = text;
  el.className = cls ? cls : "hint";
}

async function load() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  document.getElementById("ingestUrl").value = stored.ingestUrl;
  document.getElementById("token").value = stored.token;
  document.getElementById("delayMs").value = String(stored.delayMs);
  document.getElementById("denylist").value = (stored.denylist || []).join("\n");
}

async function save() {
  const ingestUrl = document.getElementById("ingestUrl").value.trim();
  const token = document.getElementById("token").value.trim();
  const delayMs = Number(document.getElementById("delayMs").value || 0);
  const denylist = document.getElementById("denylist").value
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);

  await chrome.storage.sync.set({ ingestUrl, token, delayMs, denylist });
  setStatus("Saved.", "ok");
}

async function test() {
  setStatus("Testing...", "hint");
  const { ingestUrl, token } = await chrome.storage.sync.get(DEFAULTS);
  try {
    const r = await fetch(ingestUrl.replace(/\/capture$/, "/healthz"), {
      method: "GET",
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    if (r.ok) {
      setStatus("OK: app is reachable.", "ok");
    } else {
      setStatus(`Error: ${r.status} ${r.statusText}`, "err");
    }
  } catch (e) {
    setStatus(`Error: ${String(e)}`, "err");
  }
}

document.getElementById("save").addEventListener("click", () => save());
document.getElementById("test").addEventListener("click", () => test());

load();
