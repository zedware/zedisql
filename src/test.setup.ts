import { vi } from "vitest";

// 1. Mock window methods that JSDOM might not support cleanly
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// 2. Mock Tauri IPC routes so frontend doesn't crash requesting Rust
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockImplementation((cmd, args) => {
    if (cmd === "get_catalogs") {
      return Promise.resolve(["mockDB", "postgres", "testdb"]);
    }
    if (cmd === "execute_query") {
      return Promise.resolve({
        columns: ["mock_col"],
        rows: [["1"], ["2"]],
        rows_affected: 0,
        command_tag: "SELECT"
      });
    }
    if (cmd === "cancel_query") {
      return Promise.resolve();
    }
    if (cmd === "get_dashboard_stats") {
      return Promise.resolve({
          active_sessions: 1, idle_sessions: 2, total_xacts: 100
      });
    }
    return Promise.resolve();
  })
}));

// 3. Mock Tauri events
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockImplementation(() => Promise.resolve(() => {}))
}));

// 4. Inject structural DOM templates globally. JSDOM requires DOM dependencies out-of-the-box.
const templatesHTML = `
  <template id="query-tool-template">
    <div class="query-tool">
      <div class="query-toolbar">
        <button class="tool-btn execute btn-execute">Execute</button>
        <button class="tool-btn btn-cancel" style="display: none;">Cancel</button>
        <button class="tool-btn btn-save">Save</button>
      </div>
      <div class="editor-container">
        <pre class="sql-highlighter"><code class="sql-code"></code></pre>
        <textarea class="sql-editor" spellcheck="false" readonly></textarea>
      </div>
      <div class="results-container">
        <table class="data-table">
          <thead><tr class="results-head"></tr></thead>
          <tbody class="results-body"></tbody>
        </table>
      </div>
    </div>
  </template>
  <template id="dashboard-template">
    <div class="dashboard"><div class="stat-value" id="active-sessions">0</div><div class="stat-value" id="idle-sessions">0</div><div class="stat-value" id="tps">0</div></div>
  </template>
  <template id="history-template">
    <div class="history-view"><ul class="history-list"></ul></div>
  </template>
`;
document.body.innerHTML += templatesHTML;
