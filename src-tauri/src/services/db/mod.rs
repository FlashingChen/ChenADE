use std::collections::HashMap;
use std::sync::Mutex;

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::de::DeserializeOwned;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::activity::{Activity, MAX_ACTIVITY_LIMIT};
use crate::models::project::{Project, RepoInfo};
use crate::models::settings::Settings;
use crate::services::git::repo::worktree_count;

/// One `settings` row per [`Settings`] field, keyed by the Rust field name.
const SETTING_TERMINAL_SHELL: &str = "terminal_shell";
const SETTING_TERMINAL_FONT_SIZE: &str = "terminal_font_size";
const SETTING_DEFAULT_EDITOR: &str = "default_editor";
const SETTING_THEME: &str = "theme";
const SETTING_CONFIRM_CLOSE_TERMINAL: &str = "confirm_close_terminal";
const SETTING_LOAD_SHELL_PROFILE: &str = "load_shell_profile";

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  default_branch TEXT NOT NULL,
  remote_name TEXT,
  remote_url TEXT,
  provider TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL,
  last_opened_at TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ui_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recent_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  worktree_path TEXT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activity_project_time
  ON recent_activity(project_id, created_at DESC);
"#;

pub struct Db {
    conn: Mutex<Connection>,
}

impl Db {
    pub fn init(app: &AppHandle) -> AppResult<Self> {
        let data_dir = app
            .path()
            .app_data_dir()
            .map_err(|error| AppError::new("IO_ERROR", "无法定位应用数据目录").detail(error.to_string()))?;

        std::fs::create_dir_all(&data_dir)?;
        let db_path = data_dir.join("chenade.db");
        let conn = Connection::open(&db_path)?;

        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")?;

        let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
        if version < 1 {
            conn.execute_batch(SCHEMA)?;
            conn.execute_batch("PRAGMA user_version = 1;")?;
        }

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn list_projects(&self) -> AppResult<Vec<Project>> {
        let mut projects = {
            let conn = self.conn.lock().map_err(lock_error)?;
            let mut statement = conn.prepare(
                "SELECT id, name, path, default_branch, remote_name, remote_url, provider,
                        sort_order, added_at, last_opened_at
                 FROM projects
                 ORDER BY sort_order ASC, added_at ASC",
            )?;

            let rows = statement.query_map([], map_project)?;
            let mut projects = Vec::new();
            for row in rows {
                projects.push(row?);
            }
            projects
        };

        // Git calls are intentionally made after releasing the DB lock.
        for project in &mut projects {
            project.worktree_count = worktree_count(std::path::Path::new(&project.path)) as i64;
        }

        Ok(projects)
    }

    pub fn get_project(&self, id: &str) -> AppResult<Project> {
        let project = {
            let conn = self.conn.lock().map_err(lock_error)?;
            conn.query_row(
                "SELECT id, name, path, default_branch, remote_name, remote_url, provider,
                        sort_order, added_at, last_opened_at
                 FROM projects WHERE id = ?1",
                params![id],
                map_project,
            )
            .optional()?
            .ok_or_else(|| AppError::new("REPO_NOT_FOUND", "找不到这个项目"))?
        };

        let mut project = project;
        project.worktree_count = worktree_count(std::path::Path::new(&project.path)) as i64;
        Ok(project)
    }

    pub fn find_by_path(&self, path: &str) -> AppResult<Option<Project>> {
        let conn = self.conn.lock().map_err(lock_error)?;
        let project = conn
            .query_row(
                "SELECT id, name, path, default_branch, remote_name, remote_url, provider,
                        sort_order, added_at, last_opened_at
                 FROM projects WHERE path = ?1",
                params![path],
                map_project,
            )
            .optional()?;
        Ok(project)
    }

    pub fn add_project(&self, info: &RepoInfo) -> AppResult<Project> {
        if let Some(existing) = self.find_by_path(&info.path)? {
            return Ok(existing);
        }

        let id = Uuid::new_v4().to_string();
        let added_at = Utc::now().to_rfc3339();

        {
            let conn = self.conn.lock().map_err(lock_error)?;
            let sort_order: i64 = conn.query_row(
                "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM projects",
                [],
                |row| row.get(0),
            )?;

            conn.execute(
                "INSERT INTO projects
                 (id, name, path, default_branch, remote_name, remote_url, provider,
                  sort_order, added_at, last_opened_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL)",
                params![
                    id,
                    info.name,
                    info.path,
                    info.default_branch,
                    info.remote_name,
                    info.remote_url,
                    info.provider,
                    sort_order,
                    added_at
                ],
            )?;
        }

        self.get_project(&id)
    }

    pub fn remove_project(&self, id: &str) -> AppResult<()> {
        let conn = self.conn.lock().map_err(lock_error)?;
        let changed = conn.execute("DELETE FROM projects WHERE id = ?1", params![id])?;
        if changed == 0 {
            return Err(AppError::new("REPO_NOT_FOUND", "找不到这个项目"));
        }
        Ok(())
    }

    pub fn reorder_projects(&self, ids: &[String]) -> AppResult<()> {
        let mut conn = self.conn.lock().map_err(lock_error)?;
        let transaction = conn.transaction()?;
        for (index, id) in ids.iter().enumerate() {
            transaction.execute(
                "UPDATE projects SET sort_order = ?1 WHERE id = ?2",
                params![index as i64, id],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn touch_project(&self, id: &str) -> AppResult<()> {
        let conn = self.conn.lock().map_err(lock_error)?;
        conn.execute(
            "UPDATE projects SET last_opened_at = ?1 WHERE id = ?2",
            params![Utc::now().to_rfc3339(), id],
        )?;
        Ok(())
    }

    pub fn project_paths(&self) -> AppResult<Vec<String>> {
        let conn = self.conn.lock().map_err(lock_error)?;
        let mut statement = conn.prepare("SELECT path FROM projects")?;
        let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
        let mut paths = Vec::new();
        for row in rows {
            paths.push(row?);
        }
        Ok(paths)
    }

    #[allow(dead_code)]
    pub fn get_ui_state(&self, key: &str) -> AppResult<Option<String>> {
        let conn = self.conn.lock().map_err(lock_error)?;
        let value = conn
            .query_row(
                "SELECT value FROM ui_state WHERE key = ?1",
                params![key],
                |row| row.get(0),
            )
            .optional()?;
        Ok(value)
    }

    #[allow(dead_code)]
    pub fn set_ui_state(&self, key: &str, value: &str) -> AppResult<()> {
        let conn = self.conn.lock().map_err(lock_error)?;
        conn.execute(
            "INSERT INTO ui_state (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn get_settings(&self) -> AppResult<Settings> {
        let stored: HashMap<String, String> = {
            let conn = self.conn.lock().map_err(lock_error)?;
            let mut statement = conn.prepare("SELECT key, value FROM settings")?;
            let rows = statement.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;

            let mut stored = HashMap::new();
            for row in rows {
                let (key, value): (String, String) = row?;
                stored.insert(key, value);
            }
            stored
        };

        Ok(settings_from_stored(&stored).normalized())
    }

    pub fn set_settings(&self, settings: &Settings) -> AppResult<()> {
        // Normalize before writing so an out-of-range payload never lands on disk.
        let settings = settings.clone().normalized();
        let entries = [
            (
                SETTING_TERMINAL_SHELL,
                serde_json::to_string(&settings.terminal_shell)?,
            ),
            (
                SETTING_TERMINAL_FONT_SIZE,
                serde_json::to_string(&settings.terminal_font_size)?,
            ),
            (
                SETTING_DEFAULT_EDITOR,
                serde_json::to_string(&settings.default_editor)?,
            ),
            (SETTING_THEME, serde_json::to_string(&settings.theme)?),
            (
                SETTING_CONFIRM_CLOSE_TERMINAL,
                serde_json::to_string(&settings.confirm_close_terminal)?,
            ),
            (
                SETTING_LOAD_SHELL_PROFILE,
                serde_json::to_string(&settings.load_shell_profile)?,
            ),
        ];

        let mut conn = self.conn.lock().map_err(lock_error)?;
        let transaction = conn.transaction()?;
        for (key, value) in entries {
            transaction.execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![key, value],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn list_activity(&self, project_id: Option<&str>, limit: u32) -> AppResult<Vec<Activity>> {
        let limit = limit.min(MAX_ACTIVITY_LIMIT) as i64;
        let conn = self.conn.lock().map_err(lock_error)?;

        let mut statement = match project_id {
            Some(_) => conn.prepare(
                "SELECT id, project_id, worktree_path, kind, title, detail, created_at
                 FROM recent_activity
                 WHERE project_id = ?1
                 ORDER BY id DESC
                 LIMIT ?2",
            )?,
            None => conn.prepare(
                "SELECT id, project_id, worktree_path, kind, title, detail, created_at
                 FROM recent_activity
                 ORDER BY id DESC
                 LIMIT ?1",
            )?,
        };

        let rows = match project_id {
            Some(project_id) => statement.query_map(params![project_id, limit], map_activity)?,
            None => statement.query_map(params![limit], map_activity)?,
        };

        let mut activities = Vec::new();
        for row in rows {
            activities.push(row?);
        }
        Ok(activities)
    }

    pub fn add_activity(
        &self,
        project_id: &str,
        worktree_path: Option<&str>,
        kind: &str,
        title: &str,
        detail: Option<&str>,
    ) -> AppResult<Activity> {
        let created_at = Utc::now().to_rfc3339();
        let conn = self.conn.lock().map_err(lock_error)?;

        conn.execute(
            "INSERT INTO recent_activity
             (project_id, worktree_path, kind, title, detail, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![project_id, worktree_path, kind, title, detail, created_at],
        )?;
        let id = conn.last_insert_rowid();

        Ok(Activity {
            id,
            project_id: project_id.to_string(),
            worktree_path: worktree_path.map(str::to_string),
            kind: kind.to_string(),
            title: title.to_string(),
            detail: detail.map(str::to_string),
            created_at,
        })
    }
}

/// Rebuild [`Settings`] from stored JSON values, falling back per field.
fn settings_from_stored(stored: &HashMap<String, String>) -> Settings {
    let defaults = Settings::default();

    Settings {
        terminal_shell: parse_setting(stored, SETTING_TERMINAL_SHELL, defaults.terminal_shell),
        terminal_font_size: parse_setting(
            stored,
            SETTING_TERMINAL_FONT_SIZE,
            defaults.terminal_font_size,
        ),
        default_editor: parse_setting(stored, SETTING_DEFAULT_EDITOR, defaults.default_editor),
        theme: parse_setting(stored, SETTING_THEME, defaults.theme),
        confirm_close_terminal: parse_setting(
            stored,
            SETTING_CONFIRM_CLOSE_TERMINAL,
            defaults.confirm_close_terminal,
        ),
        load_shell_profile: parse_setting(
            stored,
            SETTING_LOAD_SHELL_PROFILE,
            defaults.load_shell_profile,
        ),
    }
}

fn parse_setting<T: DeserializeOwned>(
    stored: &HashMap<String, String>,
    key: &str,
    fallback: T,
) -> T {
    stored
        .get(key)
        .and_then(|raw| serde_json::from_str::<T>(raw).ok())
        .unwrap_or(fallback)
}

fn map_project(row: &Row<'_>) -> rusqlite::Result<Project> {
    Ok(Project {
        id: row.get(0)?,
        name: row.get(1)?,
        path: row.get(2)?,
        default_branch: row.get(3)?,
        remote_name: row.get(4)?,
        remote_url: row.get(5)?,
        provider: row.get(6)?,
        sort_order: row.get(7)?,
        added_at: row.get(8)?,
        last_opened_at: row.get(9)?,
        worktree_count: 0,
    })
}

fn map_activity(row: &Row<'_>) -> rusqlite::Result<Activity> {
    Ok(Activity {
        id: row.get(0)?,
        project_id: row.get(1)?,
        worktree_path: row.get(2)?,
        kind: row.get(3)?,
        title: row.get(4)?,
        detail: row.get(5)?,
        created_at: row.get(6)?,
    })
}

fn lock_error<T>(_: T) -> AppError {
    AppError::new("DB_ERROR", "数据库繁忙，请重试")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_db() -> Db {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        Db {
            conn: Mutex::new(conn),
        }
    }

    #[test]
    fn settings_are_default_when_table_is_empty() {
        let db = test_db();
        assert_eq!(db.get_settings().unwrap(), Settings::default());
    }

    #[test]
    fn settings_round_trip_and_clamp_font_size() {
        let db = test_db();
        let settings = Settings {
            terminal_shell: Some("/bin/zsh".into()),
            terminal_font_size: 99,
            default_editor: Some("code".into()),
            theme: "light".into(),
            confirm_close_terminal: false,
            load_shell_profile: false,
        };

        db.set_settings(&settings).unwrap();
        let stored = db.get_settings().unwrap();

        assert_eq!(stored.terminal_shell.as_deref(), Some("/bin/zsh"));
        assert_eq!(
            stored.terminal_font_size,
            crate::models::settings::MAX_TERMINAL_FONT_SIZE
        );
        assert_eq!(stored.default_editor.as_deref(), Some("code"));
        assert_eq!(stored.theme, "light");
        assert!(!stored.confirm_close_terminal);
    }

    #[test]
    fn invalid_setting_value_falls_back_to_default() {
        let db = test_db();
        {
            let conn = db.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2)",
                params![SETTING_THEME, "\"not-json"],
            )
            .unwrap();
        }

        assert_eq!(db.get_settings().unwrap().theme, "dark");
    }

    #[test]
    fn activity_is_listed_newest_first_and_filtered_by_project() {
        let db = test_db();
        db.add_activity("p1", None, "terminal", "first", None)
            .unwrap();
        db.add_activity("p2", Some("/tmp/wt"), "git", "other", None)
            .unwrap();
        db.add_activity("p1", None, "file", "second", Some("detail"))
            .unwrap();

        let all = db.list_activity(None, 50).unwrap();
        assert_eq!(all.len(), 3);
        assert_eq!(all[0].title, "second");
        assert_eq!(all[1].title, "other");

        let project = db.list_activity(Some("p1"), 50).unwrap();
        assert_eq!(project.len(), 2);
        assert_eq!(project[0].title, "second");
        assert_eq!(project[1].title, "first");
        assert_eq!(project[0].detail.as_deref(), Some("detail"));
        assert_eq!(project[1].worktree_path, None);
    }

    #[test]
    fn activity_limit_is_capped() {
        let db = test_db();
        for index in 0..3 {
            db.add_activity("p1", None, "terminal", &format!("entry-{index}"), None)
                .unwrap();
        }

        let limited = db.list_activity(None, 2).unwrap();
        assert_eq!(limited.len(), 2);
        assert_eq!(limited[0].title, "entry-2");

        // A limit above the cap must not error; it simply reads what exists.
        assert_eq!(db.list_activity(None, 10_000).unwrap().len(), 3);
    }
}
