export function mountRoot() {
  const root = document.getElementById("app");
  if (!root) return;
  root.innerHTML = `
    <div class="header">
      <input id="q" placeholder="Search (FTS5)" />
      <input id="hostFilter" class="small" placeholder="host filter (optional)" />
      <button id="searchBtn">Search</button>
    </div>

    <div class="main">
      <div class="left">
        <div id="results"></div>
        <div class="panel">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div style="font-weight:700;">Domain stats</div>
            <button id="refreshStats">Refresh</button>
          </div>
          <div id="domainStats"></div>
        </div>
        <div class="settings">
          <label>Ingest token (copy into the Chrome extension options)</label>
          <input id="token" readonly />
        </div>
      </div>
      <div class="right" id="preview"></div>
    </div>
  `;
}
