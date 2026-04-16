import { describe, expect, test, beforeEach } from "vitest";
import { TabManager } from "./main";

describe("TabManager", () => {
  beforeEach(() => {
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
});
