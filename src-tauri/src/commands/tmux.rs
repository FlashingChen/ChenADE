use serde::Serialize;
use tauri::State;

use crate::error::AppResult;
use crate::services::pty::PtyManager;
use crate::services::tmux::{Tmux, SESSION_PREFIX};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TmuxStatus {
    pub available: bool,
    pub version: Option<String>,
    pub binary: Option<String>,
    pub socket: String,
    pub sessions: usize,
}

#[tauri::command]
pub fn tmux_status(manager: State<'_, PtyManager>) -> AppResult<TmuxStatus> {
    let tmux = manager.tmux();
    Ok(TmuxStatus {
        available: tmux.is_available(),
        version: tmux.version().map(str::to_string),
        binary: tmux
            .binary()
            .map(|path| path.display().to_string()),
        socket: crate::services::tmux::SOCKET.to_string(),
        sessions: tmux.list_sessions().len(),
    })
}

/// 启动时清理孤儿会话：只有 localStorage 里仍存在的标签才保留。
#[tauri::command]
pub fn tmux_prune_sessions(manager: State<'_, PtyManager>, keep: Vec<String>) -> AppResult<usize> {
    let tmux = manager.tmux();
    if !tmux.is_available() {
        return Ok(0);
    }

    let keep: std::collections::HashSet<String> =
        keep.iter().map(|key| Tmux::session_name(key)).collect();
    let mut killed = 0;
    for name in tmux.list_sessions() {
        if !name.starts_with(SESSION_PREFIX) || keep.contains(&name) {
            continue;
        }
        if tmux.kill_session(&name).is_ok() {
            killed += 1;
        }
    }
    Ok(killed)
}
