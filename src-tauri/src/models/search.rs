use serde::Serialize;

/// One result of a worktree-wide file/content search.
///
/// `kind` is `"file"` for a file-name match (path + relative preview, no line)
/// and `"content"` for a line match (1-based `line` plus a trimmed preview).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub path: String,
    pub line: Option<u32>,
    pub preview: Option<String>,
    pub kind: String,
}
