import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { PG_KEYWORDS, PG_FUNCTIONS, PG_TYPES } from "./sqlKeywords";

// --- Utilities ---
function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// --- History Management ---
interface HistoryEntry {
  id: string;
  query: string;
  timestamp: number;
  status: "success" | "error";
  database: string;
  duration: string;
}

class HistoryManager {
  private static instance: HistoryManager;
  private entries: HistoryEntry[] = [];
  private readonly MAX_ENTRIES = 100;

  private constructor() {
    this.load();
  }

  static getInstance() {
    if (!HistoryManager.instance) HistoryManager.instance = new HistoryManager();
    return HistoryManager.instance;
  }

  addEntry(query: string, status: "success" | "error", database: string, duration: string) {
    const entry: HistoryEntry = {
      id: Date.now().toString(),
      query,
      timestamp: Date.now(),
      status,
      database,
      duration
    };
    this.entries.unshift(entry);
    if (this.entries.length > this.MAX_ENTRIES) {
      this.entries = this.entries.slice(0, this.MAX_ENTRIES);
    }
    this.save();
    return entry;
  }

  getEntries() {
    return [...this.entries];
  }

  deleteEntry(id: string) {
    this.entries = this.entries.filter(e => e.id !== id);
    this.save();
  }

  clear() {
    this.entries = [];
    this.save();
  }

  private load() {
    try {
      const data = localStorage.getItem("zedisql_history");
      if (data) this.entries = JSON.parse(data);
    } catch (err) {
      console.error("Failed to load history", err);
    }
  }

  private save() {
    localStorage.setItem("zedisql_history", JSON.stringify(this.entries));
  }
}

// --- Global State ---
class AppState {
  private static instance: AppState;
  private isConnected: boolean = false;
  private currentHost: string = "";
  private listeners: Set<(connected: boolean, host: string) => void> = new Set();
  private lastTotalXacts: number = 0;
  private pollInterval: any = null;
  private activeDatabase: string = "postgres";

  private constructor() { }

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

  setActiveDatabase(dbName: string) {
    this.activeDatabase = dbName;
  }

  getActiveDatabase() {
    return this.activeDatabase;
  }

  getConnectionStatus() {
    return { isConnected: this.isConnected, host: this.currentHost, activeDatabase: this.activeDatabase };
  }
}

// --- Context Menu ---
class ContextMenu {
  private el: HTMLElement;
  private static instance: ContextMenu;

  private constructor() {
    this.el = document.createElement("div");
    this.el.className = "context-menu";
    document.body.appendChild(this.el);

    // Hide menu on any click or window resize
    window.addEventListener("click", () => this.hide());
    window.addEventListener("resize", () => this.hide());
    // Also hide if right-clicking elsewhere
    document.addEventListener("contextmenu", (e) => {
      if (!(e.target as HTMLElement).closest(".tree-node")) {
        this.hide();
      }
    });
  }

  static getInstance() {
    if (!ContextMenu.instance) ContextMenu.instance = new ContextMenu();
    return ContextMenu.instance;
  }

  show(x: number, y: number, items: { label: string, icon?: string, onClick: () => void, divider?: boolean }[]) {
    this.el.innerHTML = "";
    items.forEach(item => {
      if (item.divider) {
        const div = document.createElement("div");
        div.className = "context-menu-divider";
        this.el.appendChild(div);
      }
      const menuItem = document.createElement("div");
      menuItem.className = "context-menu-item";
      menuItem.innerHTML = `
        ${item.icon || ''}
        <span>${item.label}</span>
      `;
      menuItem.onclick = (e) => {
        e.stopPropagation();
        item.onClick();
        this.hide();
      };
      this.el.appendChild(menuItem);
    });

    this.el.style.display = "block";
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;

    // Boundary check
    const rect = this.el.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      this.el.style.left = `${x - rect.width}px`;
    }
    if (rect.bottom > window.innerHeight) {
      this.el.style.top = `${y - rect.height}px`;
    }
  }

  hide() {
    this.el.style.display = "none";
  }
}

// --- Confirmation Modal ---
class ConfirmModal {
  private static instance: ConfirmModal;
  private el: HTMLElement;
  private titleEl: HTMLElement;
  private messageEl: HTMLElement;
  private okBtn: HTMLButtonElement;
  private cancelBtn: HTMLButtonElement;
  private resolveFn: ((value: boolean) => void) | null = null;

  private constructor() {
    this.el = document.getElementById("confirm-modal")!;
    this.titleEl = document.getElementById("confirm-title")!;
    this.messageEl = document.getElementById("confirm-message")!;
    this.okBtn = document.getElementById("confirm-ok") as HTMLButtonElement;
    this.cancelBtn = document.getElementById("confirm-cancel") as HTMLButtonElement;

    this.okBtn.onclick = () => this.finish(true);
    this.cancelBtn.onclick = () => this.finish(false);
    this.el.onclick = (e) => {
      if (e.target === this.el) this.finish(false);
    };
  }

  static getInstance() {
    if (!ConfirmModal.instance) ConfirmModal.instance = new ConfirmModal();
    return ConfirmModal.instance;
  }

  static async ask(title: string, message: string, okLabel: string = "Proceed"): Promise<boolean> {
    return ConfirmModal.getInstance().show(title, message, okLabel);
  }

  private show(title: string, message: string, okLabel: string): Promise<boolean> {
    this.titleEl.textContent = title;
    this.messageEl.textContent = message;
    this.okBtn.textContent = okLabel;
    this.el.style.display = "block";

    return new Promise((resolve) => {
      this.resolveFn = resolve;
    });
  }

  private finish(result: boolean) {
    this.el.style.display = "none";
    if (this.resolveFn) {
      this.resolveFn(result);
      this.resolveFn = null;
    }
  }
}

// --- Query Tool Instance ---
export class QueryToolInstance {
  private id: string;
  private container: HTMLElement;
  private editor: HTMLTextAreaElement;
  private preContainer: HTMLElement;
  private codeLayer: HTMLElement;
  private executeBtn: HTMLButtonElement;
  private cancelBtn: HTMLButtonElement;
  private saveBtn: HTMLButtonElement;
  private resultsHead: HTMLElement;
  private resultsBody: HTMLElement;
  private resultsContainer: HTMLElement;
  private tabManager?: TabManager;

  constructor(id: string, container: HTMLElement) {
    this.id = id;
    this.container = container;
    this.editor = container.querySelector(".sql-editor") as HTMLTextAreaElement;
    this.preContainer = container.querySelector(".sql-highlighter") as HTMLElement;
    this.codeLayer = container.querySelector(".sql-code") as HTMLElement;
    this.executeBtn = container.querySelector(".btn-execute") as HTMLButtonElement;
    this.cancelBtn = container.querySelector(".btn-cancel") as HTMLButtonElement;
    this.saveBtn = container.querySelector(".btn-save") as HTMLButtonElement;
    this.resultsHead = container.querySelector(".results-head") as HTMLElement;
    this.resultsBody = container.querySelector(".results-body") as HTMLElement;
    this.resultsContainer = container.querySelector(".results-container") as HTMLElement;

    this.init();
  }

  setTabManager(tm: TabManager) {
    this.tabManager = tm;
  }

  private init() {
    this.executeBtn.addEventListener("click", () => this.execute());
    this.cancelBtn.addEventListener("click", () => this.cancel());
    this.saveBtn.addEventListener("click", () => this.save());

    // Setup Syntax Highlighting Sync
    this.editor.addEventListener("input", () => this.syncHighlight());
    this.editor.addEventListener("scroll", () => {
      this.preContainer.scrollTop = this.editor.scrollTop;
      this.preContainer.scrollLeft = this.editor.scrollLeft;
    });

    // Subscribe to connection changes
    AppState.getInstance().onConnectionChange((connected) => {
      this.editor.readOnly = !connected;
      this.editor.placeholder = connected
        ? "Enter your SQL query here..."
        : "Connect to a server to start writing SQL...";
    });

    // Handle Ctrl+Enter / Cmd+Enter execution
    this.editor.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.execute();
      }
    });
  }

  setQuery(query: string, autoExecute: boolean = false) {
    this.editor.value = query;
    this.syncHighlight();
    if (autoExecute) {
      this.execute();
    }
  }

  private syncHighlight() {
    let text = this.editor.value;
    if (text[text.length - 1] === "\n") text += " ";
    
    // 1. Escape HTML
    text = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    // 2. Tokenize logic (single pass execution to prevent double-replacements)
    const regex = /('.*?'|--.*$|\/\*[\s\S]*?\*\/|\b\d+(?:\.\d+)?\b|\b\w+\b|[-+*\/=<>!]+)/gm;
    
    text = text.replace(regex, (match) => {
        if (match.startsWith("'")) return `<span class="hl-string">${match}</span>`;
        if (match.startsWith("--") || match.startsWith("/*")) return `<span class="hl-comment">${match}</span>`;
        if (/^[\d.]+$/.test(match)) return `<span class="hl-number">${match}</span>`;
        
        if (/^[a-zA-Z_]\w*$/.test(match)) {
            const upper = match.toUpperCase();
            if (PG_KEYWORDS.has(upper)) return `<span class="hl-keyword">${match}</span>`;
            if (PG_FUNCTIONS.has(upper) || PG_FUNCTIONS.has(match.toLowerCase())) return `<span class="hl-function">${match}</span>`;
            if (PG_TYPES.has(upper) || PG_TYPES.has(match.toLowerCase())) return `<span class="hl-keyword" style="color: #4ec9b0;">${match}</span>`;
        }
        
        if (/^[-+*\/=<>!]+$/.test(match)) return `<span class="hl-operator">${match}</span>`;
        return match;
    });

    this.codeLayer.innerHTML = text;
  }

  async cancel() {
    try {
      await invoke("cancel_query", { tabId: this.id });
    } catch (err) {
      console.error("Failed to cancel query:", err);
    }
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
    this.executeBtn.style.display = "none";
    this.cancelBtn.style.display = "flex";
    const startTime = performance.now();

    try {
      const result = await invoke("execute_query", { query, tabId: this.id }) as {
        columns: string[],
        rows: string[][],
        rows_affected: number,
        command_tag: string
      };
      const duration = (performance.now() - startTime).toFixed(1);

      // Render Headers
      this.resultsHead.innerHTML = result.columns.map(c => `<th>${c}</th>`).join("");

      // Render Rows
      this.resultsBody.innerHTML = result.rows.map(row => `
        <tr>${row.map(val => `<td>${val}</td>`).join("")}</tr>
      `).join("");

      // Log to history
      HistoryManager.getInstance().addEntry(query, "success", AppState.getInstance().getActiveDatabase(), `${duration}ms`);
      this.tabManager?.refreshHistoryView();

      if (statusText) {
        const isDataReturning = result.rows.length > 0 || (result.command_tag === "SELECT" || result.command_tag === "SHOW" || result.command_tag === "WITH");
        if (isDataReturning) {
          statusText.textContent = `${result.command_tag} finished in ${duration}ms. (${result.rows.length} rows returned)`;
        } else {
          statusText.textContent = `${result.command_tag} finished in ${duration}ms. (${result.rows_affected} rows affected)`;
        }
      }
    } catch (err) {
      console.error("Query execution failed:", err);
      // Log error to history
      HistoryManager.getInstance().addEntry(query, "error", AppState.getInstance().getActiveDatabase(), "N/A");
      this.tabManager?.refreshHistoryView();

      const errMsg = typeof err === 'string' ? err : JSON.stringify(err);
      if (statusText) {
        statusText.textContent = `Query Error: ${errMsg}`;
        (statusText.parentElement as HTMLElement).style.backgroundColor = "var(--error)";
      }
    } finally {
      this.executeBtn.style.display = "flex";
      this.cancelBtn.style.display = "none";
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

// --- History View ---
class HistoryView {
  private container: HTMLElement;
  private listEl: HTMLElement;
  private tabManager: TabManager;

  constructor(container: HTMLElement, tabManager: TabManager) {
    this.container = container;
    this.listEl = container.querySelector("#history-list-container")!;
    this.tabManager = tabManager;
    this.init();
  }

  private init() {
    const searchInput = this.container.querySelector("#history-search") as HTMLInputElement;
    const clearBtn = this.container.querySelector("#btn-clear-all-history");

    searchInput?.addEventListener("input", () => {
      this.render(searchInput.value);
    });

    clearBtn?.addEventListener("click", async () => {
      const confirmed = await ConfirmModal.ask(
        "Clear History",
        "Are you sure you want to delete all SQL history? This cannot be undone.",
        "Clear All"
      );

      if (confirmed) {
        HistoryManager.getInstance().clear();
        this.render();
      }
    });

    this.render();
  }

  public render(filterQuery: string = "") {
    const q = filterQuery.toLowerCase().trim();
    const entries = HistoryManager.getInstance().getEntries().filter(e => {
      if (!q) return true;
      return e.query.toLowerCase().includes(q) || e.database.toLowerCase().includes(q);
    });

    if (entries.length === 0) {
      this.listEl.innerHTML = `
        <div style="color: var(--text-muted); text-align: center; padding: 40px;">
          No items found in history.
        </div>
      `;
      return;
    }

    this.listEl.innerHTML = "";
    entries.forEach(entry => {
      const item = document.createElement("div");
      item.className = "history-item";

      const dateStr = new Date(entry.timestamp).toLocaleString();

      item.innerHTML = `
        <div class="history-item-header">
          <span class="history-item-status ${entry.status}">${entry.status}</span>
          <span class="history-item-time">${dateStr} [${entry.database}] - ${entry.duration}</span>
        </div>
        <div class="history-item-content">${escapeHtml(entry.query)}</div>
        <div class="history-item-actions">
          <button class="history-action-btn" data-action="open">Open in Editor</button>
          <button class="history-action-btn" data-action="copy">Copy</button>
          <button class="history-action-btn delete" data-action="delete">Delete</button>
        </div>
      `;

      // Event Listeners for actions
      item.querySelector('[data-action="open"]')?.addEventListener("click", () => {
        this.tabManager.addQueryTool(entry.query);
      });

      item.querySelector('[data-action="copy"]')?.addEventListener("click", () => {
        navigator.clipboard.writeText(entry.query);
        const statusText = document.querySelector("#status-text");
        if (statusText) statusText.textContent = "Query copied to clipboard.";
      });

      item.querySelector('[data-action="delete"]')?.addEventListener("click", () => {
        HistoryManager.getInstance().deleteEntry(entry.id);
        this.render(filterQuery);
      });

      this.listEl.appendChild(item);
    });
  }
}

// --- Tab Manager ---
export class TabManager {
  private tabBar: HTMLElement;
  private viewContainer: HTMLElement;
  private tabs: Map<string, { tabEl: HTMLElement, paneEl: HTMLElement, instance?: QueryToolInstance, historyView?: HistoryView }> = new Map();
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

  addHistoryTab() {
    this.createTab("history", "History", "history-template", true);
  }

  addQueryTool(initialQuery?: string, autoExecute: boolean = false) {
    this.queryToolCount++;
    const id = `query-tool-${Date.now()}`;
    const title = `Query Tool (${this.queryToolCount})`;
    this.createTab(id, title, "query-tool-template", false, initialQuery, autoExecute);
  }

  private createTab(id: string, title: string, templateId: string, isStatic: boolean, initialQuery?: string, autoExecute: boolean = false) {
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

    let instance: QueryToolInstance | undefined;
    let historyView: HistoryView | undefined;

    if (templateId === "query-tool-template") {
      instance = new QueryToolInstance(id, paneEl);
      instance.setTabManager(this);
      if (initialQuery) {
        instance.setQuery(initialQuery, autoExecute);
      }
    } else if (templateId === "history-template") {
      historyView = new HistoryView(paneEl, this);
    }

    this.tabs.set(id, { tabEl, paneEl, instance, historyView });
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

      // Refresh if it's the history tab
      if (isActive && data.historyView) {
        data.historyView.render();
      }
    });
  }

  refreshHistoryView() {
    this.tabs.forEach((data) => {
      if (data.historyView) {
        data.historyView.render();
      }
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
  private tabManager: TabManager;

  constructor(containerId: string, tabManager: TabManager) {
    this.container = document.getElementById(containerId)!;
    this.tabManager = tabManager;

    // Suppress broad context menu in the sidebar area
    this.container.closest("#sidebar")?.addEventListener("contextmenu", (e) => {
      e.preventDefault();
    });

    // Attach to root node
    const rootNode = document.getElementById("root-node");
    if (rootNode) {
      rootNode.oncontextmenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.showServerMenu(e.clientX, e.clientY);
      };
    }
  }

  async renderServers(catalogs: string[]) {
    this.container.innerHTML = "";
    const { host } = AppState.getInstance().getConnectionStatus();

    // 1. Server Node
    const serverNode = this.createNode(host || "localhost", "database", true);
    this.container.appendChild(serverNode);

    const serverChildren = document.createElement("div");
    serverChildren.className = "tree-children";
    this.container.appendChild(serverChildren);

    // 2. Databases Folder
    const databasesFolder = this.createNode("Databases", "folder", true);
    serverChildren.appendChild(databasesFolder);

    const databasesContainer = document.createElement("div");
    databasesContainer.className = "tree-children";
    databasesContainer.style.display = "block"; // Open by default
    serverChildren.appendChild(databasesContainer);

    databasesFolder.onclick = () => {
      const isExpanded = databasesContainer.style.display !== "none";
      databasesContainer.style.display = isExpanded ? "none" : "block";
    };

    // 3. Database List
    for (const dbName of catalogs) {
      const isConnected = dbName === AppState.getInstance().getActiveDatabase();
      const dbNode = this.createNode(dbName, "database", true, undefined, undefined, isConnected);
      databasesContainer.appendChild(dbNode);

      const dbChildren = document.createElement("div");
      dbChildren.className = "tree-children";
      dbChildren.style.display = isConnected ? "block" : "none";
      databasesContainer.appendChild(dbChildren);

      dbNode.onclick = async () => {
        const isActive = AppState.getInstance().getActiveDatabase() === dbName;
        if (!isActive) {
          await this.connectToDatabase(dbName);
        } else {
          // Toggle Expand if already active
          const isExpanded = dbChildren.style.display !== "none";
          dbChildren.style.display = isExpanded ? "none" : "block";
          if (!isExpanded && dbChildren.innerHTML === "") {
            dbChildren.innerHTML = '<div class="tree-node" style="color: var(--text-muted); padding-left: 12px;">Loading...</div>';
            await this.fetchAndRenderSchemas(dbChildren);
          }
        }
      };

      // Auto-expand active DB schemas
      if (isConnected && dbChildren.innerHTML === "") {
        dbChildren.innerHTML = '<div class="tree-node" style="color: var(--text-muted); padding-left: 12px;">Loading...</div>';
        await this.fetchAndRenderSchemas(dbChildren);
      }
    }
  }

  private async connectToDatabase(dbName: string) {
    try {
      const statusText = document.querySelector("#status-text");
      if (statusText) statusText.textContent = `Connecting to database ${dbName}...`;

      await invoke("switch_database", { database: dbName });
      AppState.getInstance().setActiveDatabase(dbName);

      // Re-render the whole server tree to update indicators and expansion
      await this.refreshTree();
    } catch (err) {
      console.error("Connect failed", err);
      alert("Failed to connect to database: " + err);
    }
  }

  private async disconnectDatabase() {
    try {
      // Disconnect from the current active database
      AppState.getInstance().setActiveDatabase(null);
      await this.refreshTree();

      const statusText = document.querySelector("#status-text");
      if (statusText) statusText.textContent = "Database disconnected.";
    } catch (err) {
      console.error("Disconnect failed", err);
    }
  }

  private async fetchAndRenderSchemas(container: HTMLElement) {
    try {
      const allTables = await invoke("get_tables") as { schemaname: string, tablename: string }[];
      container.innerHTML = "";

      // Group tables by schema
      const grouped = allTables.reduce((acc, curr) => {
        if (!acc[curr.schemaname]) acc[curr.schemaname] = [];
        acc[curr.schemaname].push(curr.tablename);
        return acc;
      }, {} as Record<string, string[]>);

      const schemas = Object.keys(grouped).sort();

      for (const schemaName of schemas) {
        const schemaNode = this.createNode(schemaName, "folder", true);
        container.appendChild(schemaNode);

        const schemaChildren = document.createElement("div");
        schemaChildren.className = "tree-children";
        schemaChildren.style.display = "none";
        container.appendChild(schemaChildren);

        schemaNode.onclick = () => {
          const isExpanded = schemaChildren.style.display !== "none";
          schemaChildren.style.display = isExpanded ? "none" : "block";
          if (!isExpanded && schemaChildren.innerHTML === "") {
            this.renderSchemaContents(schemaChildren, schemaName, grouped[schemaName]);
          }
        };

        // Auto-expand the public schema for convenience
        if (schemaName === "public") {
          schemaChildren.style.display = "block";
          this.renderSchemaContents(schemaChildren, schemaName, grouped[schemaName]);
        }
      }
    } catch (err) {
      console.error("Failed to fetch schemas", err);
      container.innerHTML = '<div class="tree-node" style="color: var(--error); padding-left: 12px;">Failed to load</div>';
    }
  }

  private renderSchemaContents(container: HTMLElement, schemaName: string, tables: string[]) {
    container.innerHTML = "";

    // Create "Tables" folder inside the schema
    const tablesFolder = this.createNode("Tables", "folder", true);
    container.appendChild(tablesFolder);

    const tablesContainer = document.createElement("div");
    tablesContainer.className = "tree-children";
    tablesContainer.style.display = "block"; // Auto-expand tables list if schema is expanded
    container.appendChild(tablesContainer);

    for (const tableName of tables) {
      const fullId = `${schemaName}.${tableName}`;
      const tableNode = this.createNode(tableName, "table", false, tablesContainer, fullId);
      tablesContainer.appendChild(tableNode);
    }

    // Handle "Tables" folder toggle locally
    tablesFolder.onclick = () => {
      const isExpanded = tablesContainer.style.display !== "none";
      tablesContainer.style.display = isExpanded ? "none" : "block";
    };
  }

  private createNode(label: string, type: "database" | "folder" | "table", isCollapsible: boolean, parentContainer?: HTMLElement, fullId?: string, isActive: boolean = false): HTMLElement {
    const node = document.createElement("div");
    node.className = "tree-node";
    if (isActive) node.classList.add("active");

    let icon = "";
    if (type === "database") {
      icon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
    } else if (type === "folder") {
      icon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
    } else if (type === "table") {
      icon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="9" x2="9" y2="21"/></svg>`;
    }

    const queryId = fullId || label;

    // Handle Context Menu for all types
      node.oncontextmenu = (e) => {
        e.preventDefault();
        e.stopPropagation();

        // Visual selection feedback
        document.querySelectorAll(".tree-node").forEach(n => n.classList.remove("selected"));
        node.classList.add("selected");

        if (type === "table") {
          this.showTableMenu(e.clientX, e.clientY, queryId, parentContainer);
        } else if (type === "database") {
          this.showDatabaseMenu(e.clientX, e.clientY, label);
        } else if (type === "folder") {
          this.showFolderMenu(e.clientX, e.clientY);
        }
      };

    node.innerHTML = `
      <span class="tree-node-icon">${icon}</span>
      <span>${label}</span>
      ${isCollapsible ? '<span style="margin-left: auto; font-size: 8px; opacity: 0.5;">▼</span>' : ''}
      ${isActive ? '<span class="connected-indicator" title="Connected"></span>' : ''}
    `;

    // Normal Click selection
    node.addEventListener("click", () => {
      document.querySelectorAll(".tree-node").forEach(n => n.classList.remove("selected"));
      node.classList.add("selected");
    });

    return node;
  }

  private showServerMenu(x: number, y: number) {
    ContextMenu.getInstance().show(x, y, [
      {
        label: "Refresh",
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`,
        onClick: async () => await this.refreshTree()
      },
      {
        label: "Disconnect",
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>`,
        onClick: () => {
          AppState.getInstance().setConnection(false, null);
          const modal = document.querySelector("#connection-modal") as HTMLElement;
          if (modal) modal.style.display = "block";
          this.container.innerHTML = "";
        }
      }
    ]);
  }

  private showDatabaseMenu(x: number, y: number, dbName: string) {
    const isActive = AppState.getInstance().getActiveDatabase() === dbName;

    const menuItems = [
      {
        label: "Refresh",
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`,
        onClick: async () => await this.refreshTree()
      }
    ];

    if (!isActive) {
      menuItems.push({
        label: "Connect Database",
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>`,
        onClick: async () => await this.connectToDatabase(dbName)
      });
    } else {
      menuItems.push({
        label: "Disconnect Database",
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>`,
        onClick: async () => await this.disconnectDatabase()
      });
    }

    menuItems.push({ divider: true, label: "", onClick: () => { } });

    menuItems.push({
      label: "Delete/Drop Database",
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
      onClick: async () => {
        const confirmed = await ConfirmModal.ask(
          "Drop Database",
          `Are you sure you want to drop database "${dbName}"? This action cannot be undone.`,
          "Drop Database"
        );

        if (confirmed) {
          try {
            await invoke("execute_utility", { query: `DROP DATABASE ${dbName}` });
            await this.refreshTree();
          } catch (err) {
            alert("Error dropping database: " + err);
          }
        }
      }
    });

    ContextMenu.getInstance().show(x, y, menuItems);
  }

  private showFolderMenu(x: number, y: number) {
    ContextMenu.getInstance().show(x, y, [
      {
        label: "Refresh",
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`,
        onClick: async () => await this.refreshTree()
      }
    ]);
  }

  private showTableMenu(x: number, y: number, queryId: string, parentContainer?: HTMLElement) {
    const [schema, table] = queryId.split(".");

    ContextMenu.getInstance().show(x, y, [
      {
        label: "Refresh",
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`,
        onClick: async () => await this.refreshTree()
      },
      { divider: true, label: "", onClick: () => { } },
      {
        label: "View Data (All Rows)",
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
        onClick: () => this.tabManager.addQueryTool(`SELECT * FROM ${queryId} LIMIT 1000;`, true)
      },
      {
        label: "View Data (First 100)",
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
        onClick: () => this.tabManager.addQueryTool(`SELECT * FROM ${queryId} LIMIT 100;`, true)
      },
      { divider: true, label: "", onClick: () => { } },
      {
        label: "Scripts > SELECT",
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
        onClick: async () => this.generateScript("SELECT", schema, table)
      },
      {
        label: "Scripts > INSERT",
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
        onClick: async () => this.generateScript("INSERT", schema, table)
      },
      { divider: true, label: "", onClick: () => { } },
      {
        label: "Count Rows",
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>`,
        onClick: () => this.tabManager.addQueryTool(`SELECT count(*) FROM ${queryId};`, true)
      },
      {
        label: "Truncate",
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
        onClick: async () => {
          const confirmed = await ConfirmModal.ask(
            "Truncate Table",
            `Are you sure you want to truncate table "${queryId}"? All data will be deleted.`,
            "Truncate"
          );

          if (confirmed) {
            try {
              await invoke("execute_utility", { query: `TRUNCATE TABLE ${queryId} RESTART IDENTITY CASCADE` });
              // alert("Table truncated.");
              const statusText = document.querySelector("#status-text");
              if (statusText) statusText.textContent = `Table ${queryId} truncated successfully.`;
            } catch (err) {
              alert("Error: " + err);
            }
          }
        }
      },
      {
        label: "Drop Table",
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
        onClick: async () => {
          const confirmed = await ConfirmModal.ask(
            "Drop Table",
            `Are you sure you want to drop table "${queryId}"? This action cannot be undone.`,
            "Drop Table"
          );

          if (confirmed) {
            try {
              await invoke("execute_utility", { query: `DROP TABLE ${queryId} CASCADE` });
              await this.refreshTree();
            } catch (err) {
              alert("Error: " + err);
            }
          }
        }
      },
      { divider: true, label: "", onClick: () => { } },
      {
        label: "Refresh",
        icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`,
        onClick: async () => await this.refreshTree()
      }
    ]);
  }

  private async generateScript(type: "SELECT" | "INSERT", schema: string, table: string) {
    try {
      const columns = await invoke("get_table_columns", { schema, table }) as { name: string, data_type: string }[];
      const colNames = columns.map(c => c.name);

      let sql = "";
      if (type === "SELECT") {
        sql = `SELECT ${colNames.join(", ")}\nFROM ${schema}.${table};`;
      } else if (type === "INSERT") {
        const placeholders = colNames.map(c => `? /* ${c} */`).join(", ");
        sql = `INSERT INTO ${schema}.${table} (${colNames.join(", ")})\nVALUES (${placeholders});`;
      }

      this.tabManager.addQueryTool(sql, false);
    } catch (err) {
      alert("Error generating script: " + err);
    }
  }

  public async refreshTree() {
    try {
      const catalogs = await invoke("get_catalogs") as string[];
      await this.renderServers(catalogs);

      // Re-apply search filter if active
      const searchInput = document.getElementById("tree-search") as HTMLInputElement;
      if (searchInput && searchInput.value) {
        this.applyFilter(searchInput.value);
      }
    } catch (err) {
      console.error("Refresh failed", err);
    }
  }

  public applyFilter(query: string) {
    const q = query.toLowerCase().trim();
    const allNodes = Array.from(this.container.querySelectorAll(".tree-node"));
    const allContainers = Array.from(this.container.querySelectorAll(".tree-children"));

    // Reset visibility
    allNodes.forEach(n => (n as HTMLElement).classList.remove("hidden"));
    allContainers.forEach(c => (c as HTMLElement).classList.remove("hidden"));

    if (!q) return;

    // Filter
    allNodes.forEach(node => {
      const el = node as HTMLElement;
      const text = el.textContent?.toLowerCase() || "";
      const matches = text.includes(q);

      if (!matches) {
        el.classList.add("hidden");
        // Hide associated children if any
        const next = el.nextElementSibling;
        if (next?.classList.contains("tree-children")) {
          (next as HTMLElement).classList.add("hidden");
        }
      }
    });

    // Reveal parents of matched nodes
    allNodes.forEach(node => {
      const el = node as HTMLElement;
      if (!el.classList.contains("hidden")) {
        let parent = el.parentElement;
        while (parent && parent !== this.container) {
          if (parent.classList.contains("tree-children")) {
            parent.classList.remove("hidden");
            parent.style.display = "block"; // Expand parent to show match

            // Show the folder/parent node itself
            const parentNode = parent.previousElementSibling;
            if (parentNode?.classList.contains("tree-node")) {
              (parentNode as HTMLElement).classList.remove("hidden");
            }
          }
          parent = parent.parentElement;
        }
      }
    });
  }
}

// --- App Initialization ---
window.addEventListener("DOMContentLoaded", () => {
  const tabManager = new TabManager();
  const treeView = new TreeView("server-list", tabManager);

  // --- Search Logic ---
  const searchInput = document.getElementById("tree-search") as HTMLInputElement;
  const clearSearchBtn = document.getElementById("btn-clear-search");

  searchInput?.addEventListener("input", (e) => {
    const query = (e.target as HTMLInputElement).value;
    treeView.applyFilter(query);
  });

  clearSearchBtn?.addEventListener("click", () => {
    if (searchInput) {
      searchInput.value = "";
      treeView.applyFilter("");
      searchInput.focus();
    }
  });

  // Initial Tabs
  tabManager.addDashboard();
  tabManager.addHistoryTab();
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
      await invoke("connect_db", { config: { host, port, user, pass }, database: null });
      const catalogs = await invoke("get_catalogs") as string[];

      // Global Success State
      AppState.getInstance().setConnection(true, host);
      AppState.getInstance().setActiveDatabase("postgres"); // Explicit Initial Sync

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