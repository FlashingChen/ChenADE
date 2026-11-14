use std::path::Path;

use tauri::State;

use crate::error::AppResult;
use crate::models::project::{Project, RepoInfo};
use crate::services::db::Db;
use crate::services::git::repo::{canonical_dir, expand_path, validate_repo};
use crate::services::platform;

#[tauri::command]
pub fn projects_list(db: State<'_, Db>) -> AppResult<Vec<Project>> {
    db.list_projects()
}

#[tauri::command]
pub fn project_validate(path: String) -> AppResult<RepoInfo> {
    validate_repo(&path)
}

#[tauri::command]
pub fn project_add(db: State<'_, Db>, path: String) -> AppResult<Project> {
    let info = validate_repo(&path)?;
    let project = db.add_project(&info)?;
    db.touch_project(&project.id)?;
    Ok(project)
}

#[tauri::command]
pub fn project_remove(db: State<'_, Db>, id: String) -> AppResult<()> {
    db.remove_project(&id)
}

#[tauri::command]
pub fn project_reorder(db: State<'_, Db>, ids: Vec<String>) -> AppResult<()> {
    db.reorder_projects(&ids)
}

#[tauri::command]
pub fn project_touch(db: State<'_, Db>, id: String) -> AppResult<()> {
    db.touch_project(&id)
}

#[tauri::command]
pub fn project_reveal(path: String) -> AppResult<()> {
    let target = canonical_dir(&expand_path(&path))?;
    platform::reveal(Path::new(&target))
}
