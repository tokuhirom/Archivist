export function mountRoot() {
  const root = document.getElementById("app");
  if (!root) return;
  root.innerHTML = `
    <nav class="nav">
      <a href="#" class="nav-item active" data-view="search">Search</a>
      <a href="#" class="nav-item" data-view="stats">Stats</a>
      <a href="#" class="nav-item" data-view="settings">Settings</a>
    </nav>

    <div class="search-bar" id="searchBar">
      <input id="q" placeholder="Search (FTS5)" />
      <input id="hostFilter" class="small" placeholder="host filter (optional)" />
      <button id="searchBtn">Search</button>
    </div>

    <div id="view-search" class="view">
      <div class="main">
        <div class="left">
          <div id="results"></div>
        </div>
        <div class="right" id="preview"></div>
      </div>
    </div>

    <div id="view-stats" class="view" style="display:none">
      <div class="view-content">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <h2 style="margin:0;">Stats</h2>
          <button id="refreshStats">Refresh</button>
        </div>
        <div id="globalStats"></div>
        <h3 style="margin:20px 0 8px 0;">Domain Stats</h3>
        <div id="domainStats"></div>
      </div>
    </div>

    <div id="view-settings" class="view" style="display:none">
      <div class="view-content">
        <h2 style="margin:0 0 12px 0;">Settings</h2>
        <label>Ingest URL</label>
        <input id="ingestUrl" readonly style="width:100%;padding:8px;font-size:13px;margin-top:4px;" />
        <div style="margin-top:12px;">
          <label>Ingest token</label>
          <input id="token" readonly style="width:100%;padding:8px;font-size:13px;margin-top:4px;" />
        </div>
        <div style="margin-top:12px;">
          <label>Port</label>
          <div style="display:flex;gap:8px;align-items:center;margin-top:4px;">
            <input id="portInput" type="number" min="1" max="65535" style="width:120px;padding:8px;font-size:13px;" />
            <button id="savePort">Save</button>
            <span id="portMsg" style="font-size:12px;color:#666;"></span>
          </div>
        </div>
        <div style="margin-top:16px;">
          <label><input type="checkbox" id="autostart" /> Launch at login</label>
        </div>
      </div>
    </div>
  `;
}
