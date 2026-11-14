use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    pub id: String,
    pub project_id: String,
    pub path: String,
    pub branch: Option<String>,
    pub head: String,
    pub head_subject: String,
    pub is_main: bool,
    pub base: Option<String>,
    pub dirty: i64,
    pub ahead: i64,
    pub behind: i64,
    pub upstream: Option<String>,
    pub locked: bool,
    pub prunable: bool,
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateWorktreeInput {
    pub project_id: String,
    pub branch: String,
    pub base: String,
    pub path: Option<String>,
    pub copy_env_local: bool,
}
