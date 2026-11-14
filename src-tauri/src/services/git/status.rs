use std::path::{Path, PathBuf};

use crate::error::AppResult;
use crate::models::git::{FileStatus, GitStatus};

use super::run_git;

pub fn get(path: &Path) -> AppResult<GitStatus> {
    let output = run_git(path, ["status", "--porcelain=v2", "--branch"])?;
    let mut status = GitStatus::empty();

    for line in output.lines() {
        if let Some(value) = line.strip_prefix("# branch.oid ") {
            if value == "(initial)" {
                continue;
            }
            continue;
        }

        if let Some(value) = line.strip_prefix("# branch.head ") {
            if value == "(detached)" {
                status.detached = true;
            } else {
                status.branch = Some(value.to_string());
            }
            continue;
        }

        if let Some(value) = line.strip_prefix("# branch.upstream ") {
            status.upstream = Some(value.to_string());
            continue;
        }

        if let Some(value) = line.strip_prefix("# branch.ab ") {
            let mut parts = value.split_whitespace();
            if let Some(ahead) = parts.next().and_then(|part| part.strip_prefix('+')) {
                status.ahead = ahead.parse().unwrap_or(0);
            }
            if let Some(behind) = parts.next().and_then(|part| part.strip_prefix('-')) {
                status.behind = behind.parse().unwrap_or(0);
            }
            continue;
        }

        if let Some(rest) = line.strip_prefix("1 ") {
            if let Some(file) = parse_ordinary(rest) {
                status.files.push(file);
            }
            continue;
        }

        if let Some(rest) = line.strip_prefix("2 ") {
            if let Some(file) = parse_rename(rest) {
                status.files.push(file);
            }
            continue;
        }

        if let Some(rest) = line.strip_prefix("u ") {
            if let Some(file) = parse_unmerged(rest) {
                status.files.push(file);
            }
            continue;
        }

        if let Some(path) = line.strip_prefix("? ") {
            status.files.push(FileStatus {
                path: path.to_string(),
                index: "?".to_string(),
                worktree: "?".to_string(),
                orig_path: None,
            });
            continue;
        }

        if let Some(path) = line.strip_prefix("! ") {
            status.files.push(FileStatus {
                path: path.to_string(),
                index: "!".to_string(),
                worktree: "!".to_string(),
                orig_path: None,
            });
        }
    }

    status.merge_in_progress = git_path_exists(path, "MERGE_HEAD");
    status.rebase_in_progress = git_path_exists(path, "rebase-merge")
        || git_path_exists(path, "rebase-apply");

    Ok(status)
}

fn parse_ordinary(rest: &str) -> Option<FileStatus> {
    let parts: Vec<&str> = rest.splitn(8, ' ').collect();
    if parts.len() < 8 {
        return None;
    }
    let xy = parts[0];
    Some(FileStatus {
        path: parts[7].to_string(),
        index: xy.chars().next().unwrap_or(' ').to_string(),
        worktree: xy.chars().nth(1).unwrap_or(' ').to_string(),
        orig_path: None,
    })
}

fn parse_rename(rest: &str) -> Option<FileStatus> {
    let parts: Vec<&str> = rest.splitn(9, ' ').collect();
    if parts.len() < 9 {
        return None;
    }
    let xy = parts[0];
    let path_field = parts[8];
    let (path, orig_path) = match path_field.split_once('\t') {
        Some((path, orig)) => (path.to_string(), Some(orig.to_string())),
        None => (path_field.to_string(), None),
    };

    Some(FileStatus {
        path,
        index: xy.chars().next().unwrap_or(' ').to_string(),
        worktree: xy.chars().nth(1).unwrap_or(' ').to_string(),
        orig_path,
    })
}

fn parse_unmerged(rest: &str) -> Option<FileStatus> {
    let parts: Vec<&str> = rest.splitn(10, ' ').collect();
    if parts.len() < 10 {
        return None;
    }
    let xy = parts[0];
    Some(FileStatus {
        path: parts[9].to_string(),
        index: xy.chars().next().unwrap_or('U').to_string(),
        worktree: xy.chars().nth(1).unwrap_or('U').to_string(),
        orig_path: None,
    })
}

fn git_path_exists(path: &Path, name: &str) -> bool {
    let Ok(output) = run_git(path, ["rev-parse", "--git-path", name]) else {
        return false;
    };
    let raw = output.trim();
    if raw.is_empty() {
        return false;
    }
    let candidate = PathBuf::from(raw);
    let resolved = if candidate.is_absolute() {
        candidate
    } else {
        path.join(candidate)
    };
    resolved.exists()
}
