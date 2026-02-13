const DEFAULTS = {
  ingestUrl: "http://127.0.0.1:17373/capture",
  token: "",
  delayMs: 2000,
  filterMode: "denylist",
  domainList: ["mail.google.com", "accounts.google.com"]
};

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

function updateFilterModeUI(mode) {
  const label = document.getElementById("domainListLabel");
  const hint = document.getElementById("domainListHint");
  if (mode === "allowlist") {
    label.textContent = "Allowlist (one host per line)";
    hint.textContent = "Only pages whose hostname matches a line below will be captured.";
  } else {
    label.textContent = "Denylist (one host per line)";
    hint.textContent = "If the page hostname matches any line, Archivist Capture will skip sending.";
  }
}

function setStatus(text, cls) {
  const el = document.getElementById("status");
  el.textContent = text;
  el.className = cls ? cls : "hint";
}

async function load() {
  await migrateStorage();
  const stored = await chrome.storage.sync.get(DEFAULTS);
  document.getElementById("ingestUrl").value = stored.ingestUrl;
  document.getElementById("token").value = stored.token;
  document.getElementById("delayMs").value = String(stored.delayMs);
  document.getElementById("domainList").value = (stored.domainList || []).join("\n");

  const mode = stored.filterMode || "denylist";
  const radio = document.querySelector(`input[name="filterMode"][value="${mode}"]`);
  if (radio) radio.checked = true;
  updateFilterModeUI(mode);
}

async function save() {
  const ingestUrl = document.getElementById("ingestUrl").value.trim();
  const token = document.getElementById("token").value.trim();
  const delayMs = Number(document.getElementById("delayMs").value || 0);
  const filterMode = document.querySelector('input[name="filterMode"]:checked').value;
  const domainList = document.getElementById("domainList").value
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);

  if (filterMode === "allowlist" && domainList.length === 0) {
    setStatus("Warning: empty allowlist means no pages will be captured.", "err");
  }

  await chrome.storage.sync.set({ ingestUrl, token, delayMs, filterMode, domainList });
  await chrome.storage.sync.remove("denylist");

  if (filterMode !== "allowlist" || domainList.length > 0) {
    setStatus("Saved.", "ok");
  }
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
document.querySelectorAll('input[name="filterMode"]').forEach(radio => {
  radio.addEventListener("change", (e) => updateFilterModeUI(e.target.value));
});

load();
