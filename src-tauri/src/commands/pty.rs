use tauri::ipc::Channel;
use tauri::State;

use crate::error::AppResult;
use crate::models::pty::{PtyEvent, PtySpawnInput, PtySpawnResult};
use crate::services::db::Db;
use crate::services::pty::PtyManager;

use super::worktrees::ensure_registered;

#[tauri::command]
pub fn pty_spawn(
    db: State<'_, Db>,
    manager: State<'_, PtyManager>,
    mut input: PtySpawnInput,
    on_event: Channel<PtyEvent>,
) -> AppResult<PtySpawnResult> {
    let target = ensure_registered(&db, &input.cwd)?;
    input.cwd = target.display().to_string();
    manager.spawn(input, on_event)
}

#[tauri::command]
pub fn pty_write(
    manager: State<'_, PtyManager>,
    session_id: String,
    data: String,
) -> AppResult<()> {
    manager.write(&session_id, &data)
}

#[tauri::command]
pub fn pty_resize(
    manager: State<'_, PtyManager>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> AppResult<()> {
    manager.resize(&session_id, cols, rows)
}

#[tauri::command]
pub fn pty_kill(manager: State<'_, PtyManager>, session_id: String) -> AppResult<()> {
    manager.kill(&session_id)
}
