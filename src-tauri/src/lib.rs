use serde::{Deserialize, Serialize};
use sqlx::{Pool, Postgres, Row, Column};
use tauri::{Emitter, State};
use tauri::menu::{Menu, MenuItem, Submenu};
use std::sync::Mutex;

#[derive(Default)]
struct DbState {
    pool: Mutex<Option<Pool<Postgres>>>,
}

#[derive(Deserialize)]
struct DbConfig {
    host: String,
    port: u16,
    user: String,
    pass: String,
}

#[derive(Serialize)]
struct QueryResult {
    columns: Vec<String>,
    rows: Vec<Vec<String>>,
}

#[tauri::command]
async fn connect_db(
    config: DbConfig,
    state: State<'_, DbState>,
) -> Result<String, String> {
    let url = format!(
        "postgres://{}:{}@{}:{}/postgres",
        config.user, config.pass, config.host, config.port
    );

    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(5)
        .connect(&url)
        .await
        .map_err(|e| e.to_string())?;

    let mut pool_state = state.pool.lock().unwrap();
    *pool_state = Some(pool);

    Ok("Connected successfully".into())
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

    Ok(rows.into_iter().map(|r| r.get::<String, _>("datname")).collect())
}

#[tauri::command]
async fn execute_query(
    query: String,
    state: State<'_, DbState>,
) -> Result<QueryResult, String> {
    let pool = {
        let pool_guard = state.pool.lock().unwrap();
        pool_guard.as_ref().ok_or("Not connected")?.clone()
    };

    // 1. Initial attempt using standard binary execution
    let rows_result = sqlx::query(&query).fetch_all(&pool).await;

    match rows_result {
        Ok(rows) => {
            if rows.is_empty() {
                return Ok(QueryResult { columns: vec![], rows: vec![] });
            }
            let columns = rows[0].columns().iter().map(|c| c.name().to_string()).collect();
            let mut result_rows = Vec::new();
            for row in rows {
                let mut values = Vec::new();
                for i in 0..row.columns().len() {
                    // Try to decode common types into strings for display
                    let val: String = row.try_get::<String, _>(i)
                        .unwrap_or_else(|_| row.try_get::<i64, _>(i).map(|v| v.to_string())
                        .unwrap_or_else(|_| row.try_get::<i32, _>(i).map(|v| v.to_string())
                        .unwrap_or_else(|_| row.try_get::<f64, _>(i).map(|v| v.to_string())
                        .unwrap_or_else(|_| row.try_get::<bool, _>(i).map(|v| v.to_string())
                        .unwrap_or_else(|_| row.try_get::<chrono::DateTime<chrono::Local>, _>(i).map(|v| v.to_string())
                        .unwrap_or_else(|_| row.try_get::<chrono::NaiveDateTime, _>(i).map(|v| v.to_string())
                        .unwrap_or_else(|_| row.try_get::<chrono::NaiveDate, _>(i).map(|v| v.to_string())
                        .unwrap_or_else(|_| row.try_get::<rust_decimal::Decimal, _>(i).map(|v| v.to_string())
                        .unwrap_or_else(|_| "null".to_string())))))))));
                    values.push(val);
                }
                result_rows.push(values);
            }
            Ok(QueryResult { columns, rows: result_rows })
        }
        Err(e) if e.to_string().contains("no binary output function available") => {
            // 2. Fallback attempt with JSON aggregation for internal Postgres types like `aclitem`
            let q_trimmed = query.trim().to_lowercase();
            // Only wrap if it looks like a data-returning query
            if q_trimmed.starts_with("select") || q_trimmed.starts_with("with") || q_trimmed.starts_with("show") {
                let wrapped_query = format!("SELECT json_agg(t) FROM ({}) t", query);
                let json_row = sqlx::query(&wrapped_query)
                    .fetch_one(&pool)
                    .await
                    .map_err(|e| format!("JSON Fallback failed: {}", e))?;
                
                // Result of json_agg is an Option<serde_json::Value>
                let json_val: Option<serde_json::Value> = json_row.try_get(0).map_err(|e| e.to_string())?;
                
                if let Some(serde_json::Value::Array(arr)) = json_val {
                    if arr.is_empty() {
                        return Ok(QueryResult { columns: vec![], rows: vec![] });
                    }
                    
                    // Extract column names from the first object
                    let mut columns = Vec::new();
                    if let Some(serde_json::Value::Object(obj)) = arr.first() {
                        columns = obj.keys().cloned().collect();
                    }
                    
                    let mut result_rows = Vec::new();
                    for val in arr {
                        if let serde_json::Value::Object(obj) = val {
                            let mut row_data = Vec::new();
                            for col in &columns {
                                let v_str = match obj.get(col) {
                                    Some(serde_json::Value::String(s)) => s.clone(),
                                    Some(serde_json::Value::Null) => "null".to_string(),
                                    Some(other) => other.to_string(),
                                    None => "null".to_string(),
                                };
                                row_data.push(v_str);
                            }
                            result_rows.push(row_data);
                        }
                    }
                    return Ok(QueryResult { columns, rows: result_rows });
                }
            }
            Err(e.to_string())
        }
        Err(e) => Err(e.to_string()),
    }
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
    let sessions_row = sqlx::query("SELECT 
            count(*) FILTER (WHERE state = 'active') as active,
            count(*) FILTER (WHERE state = 'idle') as idle
            FROM pg_stat_activity")
        .fetch_one(&pool)
        .await
        .map_err(|e| e.to_string())?;

    let active_sessions: i64 = sessions_row.get("active");
    let idle_sessions: i64 = sessions_row.get("idle");

    // 2. Fetch total transactions (across whole server)
    let xacts_row = sqlx::query("SELECT sum(xact_commit + xact_rollback)::bigint as total FROM pg_stat_database")
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

#[tauri::command]
async fn get_tables(state: State<'_, DbState>) -> Result<Vec<String>, String> {
    let pool = {
        let pool_guard = state.pool.lock().unwrap();
        pool_guard.as_ref().ok_or("Not connected")?.clone()
    };

    let rows = sqlx::query("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema') ORDER BY tablename ASC")
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(rows.into_iter().map(|r| r.get::<String, _>("tablename")).collect())
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

            let connect_i = MenuItem::with_id(handle, "connect", "Connect", true, Some("CmdOrCtrl+N"))?;
            let save_i = MenuItem::with_id(handle, "save", "Save", true, Some("CmdOrCtrl+S"))?;
            
            if let Some(ref fm) = file_menu {
                let _ = fm.append(&connect_i);
                let _ = fm.append(&save_i);
            } else {
                let fm = Submenu::with_items(handle, "File", true, &[&connect_i, &save_i])?;
                let _ = menu.insert(&fm, 1);
            }

            // Create "Query" menu
            let execute_i = MenuItem::with_id(handle, "execute", "Execute", true, Some("F5"))?;
            let new_query_i = MenuItem::with_id(handle, "new-query", "New Query Tool", true, Some("CmdOrCtrl+T"))?;
            let query_menu = Submenu::with_items(handle, "Query", true, &[&execute_i, &new_query_i])?;
            let _ = menu.insert(&query_menu, 2);

            app.set_menu(menu)?;

            app.on_menu_event(move |app, event| {
                match event.id.0.as_str() {
                    "connect" => { let _ = app.emit("menu-connect", ()); }
                    "save" => { let _ = app.emit("menu-save", ()); }
                    "execute" => { let _ = app.emit("menu-execute", ()); }
                    "new-query" => { let _ = app.emit("menu-new-query", ()); }
                    _ => {}
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![connect_db, get_catalogs, execute_query, get_dashboard_stats, get_tables])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
