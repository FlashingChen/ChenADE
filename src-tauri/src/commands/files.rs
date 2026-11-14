use std::path::Path;

use tauri::State;

use crate::error::{AppError, AppResult};
use crate::models::fs::{FileContent, FileEntry, WriteResult};
use crate::services::db::Db;
use crate::services::fs;
use crate::services::platform;

use super::worktrees::ensure_registered;

#[tauri::command]
pub fn files_list_dir(
    db: State<'_, Db>,
    root: String,
    path: String,
) -> AppResult<Vec<FileEntry>> {
    let root = ensure_registered(&db, &root)?;
    fs::list_dir(&root, Path::new(&path))
}

#[tauri::command]
pub fn files_read(
    db: State<'_, Db>,
    root: String,
    path: String,
) -> AppResult<FileContent> {
    let root = ensure_registered(&db, &root)?;
    fs::read_file(&root, Path::new(&path))
}

#[tauri::command]
pub fn files_write(
    db: State<'_, Db>,
    root: String,
    path: String,
    content: String,
) -> AppResult<WriteResult> {
    let root = ensure_registered(&db, &root)?;
    fs::write_file(&root, Path::new(&path), &content)
}

#[tauri::command]
pub fn files_reveal(
    db: State<'_, Db>,
    root: String,
    path: String,
) -> AppResult<()> {
    let root = ensure_registered(&db, &root)?;
    let (_, target) = fs::resolve_in_root(&root, Path::new(&path))?;
    platform::reveal(&target)
}

#[tauri::command]
pub fn files_open_external(
    db: State<'_, Db>,
    root: String,
    path: String,
    editor: Option<String>,
) -> AppResult<()> {
    let root = ensure_registered(&db, &root)?;
    let (_, target) = fs::resolve_in_root(&root, Path::new(&path))?;

    if let Some(editor) = editor.filter(|value| !value.trim().is_empty()) {
        let status = std::process::Command::new(editor.trim())
            .arg(&target)
            .status()
            .map_err(|error| {
                AppError::new("IO_ERROR", "无法启动自定义编辑器")
                    .detail(format!("{}: {error}", editor.trim()))
                    .hint("在设置里填写可执行文件的完整路径")
            })?;
        if !status.success() {
            return Err(AppError::new("IO_ERROR", "自定义编辑器退出异常")
                .detail(format!("exit status: {status}")));
        }
        return Ok(());
    }

    platform::open_external(&target)
}
