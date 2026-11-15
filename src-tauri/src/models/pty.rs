use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PtySpawnInput {
    pub cwd: String,
    pub shell: Option<String>,
    pub args: Option<Vec<String>>,
    pub cols: u16,
    pub rows: u16,
    pub env: Option<HashMap<String, String>>,
    pub load_profile: Option<bool>,
    /// 标签 id：有值且 tmux 可用时，终端跑在可重连的 tmux 会话里。
    #[serde(default)]
    pub persist: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtySpawnResult {
    pub session_id: String,
    pub shell: String,
    pub pid: u32,
    /// "tmux" 或 "shell"：前端据此决定重开应用后是否自动重连。
    pub backend: String,
    pub persistent: bool,
    /// 本次是新建会话（true）还是重连已有会话（false）。
    pub created: bool,
    pub session_name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PtyEvent {
    Data { data: String },
    Exit { code: Option<i32>, signal: Option<String> },
    Error { message: String },
}
