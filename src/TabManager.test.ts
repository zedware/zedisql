import { describe, expect, test, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { AppFontManager, AppZoomManager, groupConsecutiveHistoryEntries, TabManager } from "./main";

describe("TabManager", () => {
  beforeEach(() => {
    localStorage.clear();
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockReset();
    invokeMock.mockImplementation((cmd: string) => {
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
          active_sessions: 1,
          idle_sessions: 2,
          total_xacts: 100,
        });
      }
      return Promise.resolve();
    });

    // Inject neutral graphical binding locations.
    document.body.innerHTML = `
      <div id="tab-bar"></div>
      <div id="view-container"></div>
      
      <!-- Re-inject required component template structures for component tests -->
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
            <div class="ai-inline-widget" hidden>
              <form class="ai-inline-form">
                <textarea class="ai-inline-input"></textarea>
                <button class="ai-inline-send" type="submit">Send</button>
              </form>
            </div>
            <div class="ai-inline-suggestion" hidden>
              <pre class="ai-inline-preview"><code></code></pre>
            </div>
          </div>
          <aside class="ai-assistant-panel">
            <div class="ai-message-list"></div>
            <form class="ai-prompt-form">
              <textarea class="ai-prompt-input"></textarea>
              <button class="ai-send-btn" type="submit">Send</button>
            </form>
          </aside>
          <div class="results-container">
            <table class="data-table">
              <thead><tr class="results-head"></tr></thead>
              <tbody class="results-body"></tbody>
            </table>
          </div>
        </div>
      </template>
      <template id="dashboard-template">
        <div class="dashboard"><div class="stat-value" id="active-sessions">0</div></div>
      </template>
      <template id="history-template">
        <div class="history-view"><ul class="history-list"></ul></div>
      </template>
    `;
    document.documentElement.removeAttribute("style");
  });

  test("instantiates successfully when bound to fresh DOM references", () => {
    expect(() => new TabManager()).not.toThrow();
  });

  test("creating a Query Tool forcefully constructs graphical graphical tabs mapped to an underlying isolated component view", () => {
    const manager = new TabManager();
    manager.addQueryTool();
    
    const tabBar = document.getElementById("tab-bar")!;
    const viewContainer = document.getElementById("view-container")!;
    
    // Verify one physical .tab graphic generated
    expect(tabBar.querySelectorAll(".tab").length).toBe(1);
    
    // Verify one isolated GUI panel container generated inside the container
    expect(viewContainer.querySelectorAll(".view-pane").length).toBe(1);
    
    // Verify the explicit QueryToolInstance internal HTML parser successfully mapped its sub-DOM nodes (like the editor) inside the new pane
    expect(viewContainer.querySelector(".sql-editor")).not.toBeNull();
    // Test the generated syntax highlighter container injected earlier successfully survived component duplication
    expect(viewContainer.querySelector(".sql-highlighter")).not.toBeNull();
  });

  test("creates an AI Assistant panel inside each query tool", () => {
    const manager = new TabManager();
    manager.addQueryTool();

    const panel = document.querySelector(".ai-assistant-panel");

    expect(panel).not.toBeNull();
    expect(panel?.querySelector(".ai-message-list")).not.toBeNull();
    expect(panel?.querySelector(".ai-prompt-input")).not.toBeNull();
    expect(panel?.querySelector(".ai-send-btn")).not.toBeNull();
  });

  test("AI Assistant inserts, replaces, and copies generated SQL without executing it", async () => {
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "generate_sql_with_ai") {
        return Promise.resolve({
          sql: "SELECT id, name FROM public.users;",
          explanation: "Lists users.",
        });
      }
      return Promise.resolve();
    });
    const writeText = vi.fn();
    Object.assign(navigator, {
      clipboard: { writeText },
    });

    const manager = new TabManager();
    manager.addQueryTool("SELECT count(*) FROM public.users;");

    const promptInput = document.querySelector(".ai-prompt-input") as HTMLTextAreaElement;
    const promptForm = document.querySelector(".ai-prompt-form") as HTMLFormElement;
    const editor = document.querySelector(".sql-editor") as HTMLTextAreaElement;

    promptInput.value = "show users";
    promptForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(invokeMock).toHaveBeenCalledWith("generate_sql_with_ai", expect.objectContaining({
      prompt: "show users",
      currentQuery: "SELECT count(*) FROM public.users;",
    }));

    document.querySelector<HTMLButtonElement>('[data-action="replace"]')?.click();
    expect(editor.value).toBe("SELECT id, name FROM public.users;");

    editor.value = "SELECT 1;";
    editor.selectionStart = editor.selectionEnd = editor.value.length;
    document.querySelector<HTMLButtonElement>('[data-action="insert"]')?.click();
    expect(editor.value).toBe("SELECT 1;SELECT id, name FROM public.users;");

    document.querySelector<HTMLButtonElement>('[data-action="copy"]')?.click();
    expect(writeText).toHaveBeenCalledWith("SELECT id, name FROM public.users;");
    expect(invokeMock).not.toHaveBeenCalledWith("execute_query", expect.anything());
  });

  test("opens inline AI chat from the SQL editor and accepts the generated SQL with Tab", async () => {
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "generate_sql_with_ai") {
        return Promise.resolve({
          sql: "SELECT * FROM public.orders LIMIT 20;",
          explanation: "Shows recent orders.",
        });
      }
      return Promise.resolve();
    });

    const manager = new TabManager();
    manager.addQueryTool("SELECT 1;");

    const editor = document.querySelector(".sql-editor") as HTMLTextAreaElement;
    editor.selectionStart = editor.selectionEnd = editor.value.length;
    editor.dispatchEvent(new KeyboardEvent("keydown", {
      key: "/",
      code: "Slash",
      altKey: true,
      bubbles: true,
      cancelable: true,
    }));

    const inlinePrompt = document.querySelector(".ai-inline-widget") as HTMLElement;
    const inlineInput = document.querySelector(".ai-inline-input") as HTMLTextAreaElement;
    const inlineForm = document.querySelector(".ai-inline-form") as HTMLFormElement;

    expect(inlinePrompt.hidden).toBe(false);

    inlineInput.value = "show recent orders";
    inlineForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();

    const suggestion = document.querySelector(".ai-inline-suggestion") as HTMLElement;
    expect(suggestion.hidden).toBe(false);
    expect(suggestion.textContent).toContain("SELECT * FROM public.orders LIMIT 20;");

    editor.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    }));

    expect(editor.value).toBe("SELECT 1;SELECT * FROM public.orders LIMIT 20;");
    expect(suggestion.hidden).toBe(true);
  });

  test("rejects an inline AI suggestion with Escape", async () => {
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "generate_sql_with_ai") {
        return Promise.resolve({
          sql: "SELECT now();",
          explanation: "Shows server time.",
        });
      }
      return Promise.resolve();
    });

    const manager = new TabManager();
    manager.addQueryTool("SELECT 1;");

    const editor = document.querySelector(".sql-editor") as HTMLTextAreaElement;
    editor.dispatchEvent(new KeyboardEvent("keydown", {
      key: "/",
      code: "Slash",
      altKey: true,
      bubbles: true,
      cancelable: true,
    }));

    const inlineInput = document.querySelector(".ai-inline-input") as HTMLTextAreaElement;
    const inlineForm = document.querySelector(".ai-inline-form") as HTMLFormElement;
    inlineInput.value = "server time";
    inlineForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();

    const suggestion = document.querySelector(".ai-inline-suggestion") as HTMLElement;
    editor.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }));

    expect(editor.value).toBe("SELECT 1;");
    expect(suggestion.hidden).toBe(true);
  });

  test("uses the current SQL comment as a manual inline completion prompt", async () => {
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "generate_sql_with_ai") {
        return Promise.resolve({
          sql: "SELECT table_schema, table_name FROM information_schema.tables;",
          explanation: "Lists tables.",
        });
      }
      return Promise.resolve();
    });

    const manager = new TabManager();
    manager.addQueryTool("-- list all tables");

    const editor = document.querySelector(".sql-editor") as HTMLTextAreaElement;
    editor.selectionStart = editor.selectionEnd = editor.value.length;
    editor.dispatchEvent(new KeyboardEvent("keydown", {
      key: ".",
      code: "Period",
      altKey: true,
      bubbles: true,
      cancelable: true,
    }));
    await Promise.resolve();
    await Promise.resolve();

    expect(invokeMock).toHaveBeenCalledWith("generate_sql_with_ai", expect.objectContaining({
      prompt: "list all tables",
      currentQuery: "-- list all tables",
    }));
    expect(document.querySelector(".ai-inline-suggestion")?.textContent).toContain("information_schema.tables");
  });

  test("supports VS Code-style zoom hotkeys", () => {
    const zoomManager = new AppZoomManager();
    zoomManager.init();

    const zoomIn = new KeyboardEvent("keydown", {
      key: "=",
      code: "Equal",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(zoomIn);

    expect(zoomIn.defaultPrevented).toBe(true);
    expect(zoomManager.getZoom()).toBe(1.1);
    expect(document.documentElement.style.getPropertyValue("--app-zoom")).toBe("1.1");
    expect(document.body.style.getPropertyValue("zoom")).toBe("1.1");

    const reset = new KeyboardEvent("keydown", {
      key: "0",
      code: "Digit0",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(reset);

    expect(reset.defaultPrevented).toBe(true);
    expect(zoomManager.getZoom()).toBe(1);
  });

  test("persists configurable UI, editor, and data fonts", () => {
    const fontManager = new AppFontManager();
    fontManager.init();

    fontManager.updateSettings({
      uiFamily: "Segoe UI",
      uiSize: 15,
      editorFamily: "Cascadia Code",
      editorSize: 18,
      dataFamily: "Consolas",
      dataSize: 16,
    }, true);

    expect(document.documentElement.style.getPropertyValue("--font-ui-family")).toContain("Segoe UI");
    expect(document.documentElement.style.getPropertyValue("--font-editor-family")).toContain("Cascadia Code");
    expect(document.documentElement.style.getPropertyValue("--font-data-family")).toContain("Consolas");
    expect(document.documentElement.style.getPropertyValue("--font-ui-size")).toBe("15px");
    expect(document.documentElement.style.getPropertyValue("--font-editor-size")).toBe("18px");
    expect(document.documentElement.style.getPropertyValue("--font-data-size")).toBe("16px");

    const restoredManager = new AppFontManager();
    expect(restoredManager.getSettings()).toMatchObject({
      uiFamily: "Segoe UI",
      uiSize: 15,
      editorFamily: "Cascadia Code",
      editorSize: 18,
      dataFamily: "Consolas",
      dataSize: 16,
    });
  });

  test("groups only consecutive duplicate history entries", () => {
    const base = { database: "postgres", duration: "1ms", status: "success" as const };
    const grouped = groupConsecutiveHistoryEntries([
      { ...base, id: "3", query: "SELECT 1", timestamp: 3 },
      { ...base, id: "2", query: "SELECT 1", timestamp: 2 },
      { ...base, id: "1", query: "SELECT 2", timestamp: 1 },
      { ...base, id: "0", query: "SELECT 1", timestamp: 0 },
    ]);

    expect(grouped).toHaveLength(3);
    expect(grouped[0]).toMatchObject({ query: "SELECT 1", repeatCount: 2, firstTimestamp: 2, timestamp: 3 });
    expect(grouped[0].executions).toEqual([
      { timestamp: 2, durationMs: 1 },
      { timestamp: 3, durationMs: 1 },
    ]);
    expect(grouped[0].executionStats).toEqual({ count: 2, minMs: 1, maxMs: 1, avgMs: 1 });
    expect(grouped[2]).toMatchObject({ query: "SELECT 1", repeatCount: 1 });
  });
  test("populates selectable font dropdowns and applies chosen families", () => {
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: () => {
        let currentFont = "";
        return {
          get font() {
            return currentFont;
          },
          set font(value: string) {
            currentFont = value;
          },
          measureText: () => ({
            width: currentFont.includes("Consolas") || currentFont.includes("Segoe UI") ? 140 : 100,
          }),
        };
      },
    });

    document.body.insertAdjacentHTML("beforeend", `
      <div id="font-settings-modal">
        <form id="font-settings-form">
          <select id="font-ui-family"></select>
          <input id="font-ui-size" type="number" />
          <select id="font-editor-family"></select>
          <input id="font-editor-size" type="number" />
          <select id="font-data-family"></select>
          <input id="font-data-size" type="number" />
          <button type="button" id="font-settings-reset">Reset</button>
          <button type="button" id="font-settings-cancel">Cancel</button>
          <button type="button" id="font-settings-close-icon">Close</button>
        </form>
      </div>
    `);

    const fontManager = new AppFontManager();
    fontManager.init();
    fontManager.show();

    const uiSelect = document.getElementById("font-ui-family") as HTMLSelectElement;
    expect(uiSelect.tagName).toBe("SELECT");
    expect(Array.from(uiSelect.options).map((option) => option.value)).toContain("Consolas");

    uiSelect.value = "Consolas";
    uiSelect.dispatchEvent(new Event("input", { bubbles: true }));

    expect(document.documentElement.style.getPropertyValue("--font-ui-family")).toContain("Consolas");
  });
});
