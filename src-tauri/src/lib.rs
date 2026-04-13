use futures::StreamExt;
use serde::{Deserialize, Serialize};
use sqlx::postgres::Postgres;
use sqlx::{Column, Pool, Row, Executor};
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem, Submenu};
use tauri::{Emitter, State};

#[derive(Default)]
struct DbState {
    pool: Mutex<Option<Pool<Postgres>>>,
    config: Mutex<Option<DbConfig>>,
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

#[derive(Serialize)]
struct QueryResult {
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

#[tauri::command]
async fn execute_query(query: String, state: State<'_, DbState>) -> Result<QueryResult, String> {
    let pool = {
        let pool_guard = state.pool.lock().unwrap();
        pool_guard.as_ref().ok_or("Not connected")?.clone()
    };

    let query_obj = sqlx::raw_sql(&query);
    
    // 1. Fetch metadata using describe() to support zero-row results
    let mut columns = Vec::new();
    if let Ok(desc) = pool.describe(&query).await {
        columns = desc
            .columns()
            .iter()
            .map(|c| c.name().to_string())
            .collect::<Vec<String>>();
    }

    // 2. Execute and fetch data
    let mut stream = query_obj.fetch_many(&pool);
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
        }
    }

    Ok(QueryResult {
        columns,
        rows: result_rows,
        rows_affected,
        command_tag,
    })
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

            if let Some(ref fm) = file_menu {
                let _ = fm.append(&connect_i);
                let _ = fm.append(&save_i);
            } else {
                let fm = Submenu::with_items(handle, "File", true, &[&connect_i, &save_i])?;
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
            connect_db,
            switch_database,
            get_catalogs,
            execute_query,
            execute_utility,
            get_dashboard_stats,
            get_tables,
            get_table_columns
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
