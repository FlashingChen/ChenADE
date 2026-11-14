use tauri::State;

use crate::error::AppResult;
use crate::models::search::SearchHit;
use crate::services::db::Db;
use crate::services::search;

use super::worktrees::ensure_registered;

/// Search a registered worktree by file name and file content.
///
/// File-name matches are returned before content matches; `limit` defaults to
/// 80 and is capped at 200.
#[tauri::command]
pub fn search_files(
    db: State<'_, Db>,
    root: String,
    query: String,
    limit: Option<u32>,
) -> AppResult<Vec<SearchHit>> {
    let root = ensure_registered(&db, &root)?;
    search::search_files(&root, &query, limit)
}
