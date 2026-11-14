use serde::{Deserialize, Serialize};

/// Page size used when the caller does not pass an explicit limit.
pub const DEFAULT_ACTIVITY_LIMIT: u32 = 50;
/// Hard cap: the recent-activity feed is a small sidebar, not an audit log.
pub const MAX_ACTIVITY_LIMIT: u32 = 200;

/// One entry of the recent-activity feed, scoped to a project.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub id: i64,
    pub project_id: String,
    pub worktree_path: Option<String>,
    pub kind: String,
    pub title: String,
    pub detail: Option<String>,
    pub created_at: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_as_camel_case() {
        let activity = Activity {
            id: 7,
            project_id: "p1".into(),
            worktree_path: Some("/tmp/wt".into()),
            kind: "terminal".into(),
            title: "opened shell".into(),
            detail: None,
            created_at: "2026-01-02T03:04:05Z".into(),
        };

        let value = serde_json::to_value(&activity).unwrap();
        assert_eq!(value["projectId"], "p1");
        assert_eq!(value["worktreePath"], "/tmp/wt");
        assert_eq!(value["createdAt"], "2026-01-02T03:04:05Z");
        assert!(value["detail"].is_null());
    }
}
