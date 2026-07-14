# AI Assistant Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pgAdmin/SSMS-style AI Assistant to each Query Tool that generates SQL with the OpenAI API, including both a side panel and editor-triggered inline suggestions.

**Architecture:** The Query Tool owns a split workspace: SQL editor on the left and an AI Assistant panel on the right. The SQL editor also hosts an inline AI prompt/suggestion widget triggered by keyboard shortcuts. Frontend chat and inline suggestion state lives in `QueryToolInstance`; backend generation is exposed through a Tauri command that builds schema context from the active PostgreSQL pool and calls OpenAI's chat completions endpoint.

**Tech Stack:** TypeScript, Vitest, Tauri v2, Rust, SQLx, reqwest, OpenAI chat completions API.

## Global Constraints

- The AI Assistant is a dedicated panel inside the Query Tool, not a modal or separate app tab.
- The SQL editor supports inline AI generation with `Alt+/`, `Alt+.`, `Tab`, and `Esc`.
- The first provider is OpenAI API.
- Generated SQL is never executed automatically.
- Missing API key or missing database connection must produce clear UI errors.
- Existing query execution, history, dashboard, and object explorer behavior must remain unchanged.

---

### Task 1: Frontend AI Assistant Panel

**Files:**
- Modify: `index.html`
- Modify: `src/main.ts`
- Modify: `src/styles.css`
- Test: `src/TabManager.test.ts`

**Interfaces:**
- Consumes: existing `QueryToolInstance.setQuery(query: string, autoExecute?: boolean)`.
- Produces: AI panel DOM with `.ai-assistant-panel`, `.ai-prompt-input`, `.ai-send-btn`, `.ai-message-list`, and SQL block action buttons with `data-action="replace"`, `data-action="insert"`, and `data-action="copy"`.

- [ ] **Step 1: Write failing tests**

Add tests that instantiate a query tool, assert the AI panel is present, submit a prompt, mock `generate_sql_with_ai`, and verify Replace/Insert/Copy actions update the SQL editor or clipboard.

- [ ] **Step 2: Run frontend tests to verify failure**

Run: `npm run test -- src/TabManager.test.ts`
Expected: FAIL because the AI panel selectors do not exist.

- [ ] **Step 3: Implement minimal frontend**

Add the panel markup to `query-tool-template`. Extend `QueryToolInstance` with prompt submit, message rendering, and generated SQL action handlers. Keep generated SQL inert until the user chooses an action.

- [ ] **Step 4: Run frontend tests to verify pass**

Run: `npm run test -- src/TabManager.test.ts`
Expected: PASS.

### Task 1A: Inline Editor AI Suggestions

**Files:**
- Modify: `index.html`
- Modify: `src/main.ts`
- Modify: `src/styles.css`
- Test: `src/TabManager.test.ts`

**Interfaces:**
- Consumes: existing `generate_sql_with_ai` Tauri command and `QueryToolInstance` editor state.
- Produces: `.ai-inline-widget` opened with `Alt+/`, `.ai-inline-suggestion` populated by OpenAI responses, `Alt+.` comment-to-SQL generation, `Tab` accept, and `Esc` reject.

- [ ] **Step 1: Write failing tests**

Add tests for `Alt+/` inline prompt accept/reject and `Alt+.` current-comment generation.

- [ ] **Step 2: Run frontend tests to verify failure**

Run: `npm run test -- src/TabManager.test.ts`
Expected: FAIL because the inline widget and shortcut handling do not exist.

- [ ] **Step 3: Implement minimal inline editor flow**

Add inline widget markup and CSS inside the editor container. Extend `QueryToolInstance` to preserve cursor ranges, call `generate_sql_with_ai`, show a reviewable suggestion, and handle `Tab`/`Esc`.

- [ ] **Step 4: Run frontend tests to verify pass**

Run: `npm run test -- src/TabManager.test.ts`
Expected: PASS.

### Task 2: OpenAI Backend Command

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: app settings value `ai.openai.api_key`, optional `ai.openai.model`, optional `ai.openai.api_url`, active SQLx PostgreSQL pool.
- Produces: Tauri command `generate_sql_with_ai(prompt: String, current_query: Option<String>, settings: serde_json::Value, state: State<'_, DbState>) -> Result<AiSqlResponse, String>`.

- [ ] **Step 1: Write failing Rust unit tests**

Add pure tests for OpenAI request construction and SQL extraction, without calling the network.

- [ ] **Step 2: Run Rust tests to verify failure**

Run: `cargo test` from `src-tauri`
Expected: FAIL because helper functions do not exist.

- [ ] **Step 3: Implement backend helper and command**

Add `reqwest` dependency, schema context query, OpenAI-compatible request body, response parsing, error messages, and register the command in `generate_handler!`.

- [ ] **Step 4: Run Rust tests to verify pass**

Run: `cargo test` from `src-tauri`
Expected: PASS for helper tests. Integration database test may require local PostgreSQL.

### Task 3: Verification

**Files:**
- No new files.

**Interfaces:**
- Consumes: frontend and backend test suites.
- Produces: verified build output.

- [ ] **Step 1: Run frontend test suite**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 2: Run frontend build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Run Rust tests**

Run: `cargo test` from `src-tauri`
Expected: PASS if local PostgreSQL test database is available; otherwise report the environment-specific failure clearly.
