use std::path::Path;

use walkdir::WalkDir;

use crate::error::{AppError, AppResult};
use crate::models::search::SearchHit;

pub const DEFAULT_LIMIT: u32 = 80;
pub const MAX_LIMIT: u32 = 200;

const MAX_FILE_BYTES: u64 = 1024 * 1024;
const BINARY_SNIFF_BYTES: usize = 4 * 1024;
const MAX_HITS_PER_FILE: usize = 3;
const MAX_PREVIEW_CHARS: usize = 200;

/// Directories whose contents are never searched: build output, dependencies
/// and VCS metadata only add noise and cost.
const IGNORED_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "dist",
    "build",
    "target",
    ".next",
    ".turbo",
    ".cache",
    "vendor",
];

pub fn normalized_limit(limit: Option<u32>) -> usize {
    limit.unwrap_or(DEFAULT_LIMIT).min(MAX_LIMIT) as usize
}

/// Search a worktree for file-name and content matches.
///
/// File-name matches are returned first, then content matches; each group is
/// sorted by path. Unreadable entries are skipped instead of failing the
/// whole search, and the total result count never exceeds the capped limit.
pub fn search_files(root: &Path, query: &str, limit: Option<u32>) -> AppResult<Vec<SearchHit>> {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Ok(Vec::new());
    }

    if !root.is_dir() {
        return Err(AppError::new("PATH_NOT_FOUND", "工作树目录不存在")
            .detail(root.display().to_string()));
    }

    let limit = normalized_limit(limit);
    let mut name_hits: Vec<SearchHit> = Vec::new();
    let mut content_hits: Vec<SearchHit> = Vec::new();

    let walker = WalkDir::new(root)
        .follow_links(false)
        .sort_by_file_name()
        .into_iter()
        .filter_entry(|entry| {
            if entry.depth() == 0 {
                return true;
            }
            let name = entry.file_name().to_string_lossy();
            if entry.file_type().is_dir() {
                !IGNORED_DIRS.contains(&name.as_ref())
            } else {
                name != ".DS_Store"
            }
        });

    for entry in walker {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };

        if !entry.file_type().is_file() {
            continue;
        }

        let path = entry.path();
        let relative = path.strip_prefix(root).unwrap_or(path);
        let name = entry.file_name().to_string_lossy().to_string();

        if name.to_lowercase().contains(&needle) && name_hits.len() < limit {
            name_hits.push(SearchHit {
                path: path.display().to_string(),
                line: None,
                preview: Some(relative.display().to_string()),
                kind: "file".to_string(),
            });

            // File-name matches rank first; once the budget is spent nothing
            // later in the walk can appear in the result.
            if name_hits.len() >= limit {
                break;
            }
        }

        if content_hits.len() >= limit {
            continue;
        }

        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        if metadata.len() > MAX_FILE_BYTES {
            continue;
        }

        let bytes = match std::fs::read(path) {
            Ok(bytes) => bytes,
            Err(_) => continue,
        };
        if bytes
            .iter()
            .take(BINARY_SNIFF_BYTES)
            .any(|byte| *byte == 0)
        {
            continue;
        }

        let text = String::from_utf8_lossy(&bytes);
        let mut hits_in_file = 0usize;

        for (index, line) in text.lines().enumerate() {
            if hits_in_file >= MAX_HITS_PER_FILE || content_hits.len() >= limit {
                break;
            }
            if !line.to_lowercase().contains(&needle) {
                continue;
            }

            content_hits.push(SearchHit {
                path: path.display().to_string(),
                line: Some((index + 1) as u32),
                preview: Some(truncate(line.trim(), MAX_PREVIEW_CHARS)),
                kind: "content".to_string(),
            });
            hits_in_file += 1;
        }
    }

    name_hits.sort_by(|left, right| left.path.cmp(&right.path));
    content_hits.sort_by(|left, right| {
        left.path
            .cmp(&right.path)
            .then_with(|| left.line.cmp(&right.line))
    });

    let mut results = name_hits;
    results.extend(content_hits);
    results.truncate(limit);
    Ok(results)
}

fn truncate(text: &str, max_chars: usize) -> String {
    let mut preview: String = text.chars().take(max_chars).collect();
    if text.chars().count() > max_chars {
        preview.push('…');
    }
    preview
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn workspace() -> TempDir {
        let dir = tempfile::tempdir().expect("tempdir");
        fs::create_dir_all(dir.path().join("src")).expect("src");
        fs::create_dir_all(dir.path().join("node_modules/pkg")).expect("node_modules");
        fs::write(
            dir.path().join("src/readme-notes.txt"),
            "first line\nsecond line with NEEDLE here\n",
        )
        .expect("notes");
        fs::write(
            dir.path().join("node_modules/pkg/index.js"),
            "needle should be ignored\n",
        )
        .expect("ignored");
        dir
    }

    #[test]
    fn finds_file_name_matches_case_insensitively() {
        let dir = workspace();
        let hits = search_files(dir.path(), "README", None).expect("search");

        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].kind, "file");
        assert_eq!(hits[0].line, None);
        assert_eq!(hits[0].preview.as_deref(), Some("src/readme-notes.txt"));
        assert!(hits[0].path.ends_with("readme-notes.txt"));
    }

    #[test]
    fn finds_content_matches_with_line_numbers() {
        let dir = workspace();
        let hits = search_files(dir.path(), "needle", None).expect("search");

        assert_eq!(hits.len(), 1, "ignored directories must not be searched");
        assert_eq!(hits[0].kind, "content");
        assert_eq!(hits[0].line, Some(2));
        assert_eq!(
            hits[0].preview.as_deref(),
            Some("second line with NEEDLE here")
        );
    }

    #[test]
    fn caps_and_orders_results() {
        let dir = workspace();
        for index in 0..5 {
            fs::write(
                dir.path().join("src").join(format!("hit-{index}.txt")),
                "value\n",
            )
            .expect("file");
        }
        fs::write(dir.path().join("src/a.txt"), "hit\nhit\nhit\nhit\n").expect("content");

        let hits = search_files(dir.path(), "hit", Some(4)).expect("search");
        assert_eq!(hits.len(), 4);
        assert!(hits.iter().all(|hit| hit.kind == "file"));

        let content_only = search_files(dir.path(), "value", None).expect("search");
        assert_eq!(content_only.len(), 5);
        assert!(content_only.iter().all(|hit| hit.kind == "content"));
    }

    #[test]
    fn skips_binary_and_oversized_files() {
        let dir = tempfile::tempdir().expect("tempdir");
        fs::write(dir.path().join("blob.bin"), [0u8, b'a', 1, 2]).expect("binary");
        fs::write(dir.path().join("big.txt"), vec![b'a'; 1024 * 1024 + 1]).expect("big");

        let hits = search_files(dir.path(), "a", None).expect("search");
        assert!(hits.is_empty());
    }

    #[test]
    fn empty_query_returns_nothing() {
        let dir = workspace();
        assert!(search_files(dir.path(), "   ", None).expect("search").is_empty());
    }

    #[test]
    fn caps_limit_at_two_hundred() {
        assert_eq!(normalized_limit(None), DEFAULT_LIMIT as usize);
        assert_eq!(normalized_limit(Some(10)), 10);
        assert_eq!(normalized_limit(Some(500)), MAX_LIMIT as usize);
    }
}
