use tauri::State;

use crate::error::{AppError, AppResult};
use crate::models::activity::{Activity, DEFAULT_ACTIVITY_LIMIT};
use crate::services::db::Db;

#[tauri::command]
pub fn activity_list(
    db: State<'_, Db>,
    project_id: Option<String>,
    limit: Option<u32>,
) -> AppResult<Vec<Activity>> {
    db.list_activity(
        project_id.as_deref(),
        limit.unwrap_or(DEFAULT_ACTIVITY_LIMIT),
    )
}

#[tauri::command]
pub fn activity_add(
    db: State<'_, Db>,
    project_id: String,
    worktree_path: Option<String>,
    kind: String,
    title: String,
    detail: Option<String>,
) -> AppResult<Activity> {
    if project_id.trim().is_empty() || kind.trim().is_empty() || title.trim().is_empty() {
        return Err(AppError::new(
            "INVALID_INPUT",
            "活动记录缺少项目、类型或标题",
        ));
    }

    db.add_activity(
        &project_id,
        worktree_path.as_deref(),
        &kind,
        &title,
        detail.as_deref(),
    )
}
