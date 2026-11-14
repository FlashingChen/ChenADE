use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub default_branch: String,
    pub remote_name: Option<String>,
    pub remote_url: Option<String>,
    pub provider: Option<String>,
    pub sort_order: i64,
    pub added_at: String,
    pub last_opened_at: Option<String>,
    pub worktree_count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoInfo {
    pub path: String,
    pub name: String,
    pub default_branch: String,
    pub remote_name: Option<String>,
    pub remote_url: Option<String>,
    pub provider: Option<String>,
    pub worktree_count: usize,
}
