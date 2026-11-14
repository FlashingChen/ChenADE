use std::path::Path;

use crate::error::{AppError, AppResult};
use crate::models::git::{DiffFile, DiffRow, Hunk};

use super::{run_git, status};

const MAX_DIFF_LINES: usize = 40_000;
const MAX_UNTRACKED_LINES: usize = 400;

pub fn worktree(path: &Path) -> AppResult<Vec<DiffFile>> {
    let output = run_git(
        path,
        [
            "diff",
            "HEAD",
            "--no-color",
            "--find-renames",
            "--unified=3",
        ],
    )?;
    let mut files = parse(&output)?;

    // `git diff HEAD` does not include untracked files; synthesize a readable diff.
    if let Ok(current) = status::get(path) {
        for file in current.files.iter().filter(|file| file.worktree == "?") {
            if files.iter().any(|diff| diff.path == file.path) {
                continue;
            }
            if let Some(synthetic) = untracked_file(path, &file.path) {
                files.push(synthetic);
            }
        }
    }

    Ok(files)
}

pub fn commit(path: &Path, hash: &str) -> AppResult<Vec<DiffFile>> {
    let output = run_git(
        path,
        [
            "show",
            "--format=",
            "--no-color",
            "--find-renames",
            "--unified=3",
            hash,
        ],
    )?;
    parse(&output)
}

fn untracked_file(root: &Path, relative: &str) -> Option<DiffFile> {
    let full = root.join(relative);
    let metadata = std::fs::metadata(&full).ok()?;
    if !metadata.is_file() || metadata.len() > 512 * 1024 {
        return None;
    }
    let bytes = std::fs::read(&full).ok()?;
    if bytes.iter().take(4096).any(|byte| *byte == 0) {
        return Some(DiffFile {
            path: relative.to_string(),
            old_path: None,
            status: "untracked".to_string(),
            additions: 0,
            deletions: 0,
            binary: true,
            hunks: Vec::new(),
        });
    }

    let content = String::from_utf8_lossy(&bytes);
    let lines: Vec<&str> = content.lines().take(MAX_UNTRACKED_LINES).collect();
    let rows: Vec<DiffRow> = lines
        .iter()
        .enumerate()
        .map(|(index, line)| DiffRow::Add {
            new_no: (index + 1) as u32,
            text: (*line).to_string(),
        })
        .collect();

    Some(DiffFile {
        path: relative.to_string(),
        old_path: None,
        status: "untracked".to_string(),
        additions: rows.len() as u32,
        deletions: 0,
        binary: false,
        hunks: vec![Hunk {
            header: format!("@@ -0,0 +1,{} @@", rows.len()),
            old_start: 0,
            old_lines: 0,
            new_start: 1,
            new_lines: rows.len() as u32,
            rows,
        }],
    })
}

fn parse(output: &str) -> AppResult<Vec<DiffFile>> {
    if output.lines().count() > MAX_DIFF_LINES {
        return Err(AppError::new("DIFF_TOO_LARGE", "差异太大，无法在应用内渲染")
            .hint("在终端运行 git diff 查看"));
    }

    let mut files: Vec<DiffFile> = Vec::new();
    let mut current: Option<DiffFile> = None;
    let mut hunk: Option<Hunk> = None;
    let mut old_no = 0u32;
    let mut new_no = 0u32;

    for line in output.lines() {
        if let Some(rest) = line.strip_prefix("diff --git ") {
            if let Some(mut file) = current.take() {
                if let Some(hunk) = hunk.take() {
                    file.hunks.push(hunk);
                }
                files.push(file);
            }

            let (old_path, new_path) = split_diff_paths(rest);
            current = Some(DiffFile {
                path: new_path.clone(),
                old_path: if old_path != new_path { Some(old_path) } else { None },
                status: "modified".to_string(),
                additions: 0,
                deletions: 0,
                binary: false,
                hunks: Vec::new(),
            });
            old_no = 0;
            new_no = 0;
            continue;
        }

        let Some(file) = current.as_mut() else {
            continue;
        };

        if line.starts_with("new file mode") {
            file.status = "added".to_string();
            continue;
        }
        if line.starts_with("deleted file mode") {
            file.status = "deleted".to_string();
            continue;
        }
        if let Some(rest) = line.strip_prefix("rename from ") {
            file.old_path = Some(rest.to_string());
            file.status = "renamed".to_string();
            continue;
        }
        if let Some(rest) = line.strip_prefix("rename to ") {
            file.path = rest.to_string();
            continue;
        }
        if line.starts_with("Binary files ") {
            file.binary = true;
            continue;
        }

        if let Some(header) = line.strip_prefix("@@ ") {
            if let Some(previous) = hunk.take() {
                file.hunks.push(previous);
            }
            let (old_start, old_lines, new_start, new_lines) = parse_hunk_header(header);
            hunk = Some(Hunk {
                header: format!("@@ {header}"),
                old_start,
                old_lines,
                new_start,
                new_lines,
                rows: Vec::new(),
            });
            old_no = old_start;
            new_no = new_start;
            continue;
        }

        let Some(active) = hunk.as_mut() else {
            continue;
        };

        if let Some(text) = line.strip_prefix('+') {
            if text.starts_with("++") {
                continue;
            }
            active.rows.push(DiffRow::Add {
                new_no,
                text: text.to_string(),
            });
            new_no += 1;
            file.additions += 1;
            continue;
        }

        if let Some(text) = line.strip_prefix('-') {
            if text.starts_with("--") {
                continue;
            }
            active.rows.push(DiffRow::Del {
                old_no,
                text: text.to_string(),
            });
            old_no += 1;
            file.deletions += 1;
            continue;
        }

        if let Some(text) = line.strip_prefix(' ') {
            active.rows.push(DiffRow::Context {
                old_no,
                new_no,
                text: text.to_string(),
            });
            old_no += 1;
            new_no += 1;
            continue;
        }

        if line.starts_with('\\') {
            active.rows.push(DiffRow::Meta {
                text: line.to_string(),
            });
        }
    }

    if let Some(mut file) = current.take() {
        if let Some(hunk) = hunk.take() {
            file.hunks.push(hunk);
        }
        files.push(file);
    }

    Ok(files)
}

fn split_diff_paths(rest: &str) -> (String, String) {
    let rest = rest.trim();
    if let Some(stripped) = rest.strip_prefix("a/") {
        if let Some(index) = stripped.find(" b/") {
            let old_path = stripped[..index].to_string();
            let new_path = stripped[index + 3..].to_string();
            return (old_path, new_path);
        }
    }
    (rest.to_string(), rest.to_string())
}

fn parse_hunk_header(header: &str) -> (u32, u32, u32, u32) {
    let mut parts = header.split_whitespace();
    let old = parts.next().unwrap_or("-0,0");
    let new = parts.next().unwrap_or("+0,0");

    let (old_start, old_lines) = parse_range(old.trim_start_matches('-'));
    let (new_start, new_lines) = parse_range(new.trim_start_matches('+'));
    (old_start, old_lines, new_start, new_lines)
}

fn parse_range(value: &str) -> (u32, u32) {
    let mut parts = value.split(',');
    let start = parts.next().and_then(|part| part.parse().ok()).unwrap_or(0);
    let lines = parts.next().and_then(|part| part.parse().ok()).unwrap_or(1);
    (start, lines)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;
    use tempfile::TempDir;

    fn run_git(dir: &Path, args: &[&str]) {
        let status = Command::new("git")
            .current_dir(dir)
            .args(args)
            .env("GIT_AUTHOR_NAME", "ChenADE Test")
            .env("GIT_AUTHOR_EMAIL", "test@example.com")
            .env("GIT_COMMITTER_NAME", "ChenADE Test")
            .env("GIT_COMMITTER_EMAIL", "test@example.com")
            .status()
            .expect("run git");
        assert!(status.success(), "git {:?} failed", args);
    }

    fn init_repo() -> TempDir {
        let dir = tempfile::tempdir().expect("tempdir");
        run_git(dir.path(), &["init", "-b", "main"]);
        std::fs::write(dir.path().join("README.md"), "hello\n").expect("write");
        run_git(dir.path(), &["add", "."]);
        run_git(dir.path(), &["commit", "-m", "init"]);
        dir
    }

    #[test]
    fn parses_a_modified_file() {
        let repo = init_repo();
        std::fs::write(repo.path().join("README.md"), "hello\nworld\n").expect("write");

        let files = worktree(repo.path()).expect("diff");
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "README.md");
        assert_eq!(files[0].status, "modified");
        assert_eq!(files[0].additions, 1);
        assert!(!files[0].hunks.is_empty());
    }

    #[test]
    fn parses_a_commit_diff() {
        let repo = init_repo();
        std::fs::write(repo.path().join("README.md"), "hello\nworld\n").expect("write");
        run_git(repo.path(), &["add", "."]);
        run_git(repo.path(), &["commit", "-m", "change"]);
        let hash = super::super::run_git(repo.path(), ["rev-parse", "HEAD"])
            .expect("hash")
            .trim()
            .to_string();

        let files = commit(repo.path(), &hash).expect("diff");
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "README.md");
        assert!(files[0].additions >= 1);
    }

    #[test]
    fn includes_untracked_files() {
        let repo = init_repo();
        std::fs::write(repo.path().join("new.txt"), "one\ntwo\n").expect("write");
        let files = worktree(repo.path()).expect("diff");
        let untracked = files
            .iter()
            .find(|file| file.path == "new.txt")
            .expect("untracked");
        assert_eq!(untracked.status, "untracked");
        assert_eq!(untracked.additions, 2);
    }
}
