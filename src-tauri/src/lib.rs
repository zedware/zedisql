use futures::StreamExt;
use serde::{Deserialize, Serialize};
use sqlx::postgres::Postgres;
use sqlx::{Column, Executor, Pool, Row, ValueRef};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, State};

fn settings_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join("settings.json"))
        .map_err(|error| error.to_string())
}

fn history_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join("history.json"))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn load_settings(app: AppHandle) -> Result<serde_json::Value, String> {
    let path = settings_path(&app)?;
    if !path.exists() {
        return Ok(serde_json::json!({}));
    }

    let contents = std::fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&contents).map_err(|error| format!("Invalid settings.json: {error}"))
}

#[tauri::command]
fn save_settings(settings: serde_json::Value, app: AppHandle) -> Result<(), String> {
    let path = settings_path(&app)?;
    let directory = path.parent().ok_or("Invalid settings path")?;
    std::fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let contents = serde_json::to_string_pretty(&settings).map_err(|error| error.to_string())?;
    std::fs::write(path, format!("{contents}\n")).map_err(|error| error.to_string())
}

#[tauri::command]
fn load_history(app: AppHandle) -> Result<serde_json::Value, String> {
    let path = history_path(&app)?;
    if !path.exists() {
        return Ok(serde_json::json!([]));
    }

    let contents = std::fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&contents).map_err(|error| format!("Invalid history.json: {error}"))
}

#[tauri::command]
fn save_history(history: serde_json::Value, app: AppHandle) -> Result<(), String> {
    let path = history_path(&app)?;
    let directory = path.parent().ok_or("Invalid history path")?;
    std::fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let contents = serde_json::to_string_pretty(&history).map_err(|error| error.to_string())?;
    std::fs::write(path, format!("{contents}\n")).map_err(|error| error.to_string())
}

#[derive(Default)]
struct DbState {
    pool: Mutex<Option<Pool<Postgres>>>,
    config: Mutex<Option<DbConfig>>,
    active_queries: Mutex<HashMap<String, i32>>,
}

#[derive(Deserialize, Clone)]
struct DbConfig {
    host: String,
    port: u16,
    user: String,
    pass: String,
}

#[derive(Serialize)]
struct ColumnInfo {
    name: String,
    data_type: String,
}

#[derive(Clone)]
struct SchemaColumn {
    name: String,
    data_type: String,
}

#[derive(Clone)]
struct SchemaTable {
    schema: String,
    table: String,
    columns: Vec<SchemaColumn>,
}

#[derive(Serialize, Clone)]
struct OpenAiMessage {
    role: String,
    content: String,
}

#[derive(Serialize)]
struct OpenAiChatRequest {
    model: String,
    messages: Vec<OpenAiMessage>,
    temperature: f32,
}

#[derive(Deserialize)]
struct OpenAiChatResponse {
    choices: Vec<OpenAiChoice>,
}

#[derive(Deserialize)]
struct OpenAiChoice {
    message: OpenAiResponseMessage,
}

#[derive(Deserialize)]
struct OpenAiResponseMessage {
    content: String,
}

#[derive(Serialize)]
struct AiSqlResponse {
    sql: String,
    explanation: String,
}

#[derive(Serialize)]
pub struct QueryResult {
    columns: Vec<String>,
    rows: Vec<Vec<String>>,
    rows_affected: u64,
    command_tag: String,
}

#[tauri::command]
async fn connect_db(
    config: DbConfig,
    database: Option<String>,
    state: State<'_, DbState>,
) -> Result<String, String> {
    let db_name = database.unwrap_or_else(|| "postgres".to_string());
    let url = format!(
        "postgres://{}:{}@{}:{}/{}",
        config.user, config.pass, config.host, config.port, db_name
    );

    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(5)
        .connect(&url)
        .await
        .map_err(|e| e.to_string())?;

    let mut pool_state = state.pool.lock().unwrap();
    *pool_state = Some(pool);

    let mut config_state = state.config.lock().unwrap();
    *config_state = Some(config);

    Ok(format!("Connected to {} successfully", db_name))
}

fn setting_string(settings: &serde_json::Value, key: &str) -> Option<String> {
    settings
        .get(key)
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn build_schema_text(schema: &[SchemaTable]) -> String {
    if schema.is_empty() {
        return "No user tables were found in the active database.".to_string();
    }

    schema
        .iter()
        .map(|table| {
            let columns = table
                .columns
                .iter()
                .map(|column| format!("{} {}", column.name, column.data_type))
                .collect::<Vec<_>>()
                .join(", ");
            format!("{}.{}({})", table.schema, table.table, columns)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn build_openai_sql_messages(
    prompt: &str,
    current_query: Option<&str>,
    schema: &[SchemaTable],
) -> Vec<OpenAiMessage> {
    let current_query_text = current_query
        .map(str::trim)
        .filter(|query| !query.is_empty())
        .unwrap_or("No current SQL editor content.");

    vec![
        OpenAiMessage {
            role: "system".to_string(),
            content: "You are an expert PostgreSQL SQL assistant inside a desktop database client. Generate one PostgreSQL query or script that answers the user request. Prefer explicit schema-qualified table names. Return SQL in a fenced ```sql code block, followed by at most one short sentence of explanation. Do not invent tables or columns that are absent from the schema context.".to_string(),
        },
        OpenAiMessage {
            role: "user".to_string(),
            content: format!(
                "Database schema:\n{}\n\nCurrent SQL editor content:\n{}\n\nUser request:\n{}",
                build_schema_text(schema),
                current_query_text,
                prompt.trim()
            ),
        },
    ]
}

fn extract_sql_from_ai_content(content: &str) -> String {
    if let Some(fence_start) = content.find("```") {
        let after_fence = &content[fence_start + 3..];
        let after_language = after_fence
            .strip_prefix("sql")
            .or_else(|| after_fence.strip_prefix("SQL"))
            .unwrap_or(after_fence);
        let after_language = after_language.trim_start_matches(|c| c == '\r' || c == '\n');
        if let Some(fence_end) = after_language.find("```") {
            return after_language[..fence_end].trim().to_string();
        }
    }

    content.trim().to_string()
}

async fn collect_schema_context(pool: &Pool<Postgres>) -> Result<Vec<SchemaTable>, String> {
    let rows = sqlx::query(
        "SELECT table_schema, table_name, column_name, data_type
         FROM information_schema.columns
         WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
         ORDER BY table_schema, table_name, ordinal_position
         LIMIT 500",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| error.to_string())?;

    let mut tables: Vec<SchemaTable> = Vec::new();

    for row in rows {
        let schema: String = row.get("table_schema");
        let table: String = row.get("table_name");
        let column = SchemaColumn {
            name: row.get("column_name"),
            data_type: row.get("data_type"),
        };

        if let Some(existing) = tables
            .iter_mut()
            .find(|item| item.schema == schema && item.table == table)
        {
            existing.columns.push(column);
        } else {
            tables.push(SchemaTable {
                schema,
                table,
                columns: vec![column],
            });
        }
    }

    Ok(tables)
}

#[tauri::command]
async fn generate_sql_with_ai(
    prompt: String,
    current_query: Option<String>,
    settings: serde_json::Value,
    state: State<'_, DbState>,
) -> Result<AiSqlResponse, String> {
    let prompt = prompt.trim();
    if prompt.is_empty() {
        return Err("Enter a prompt before asking the AI Assistant.".to_string());
    }

    let api_key = setting_string(&settings, "ai.openai.api_key")
        .or_else(|| std::env::var("OPENAI_API_KEY").ok())
        .ok_or("OpenAI API key is not configured. Set ai.openai.api_key in settings or launch with OPENAI_API_KEY.")?;
    let api_url = setting_string(&settings, "ai.openai.api_url")
        .unwrap_or_else(|| "https://api.openai.com/v1/chat/completions".to_string());
    let model =
        setting_string(&settings, "ai.openai.model").unwrap_or_else(|| "gpt-4.1-mini".to_string());

    let pool = {
        let pool_guard = state.pool.lock().unwrap();
        pool_guard
            .as_ref()
            .ok_or("Connect to a database before using the AI Assistant.")?
            .clone()
    };

    let schema = collect_schema_context(&pool).await?;
    let request = OpenAiChatRequest {
        model,
        messages: build_openai_sql_messages(prompt, current_query.as_deref(), &schema),
        temperature: 0.1,
    };

    let response = reqwest::Client::new()
        .post(&api_url)
        .bearer_auth(api_key)
        .json(&request)
        .send()
        .await
        .map_err(|error| format!("OpenAI request failed: {error}"))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Failed to read OpenAI response: {error}"))?;
    if !status.is_success() {
        return Err(format!(
            "OpenAI request failed with status {status}: {body}"
        ));
    }

    let parsed: OpenAiChatResponse =
        serde_json::from_str(&body).map_err(|error| format!("Invalid OpenAI response: {error}"))?;
    let content = parsed
        .choices
        .first()
        .map(|choice| choice.message.content.trim())
        .filter(|content| !content.is_empty())
        .ok_or("OpenAI returned an empty response.")?;
    let sql = extract_sql_from_ai_content(content);

    Ok(AiSqlResponse {
        sql,
        explanation: content.to_string(),
    })
}

#[tauri::command]
async fn switch_database(database: String, state: State<'_, DbState>) -> Result<String, String> {
    let config = {
        let config_guard = state.config.lock().unwrap();
        config_guard
            .as_ref()
            .ok_or("No connection config stored")?
            .clone()
    };

    connect_db(config, Some(database), state).await
}

#[tauri::command]
async fn get_catalogs(state: State<'_, DbState>) -> Result<Vec<String>, String> {
    let pool = {
        let pool_guard = state.pool.lock().unwrap();
        pool_guard.as_ref().ok_or("Not connected")?.clone()
    };

    let rows = sqlx::query("SELECT datname FROM pg_database WHERE datistemplate = false")
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(rows
        .into_iter()
        .map(|r| r.get::<String, _>("datname"))
        .collect())
}

pub async fn execute_query_internal(
    pool: &Pool<Postgres>,
    query: &str,
) -> Result<QueryResult, String> {
    let query_obj = sqlx::raw_sql(query);

    // 1. Fetch metadata using describe() to support zero-row results
    let mut columns = Vec::new();
    if let Ok(desc) = pool.describe(query).await {
        columns = desc
            .columns()
            .iter()
            .map(|c| c.name().to_string())
            .collect::<Vec<String>>();
    }

    // 2. Execute and fetch data
    let mut stream = query_obj.fetch_many(pool);
    let mut result_rows = Vec::new();
    let mut rows_affected = 0;

    let command_tag = query
        .trim()
        .split_whitespace()
        .next()
        .map(|s| s.to_uppercase())
        .unwrap_or_else(|| "QUERY".to_string());

    while let Some(res) = stream.next().await {
        match res.map_err(|e| e.to_string())? {
            sqlx::Either::Left(result) => {
                rows_affected += result.rows_affected();
            }
            sqlx::Either::Right(row) => {
                if columns.is_empty() {
                    columns = row.columns().iter().map(|c| c.name().to_string()).collect();
                }
                let mut values = Vec::new();
                for i in 0..row.columns().len() {
                    let mut val_str = String::new();
                    if let Ok(raw) = row.try_get_raw(i) {
                        if raw.is_null() {
                            val_str = "null".to_string();
                        } else if let Ok(s) = raw.as_str() {
                            val_str = s.to_string();
                        }
                    }
                    // Fallback to specific typpings if text decoding fails (mostly for binary protocol safety)
                    if val_str.is_empty() {
                        val_str = row.try_get::<String, _>(i)
                            .unwrap_or_else(|_| row.try_get::<i64, _>(i).map(|v| v.to_string())
                            .unwrap_or_else(|_| row.try_get::<i32, _>(i).map(|v| v.to_string())
                            .unwrap_or_else(|_| row.try_get::<i16, _>(i).map(|v| v.to_string())
                            .unwrap_or_else(|_| row.try_get::<f64, _>(i).map(|v| v.to_string())
                            .unwrap_or_else(|_| row.try_get::<f32, _>(i).map(|v| v.to_string())
                            .unwrap_or_else(|_| row.try_get::<bool, _>(i).map(|v| v.to_string())
                            .unwrap_or_else(|_| row.try_get::<chrono::DateTime<chrono::Local>, _>(i).map(|v| v.to_string())
                            .unwrap_or_else(|_| row.try_get::<chrono::NaiveDateTime, _>(i).map(|v| v.to_string())
                            .unwrap_or_else(|_| row.try_get::<chrono::NaiveDate, _>(i).map(|v| v.to_string())
                            .unwrap_or_else(|_| row.try_get::<rust_decimal::Decimal, _>(i).map(|v| v.to_string())
                            .unwrap_or_else(|_| row.try_get::<serde_json::Value, _>(i).map(|v| v.to_string())
                            .unwrap_or_else(|_| "null".to_string()))))))))))));
                    }
                    values.push(val_str);
                }
                result_rows.push(values);
            }
        }
    }

    Ok(QueryResult {
        columns,
        rows: result_rows,
        rows_affected,
        command_tag,
    })
}

#[tauri::command]
async fn execute_query(
    query: String,
    tab_id: String,
    state: State<'_, DbState>,
) -> Result<QueryResult, String> {
    let pool = {
        let pool_guard = state.pool.lock().unwrap();
        pool_guard.as_ref().ok_or("Not connected")?.clone()
    };

    // 1. Get backend PID to support cancellation
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&pool)
        .await
        .map_err(|e| format!("Failed to initialize session: {}", e))?;

    // 2. Register PID for this tab
    {
        let mut active = state.active_queries.lock().unwrap();
        active.insert(tab_id.clone(), pid);
    }

    // 3. Execute
    let result = execute_query_internal(&pool, &query).await;

    // 4. Cleanup registration
    {
        let mut active = state.active_queries.lock().unwrap();
        active.remove(&tab_id);
    }

    // 5. Handle user-friendly cancel message
    match result {
        Err(e) if e.contains("canceling statement due to user request") || e.contains("57014") => {
            Err("Query cancelled by user".to_string())
        }
        _ => result,
    }
}

#[tauri::command]
async fn cancel_query(tab_id: String, state: State<'_, DbState>) -> Result<(), String> {
    let (pool, pid) = {
        let pool_guard = state.pool.lock().unwrap();
        let active = state.active_queries.lock().unwrap();

        let pool = pool_guard.as_ref().ok_or("Not connected")?.clone();
        let pid = active
            .get(&tab_id)
            .copied()
            .ok_or("No active query to cancel")?;
        (pool, pid)
    };

    // Execute cancellation request on a separate connection
    sqlx::query("SELECT pg_cancel_backend($1)")
        .bind(pid)
        .execute(&pool)
        .await
        .map_err(|e| format!("Cancellation request failed: {}", e))?;

    Ok(())
}

#[derive(Serialize)]
struct DashboardStats {
    active_sessions: i64,
    idle_sessions: i64,
    total_xacts: i64,
}

#[tauri::command]
async fn get_dashboard_stats(state: State<'_, DbState>) -> Result<DashboardStats, String> {
    let pool = {
        let pool_guard = state.pool.lock().unwrap();
        pool_guard.as_ref().ok_or("Not connected")?.clone()
    };

    // 1. Fetch sessions
    let sessions_row = sqlx::query(
        "SELECT 
            count(*) FILTER (WHERE state = 'active') as active,
            count(*) FILTER (WHERE state = 'idle') as idle
            FROM pg_stat_activity",
    )
    .fetch_one(&pool)
    .await
    .map_err(|e| e.to_string())?;

    let active_sessions: i64 = sessions_row.get("active");
    let idle_sessions: i64 = sessions_row.get("idle");

    // 2. Fetch total transactions (across whole server)
    let xacts_row = sqlx::query(
        "SELECT sum(xact_commit + xact_rollback)::bigint as total FROM pg_stat_database",
    )
    .fetch_one(&pool)
    .await
    .map_err(|e| e.to_string())?;

    let total_xacts: i64 = xacts_row.get::<Option<i64>, _>("total").unwrap_or(0);

    Ok(DashboardStats {
        active_sessions,
        idle_sessions,
        total_xacts,
    })
}

#[derive(Serialize)]
struct TableInfo {
    schemaname: String,
    tablename: String,
}

#[tauri::command]
async fn get_tables(state: State<'_, DbState>) -> Result<Vec<TableInfo>, String> {
    let pool = {
        let pool_guard = state.pool.lock().unwrap();
        pool_guard.as_ref().ok_or("Not connected")?.clone()
    };

    let rows = sqlx::query("SELECT schemaname, tablename FROM pg_catalog.pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema') ORDER BY schemaname, tablename ASC")
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(rows
        .into_iter()
        .map(|r| TableInfo {
            schemaname: r.get("schemaname"),
            tablename: r.get("tablename"),
        })
        .collect())
}

#[tauri::command]
async fn get_table_columns(
    schema: String,
    table: String,
    state: State<'_, DbState>,
) -> Result<Vec<ColumnInfo>, String> {
    let pool = {
        let pool_guard = state.pool.lock().unwrap();
        pool_guard.as_ref().ok_or("Not connected")?.clone()
    };

    let rows = sqlx::query(
        "SELECT column_name, data_type 
         FROM information_schema.columns 
         WHERE table_schema = $1 AND table_name = $2 
         ORDER BY ordinal_position",
    )
    .bind(schema)
    .bind(table)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows
        .into_iter()
        .map(|r| ColumnInfo {
            name: r.get::<String, _>("column_name"),
            data_type: r.get::<String, _>("data_type"),
        })
        .collect())
}

#[tauri::command]
async fn execute_utility(query: String, state: State<'_, DbState>) -> Result<String, String> {
    let pool = {
        let pool_guard = state.pool.lock().unwrap();
        pool_guard.as_ref().ok_or("Not connected")?.clone()
    };

    sqlx::query(&query)
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok("Command executed successfully".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(DbState::default())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle();
            let menu = Menu::default(handle)?;

            // Find existing "File" submenu or create it
            let mut file_menu = None;
            for item in menu.items()? {
                if let tauri::menu::MenuItemKind::Submenu(sub) = item {
                    if sub.text()? == "File" {
                        file_menu = Some(sub);
                        break;
                    }
                }
            }

            let connect_i =
                MenuItem::with_id(handle, "connect", "Connect", true, Some("CmdOrCtrl+N"))?;
            let save_i = MenuItem::with_id(handle, "save", "Save", true, Some("CmdOrCtrl+S"))?;
            let font_settings_i = MenuItem::with_id(
                handle,
                "font-settings",
                "Font Settings",
                true,
                Some("CmdOrCtrl+,"),
            )?;

            if let Some(ref fm) = file_menu {
                let _ = fm.insert_items(&[&connect_i, &save_i, &font_settings_i], 0);
            } else {
                let fm = Submenu::with_items(
                    handle,
                    "File",
                    true,
                    &[&connect_i, &save_i, &font_settings_i],
                )?;
                let _ = menu.insert(&fm, 1);
            }

            // Create "Query" menu
            let execute_i = MenuItem::with_id(handle, "execute", "Execute", true, Some("F5"))?;
            let new_query_i = MenuItem::with_id(
                handle,
                "new-query",
                "New Query Tool",
                true,
                Some("CmdOrCtrl+T"),
            )?;
            let query_menu =
                Submenu::with_items(handle, "Query", true, &[&execute_i, &new_query_i])?;
            let _ = menu.insert(&query_menu, 2);

            app.set_menu(menu)?;

            app.on_menu_event(move |app, event| match event.id.0.as_str() {
                "connect" => {
                    let _ = app.emit("menu-connect", ());
                }
                "save" => {
                    let _ = app.emit("menu-save", ());
                }
                "font-settings" => {
                    let _ = app.emit("menu-font-settings", ());
                }
                "execute" => {
                    let _ = app.emit("menu-execute", ());
                }
                "new-query" => {
                    let _ = app.emit("menu-new-query", ());
                }
                _ => {}
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_settings,
            save_settings,
            load_history,
            save_history,
            connect_db,
            generate_sql_with_ai,
            switch_database,
            get_catalogs,
            execute_query,
            cancel_query,
            execute_utility,
            get_dashboard_stats,
            get_tables,
            get_table_columns
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::postgres::PgPoolOptions;

    #[test]
    fn ai_prompt_includes_schema_prompt_and_current_query() {
        let schema = vec![SchemaTable {
            schema: "public".to_string(),
            table: "users".to_string(),
            columns: vec![
                SchemaColumn {
                    name: "id".to_string(),
                    data_type: "integer".to_string(),
                },
                SchemaColumn {
                    name: "email".to_string(),
                    data_type: "text".to_string(),
                },
            ],
        }];

        let messages = build_openai_sql_messages(
            "show user emails",
            Some("SELECT count(*) FROM public.users;"),
            &schema,
        );

        assert_eq!(messages[0].role, "system");
        assert!(messages[0].content.contains("PostgreSQL"));
        assert!(messages[1].content.contains("public.users"));
        assert!(messages[1].content.contains("email text"));
        assert!(messages[1].content.contains("show user emails"));
        assert!(messages[1]
            .content
            .contains("SELECT count(*) FROM public.users;"));
    }

    #[test]
    fn ai_sql_extraction_prefers_fenced_sql() {
        let content =
            "Here is the query:\n```sql\nSELECT id FROM public.users;\n```\nReview before running.";

        assert_eq!(
            extract_sql_from_ai_content(content),
            "SELECT id FROM public.users;"
        );
    }

    #[tokio::test]
    async fn test_datatype_parsing_regression() {
        // Default local environment for testing. Adjust if running in CI without postgres:postgres.
        let url = "postgres://postgres:postgres@localhost:5432/postgres";
        let pool = PgPoolOptions::new()
            .max_connections(2)
            .connect(url)
            .await
            .expect("Test environment requires a postgres database on localhost:5432");

        // 1. Create a temporary table with complex types
        let _ = execute_query_internal(
            &pool,
            "CREATE TEMP TABLE test_datatypes (id smallint, metadata jsonb, score real, tags json, phrase varchar);"
        ).await.expect("Failed to create temp table");

        // 2. Insert robust mock data
        let _ = execute_query_internal(
            &pool,
            "INSERT INTO test_datatypes (id, metadata, score, tags, phrase) VALUES (12, '{\"key\": \"value\"}', 42.5, '[1,2,3]', 'regression');"
        ).await.expect("Failed to insert mock data");

        // 3. Select the data back out to verify type decoupling
        let result = execute_query_internal(
            &pool,
            "SELECT id, metadata, score, tags, phrase FROM test_datatypes;",
        )
        .await
        .unwrap();

        assert_eq!(result.rows.len(), 1);
        let row = &result.rows[0];

        // Assert perfectly decoded str representations
        assert_eq!(row[0], "12"); // smallint
                                  // Postgres serializes JSON/JSONB with specific spacial rules, but checking presence ensures non-null.
        assert!(row[1].contains("\"key\": \"value\"")); // jsonb
        assert_eq!(row[2], "42.5"); // real
        assert!(row[3].contains("1")); // json array string match
        assert_eq!(row[4], "regression"); // string
    }
}
