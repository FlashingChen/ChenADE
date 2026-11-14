use std::path::Path;

use tauri::State;

use crate::error::AppResult;
use crate::models::git::{
    Commit, CommitResult, DiffFile, Identity, PushResult,
};
use crate::services::db::Db;
use crate::services::git::{compare, diff, log, ops};
use crate::services::platform;

use super::worktrees::ensure_registered;

#[tauri::command]
pub fn git_log(
    db: State<'_, Db>,
    path: String,
    limit: Option<u32>,
    skip: Option<u32>,
    all: Option<bool>,
) -> AppResult<Vec<Commit>> {
    let root = ensure_registered(&db, &path)?;
    log::list(&root, limit.unwrap_or(80), skip.unwrap_or(0), all.unwrap_or(true))
}

#[tauri::command]
pub fn git_diff_worktree(db: State<'_, Db>, path: String) -> AppResult<Vec<DiffFile>> {
    let root = ensure_registered(&db, &path)?;
    diff::worktree(&root)
}

#[tauri::command]
pub fn git_diff_commit(
    db: State<'_, Db>,
    path: String,
    hash: String,
) -> AppResult<Vec<DiffFile>> {
    let root = ensure_registered(&db, &path)?;
    diff::commit(&root, &hash)
}

#[tauri::command]
pub fn git_identity(db: State<'_, Db>, path: String) -> AppResult<Option<Identity>> {
    let root = ensure_registered(&db, &path)?;
    ops::identity(&root)
}

#[tauri::command]
pub fn git_commit(
    db: State<'_, Db>,
    path: String,
    message: String,
    all: Option<bool>,
) -> AppResult<CommitResult> {
    let root = ensure_registered(&db, &path)?;
    ops::commit(&root, &message, all.unwrap_or(true))
}

#[tauri::command]
pub fn git_push(
    db: State<'_, Db>,
    path: String,
    remote: Option<String>,
    branch: Option<String>,
) -> AppResult<PushResult> {
    let root = ensure_registered(&db, &path)?;
    ops::push(&root, remote, branch)
}

#[tauri::command]
pub fn git_compare_url(
    db: State<'_, Db>,
    path: String,
    base: String,
    head: String,
) -> AppResult<Option<String>> {
    let root = ensure_registered(&db, &path)?;
    compare::compare_url(&root, &base, &head)
}

#[tauri::command]
pub fn open_external_url(url: String) -> AppResult<()> {
    platform::open_url(&url)
}

#[tauri::command]
pub fn git_reveal_path(path: String) -> AppResult<()> {
    let canonical = std::fs::canonicalize(Path::new(&path))?;
    platform::reveal(&canonical)
}
