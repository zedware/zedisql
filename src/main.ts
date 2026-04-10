import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// --- Global State ---
class AppState {
  private static instance: AppState;
  private isConnected: boolean = false;
  private currentHost: string = "";
  private listeners: Set<(connected: boolean, host: string) => void> = new Set();
  private lastTotalXacts: number = 0;
  private pollInterval: any = null;

  private constructor() {}

  static getInstance() {
    if (!AppState.instance) AppState.instance = new AppState();
    return AppState.instance;
  }

  setConnection(status: boolean, host: string) {
    this.isConnected = status;
    this.currentHost = host;
    this.listeners.forEach(fn => fn(status, host));
    if (status) {
      this.startPolling();
    } else {
      this.stopPolling();
    }
  }

  private startPolling() {
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.pollInterval = setInterval(() => this.forceRefreshDashboard(), 2000);
  }

  async forceRefreshDashboard() {
    if (!this.isConnected) return;
    try {
      const stats = await invoke("get_dashboard_stats") as { active_sessions: number, idle_sessions: number, total_xacts: number };
      this.updateUIDashboard(stats);
    } catch (err) {
      console.error("Dashboard poll failed", err);
    }
  }

  private stopPolling() {
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.pollInterval = null;
    this.lastTotalXacts = 0;
  }

  private updateUIDashboard(stats: { active_sessions: number, idle_sessions: number, total_xacts: number }) {
    const activeSessionsEl = document.querySelector("#active-sessions-count");
    const sessionsBreakdownEl = document.querySelector("#sessions-breakdown");
    const tpsCountEl = document.querySelector("#tps-count");

    if (activeSessionsEl) activeSessionsEl.textContent = stats.active_sessions.toString();
    if (sessionsBreakdownEl) sessionsBreakdownEl.textContent = `${stats.idle_sessions} Idle, ${stats.active_sessions} Running`;
    
    if (tpsCountEl) {
      if (this.lastTotalXacts > 0) {
        const delta = stats.total_xacts - this.lastTotalXacts;
        const tps = Math.max(0, delta / 2).toFixed(1);
        tpsCountEl.textContent = `${tps} tps`;
      }
      this.lastTotalXacts = stats.total_xacts;
    }
  }

  onConnectionChange(fn: (connected: boolean, host: string) => void) {
    this.listeners.add(fn);
    if (this.isConnected) fn(true, this.currentHost);
  }

  getConnectionStatus() {
    return { isConnected: this.isConnected, host: this.currentHost };
  }
}

// --- Query Tool Instance ---
class QueryToolInstance {
  private id: string;
  private container: HTMLElement;
  private editor: HTMLTextAreaElement;
  private executeBtn: HTMLButtonElement;
  private saveBtn: HTMLButtonElement;
  private resultsHead: HTMLElement;
  private resultsBody: HTMLElement;
  private resultsContainer: HTMLElement;

  constructor(id: string, container: HTMLElement) {
    this.id = id;
    this.container = container;
    this.editor = container.querySelector(".sql-editor") as HTMLTextAreaElement;
    this.executeBtn = container.querySelector(".btn-execute") as HTMLButtonElement;
    this.saveBtn = container.querySelector(".btn-save") as HTMLButtonElement;
    this.resultsHead = container.querySelector(".results-head") as HTMLElement;
    this.resultsBody = container.querySelector(".results-body") as HTMLElement;
    this.resultsContainer = container.querySelector(".results-container") as HTMLElement;

    this.init();
  }

  private init() {
    this.executeBtn.addEventListener("click", () => this.execute());
    this.saveBtn.addEventListener("click", () => this.save());
    
    // Subscribe to connection changes
    AppState.getInstance().onConnectionChange((connected) => {
      this.editor.readOnly = !connected;
      this.editor.placeholder = connected 
        ? "Enter your SQL query here..." 
        : "Connect to a server to start writing SQL...";
    });
  }

  async execute() {
    const query = this.editor.value.trim();
    if (!query) return;

    const statusText = document.querySelector("#status-text");
    if (statusText) {
      statusText.textContent = "Executing query...";
      (statusText.parentElement as HTMLElement).style.backgroundColor = "var(--accent-blue)";
    }

    this.resultsContainer.classList.add("executing");
    const startTime = performance.now();

    try {
      const result = await invoke("execute_query", { query }) as { columns: string[], rows: string[][] };
      const duration = (performance.now() - startTime).toFixed(1);

      // Render Headers
      this.resultsHead.innerHTML = result.columns.map(c => `<th>${c}</th>`).join("");
      
      // Render Rows
      this.resultsBody.innerHTML = result.rows.map(row => `
        <tr>${row.map(val => `<td>${val}</td>`).join("")}</tr>
      `).join("");

      if (statusText) {
        statusText.textContent = `Query finished in ${duration}ms. (${result.rows.length} rows)`;
      }
    } catch (err) {
      console.error("Query execution failed:", err);
      const errMsg = typeof err === 'string' ? err : JSON.stringify(err);
      if (statusText) {
        statusText.textContent = `Query Error: ${errMsg}`;
        (statusText.parentElement as HTMLElement).style.backgroundColor = "var(--error)";
      }
    } finally {
      this.resultsContainer.classList.remove("executing");
    }
  }

  private save() {
    const content = this.editor.value;
    if (!content.trim()) return;

    const blob = new Blob([content], { type: "text/sql" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `query-${this.id}.sql`;
    a.click();
    URL.revokeObjectURL(url);
    
    const statusText = document.querySelector("#status-text");
    if (statusText) statusText.textContent = "SQL script saved to downloads.";
  }
}

// --- Tab Manager ---
class TabManager {
  private tabBar: HTMLElement;
  private viewContainer: HTMLElement;
  private tabs: Map<string, { tabEl: HTMLElement, paneEl: HTMLElement, instance?: QueryToolInstance }> = new Map();
  private queryToolCount: number = 0;
  private activeTabId: string | null = null;

  constructor() {
    this.tabBar = document.getElementById("tab-bar")!;
    this.viewContainer = document.getElementById("view-container")!;
    this.init();
  }

  private init() {
    const addBtn = document.getElementById("btn-add-tab");
    addBtn?.addEventListener("click", () => this.addQueryTool());

    // Listen for global menu events
    listen("menu-execute", () => this.executeActiveTab());
    listen("menu-save", () => this.saveActiveTab());
    listen("menu-new-query", () => this.addQueryTool());
  }

  addDashboard() {
    this.createTab("dashboard", "Dashboard", "dashboard-template", true);
  }

  addQueryTool() {
    this.queryToolCount++;
    const id = `query-tool-${Date.now()}`;
    const title = `Query Tool (${this.queryToolCount})`;
    this.createTab(id, title, "query-tool-template", false);
  }

  private createTab(id: string, title: string, templateId: string, isStatic: boolean) {
    // 1. Create Tab Element
    const tabEl = document.createElement("div");
    tabEl.className = "tab";
    tabEl.innerHTML = `
      <span class="tab-title">${title}</span>
      ${!isStatic ? '<span class="tab-close">&times;</span>' : ''}
    `;
    tabEl.onclick = (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains("tab-close")) {
        this.closeTab(id);
      } else {
        this.switchTab(id);
      }
    };

    // 2. Create Pane Element from Template
    const template = document.getElementById(templateId) as HTMLTemplateElement;
    const paneEl = document.createElement("div");
    paneEl.className = "view-pane";
    paneEl.id = `view-${id}`;
    paneEl.appendChild(template.content.cloneNode(true));

    // 3. Register
    let instance: QueryToolInstance | undefined;
    if (templateId === "query-tool-template") {
      instance = new QueryToolInstance(id, paneEl);
    }

    this.tabs.set(id, { tabEl, paneEl, instance });
    this.tabBar.appendChild(tabEl);
    this.viewContainer.appendChild(paneEl);

    this.switchTab(id);
  }

  switchTab(id: string) {
    this.activeTabId = id;
    this.tabs.forEach((data, tabId) => {
      const isActive = tabId === id;
      data.tabEl.classList.toggle("active", isActive);
      data.paneEl.classList.toggle("active", isActive);
    });
  }

  private executeActiveTab() {
    if (!this.activeTabId) return;
    const data = this.tabs.get(this.activeTabId);
    if (data?.instance) {
      data.instance.execute();
    }
  }

  private saveActiveTab() {
    if (!this.activeTabId) return;
    const data = this.tabs.get(this.activeTabId);
    if (data?.instance) {
      // Logic for saving (currently placeholder in QueryToolInstance)
      console.log("Saving tab:", this.activeTabId);
    }
  }

  closeTab(id: string) {
    const data = this.tabs.get(id);
    if (data) {
      data.tabEl.remove();
      data.paneEl.remove();
      this.tabs.delete(id);
      
      // If we closed the active tab, switch to the first available one
      if (this.tabs.size > 0) {
        const firstId = this.tabs.keys().next().value;
        this.switchTab(firstId);
      }
    }
  }

  getActiveInstance(): QueryToolInstance | undefined {
    let activeId: string | null = null;
    this.tabs.forEach((data, id) => {
      if (data.tabEl.classList.contains("active")) activeId = id;
    });
    return activeId ? this.tabs.get(activeId)?.instance : undefined;
  }
}

// --- Tree View ---
class TreeView {
  private container: HTMLElement;

  constructor(containerId: string) {
    this.container = document.getElementById(containerId)!;
  }

  async renderServers(catalogs: string[]) {
    this.container.innerHTML = "";
    
    for (const cat of catalogs) {
      const dbNode = this.createNode(cat, "database", true);
      this.container.appendChild(dbNode);
      
      const childrenContainer = document.createElement("div");
      childrenContainer.className = "tree-children";
      this.container.appendChild(childrenContainer);

      // Create "Tables" folder
      const tablesFolder = this.createNode("Tables", "folder", true);
      childrenContainer.appendChild(tablesFolder);

      const tablesContainer = document.createElement("div");
      tablesContainer.className = "tree-children";
      tablesContainer.style.display = "none"; // Hide by default
      childrenContainer.appendChild(tablesContainer);

      // Expansion logic for "Tables" folder
      tablesFolder.onclick = async () => {
        const isExpanded = tablesContainer.style.display !== "none";
        tablesContainer.style.display = isExpanded ? "none" : "block";
        
        if (!isExpanded && tablesContainer.innerHTML === "") {
          tablesContainer.innerHTML = '<div class="tree-node" style="color: var(--text-muted); padding-left: 12px;">Loading...</div>';
          await this.fetchAndRenderTables(tablesContainer);
        }
      };

      // Auto-expand the primary database (postgres)
      if (cat === "postgres") {
        tablesContainer.style.display = "block";
        tablesContainer.innerHTML = '<div class="tree-node" style="color: var(--text-muted); padding-left: 12px;">Loading...</div>';
        await this.fetchAndRenderTables(tablesContainer);
      }
    }
  }

  private async fetchAndRenderTables(container: HTMLElement) {
    try {
      const tables = await invoke("get_tables") as string[];
      container.innerHTML = "";
      
      if (tables.length === 0) {
        container.innerHTML = '<div class="tree-node" style="color: var(--text-muted); padding-left: 12px;">(No tables)</div>';
        return;
      }

      for (const table of tables) {
        const tableNode = this.createNode(table, "table", false);
        container.appendChild(tableNode);
      }
    } catch (err) {
      console.error("Failed to fetch tables", err);
      container.innerHTML = '<div class="tree-node" style="color: var(--error); padding-left: 12px;">Failed to load</div>';
    }
  }

  private createNode(label: string, type: "database" | "folder" | "table", isCollapsible: boolean): HTMLElement {
    const node = document.createElement("div");
    node.className = "tree-node";
    
    let icon = "";
    if (type === "database") {
      icon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
    } else if (type === "folder") {
      icon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
    } else if (type === "table") {
      icon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="9" x2="9" y2="21"/></svg>`;
    }

    node.innerHTML = `
      <span class="tree-node-icon">${icon}</span>
      <span>${label}</span>
      ${isCollapsible ? '<span style="margin-left: auto; font-size: 8px; opacity: 0.5;">▼</span>' : ''}
    `;
    return node;
  }
}

// --- App Initialization ---
window.addEventListener("DOMContentLoaded", () => {
  const tabManager = new TabManager();
  const treeView = new TreeView("server-list");
  
  // Initial Tabs
  tabManager.addDashboard();
  tabManager.addQueryTool();

  const modal = document.querySelector("#connection-modal") as HTMLElement;
  
  // Auto-popup connection modal on startup
  if (modal) {
    modal.style.display = "block";
    (document.querySelector("#db-host") as HTMLInputElement)?.focus();
  }
  const connectionForm = document.querySelector("#connection-form") as HTMLFormElement;
  const statusText = document.querySelector("#status-text");
  const closeIcon = document.querySelector("#close-modal-icon");
  const closeBtn = document.querySelector("#close-modal");

  // Listen for the menu event from Rust
  listen("menu-connect", () => {
    if (modal) {
      modal.style.display = "block";
      (document.querySelector("#db-host") as HTMLInputElement)?.focus();
    }
  });

  listen("menu-new-query", () => {
    tabManager.addQueryTool();
  });

  listen("menu-execute", () => {
    tabManager.getActiveInstance()?.execute();
  });

  const closeModal = () => {
    if (modal) modal.style.display = "none";
  };

  closeBtn?.addEventListener("click", closeModal);
  closeIcon?.addEventListener("click", closeModal);

  connectionForm?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const host = (document.querySelector("#db-host") as HTMLInputElement).value;
    const port = parseInt((document.querySelector("#db-port") as HTMLInputElement).value);
    const user = (document.querySelector("#db-user") as HTMLInputElement).value;
    const pass = (document.querySelector("#db-pass") as HTMLInputElement).value;
    const errorDiv = document.querySelector("#connection-error") as HTMLElement;
    const submitBtn = connectionForm.querySelector("button[type='submit']") as HTMLButtonElement;

    // Reset UI
    if (errorDiv) errorDiv.style.display = "none";
    if (statusText) {
      statusText.textContent = `Connecting to ${host}...`;
      (statusText.parentElement as HTMLElement).style.backgroundColor = "var(--accent-blue)";
    }
    submitBtn.disabled = true;
    submitBtn.textContent = "Connecting...";

    try {
      await invoke("connect_db", { config: { host, port, user, pass } });
      const catalogs = await invoke("get_catalogs") as string[];

      // Global Success State
      AppState.getInstance().setConnection(true, host);
      
      if (statusText) statusText.textContent = "Connected successfully.";
      treeView.renderServers(catalogs);
      
      // Update UI Globals
      const serverCountLabel = document.querySelector("#server-count-label");
      if (serverCountLabel) serverCountLabel.textContent = "Servers (1)";
      
      const activeServerName = document.querySelector("#active-server-name");
      if (activeServerName) activeServerName.textContent = host;

      closeModal();
    } catch (err) {
      console.error("Connection failed:", err);
      const errMsg = typeof err === 'string' ? err : JSON.stringify(err);
      if (errorDiv) {
        errorDiv.textContent = `Connection failed: ${errMsg}`;
        errorDiv.style.display = "block";
      }
      if (statusText) {
        statusText.textContent = `Error: ${errMsg}`;
        (statusText.parentElement as HTMLElement).style.backgroundColor = "var(--error)";
      }
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Connect";
    }
  });
  
  // Dashboard Refresh Hotkey (F5 / Cmd+R)
  document.addEventListener("keydown", (e) => {
    if (e.key === "F5" || ((e.metaKey || e.ctrlKey) && e.key === "r")) {
      // Only handle here if we ARE on the dashboard or if we want global Cmd+R
      // F5 should be allowed to propagate to the Menu listener if we are in an editor
      const activeTab = document.querySelector(".tab.active .tab-title")?.textContent;
      if (activeTab === "Dashboard") {
        e.preventDefault();
        AppState.getInstance().forceRefreshDashboard();
      }
    }
  });

  // Delegate Dashboard Refresh Button
  document.querySelector("#view-container")?.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const btn = target.closest("#btn-refresh-dashboard");
    if (btn) {
      AppState.getInstance().forceRefreshDashboard();
    }
  });
});