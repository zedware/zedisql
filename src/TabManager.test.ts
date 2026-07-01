import { describe, expect, test, beforeEach } from "vitest";
import { AppFontManager, AppZoomManager, TabManager } from "./main";

describe("TabManager", () => {
  beforeEach(() => {
    localStorage.clear();

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
});
