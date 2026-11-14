use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};
use crate::models::project::RepoInfo;

use super::{run_git, run_git_ok};

pub fn expand_path(input: &str) -> PathBuf {
    let trimmed = input.trim();
    if trimmed == "~" {
        if let Some(home) = home_dir() {
            return home;
        }
    }
    if let Some(rest) = trimmed.strip_prefix("~/") {
        if let Some(home) = home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(trimmed)
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

pub fn canonical_dir(path: &Path) -> AppResult<PathBuf> {
    let canonical = std::fs::canonicalize(path).map_err(|error| {
        AppError::new("PATH_NOT_FOUND", "目录不存在或不可访问")
            .detail(format!("{}: {error}", path.display()))
    })?;

    if !canonical.is_dir() {
        return Err(AppError::new("NOT_A_DIRECTORY", "选择的路径不是目录")
            .detail(canonical.display().to_string()));
    }

    Ok(canonical)
}

pub fn is_repo(path: &Path) -> bool {
    run_git(path, ["rev-parse", "--is-inside-work-tree"])
        .map(|output| output.trim() == "true")
        .unwrap_or(false)
}

pub fn repo_root(path: &Path) -> AppResult<PathBuf> {
    let output = run_git(path, ["rev-parse", "--show-toplevel"])?;
    let root = output.trim();
    if root.is_empty() {
        return Err(AppError::new("NOT_A_REPO", "这个目录不是 Git 仓库"));
    }
    canonical_dir(Path::new(root))
}

pub fn default_branch(root: &Path) -> String {
    if let Ok(output) = run_git(
        root,
        [
            "symbolic-ref",
            "--quiet",
            "--short",
            "refs/remotes/origin/HEAD",
        ],
    ) {
        let value = output.trim();
        let value = value.strip_prefix("origin/").unwrap_or(value);
        if !value.is_empty() {
            return value.to_string();
        }
    }

    for candidate in ["main", "master"] {
        let refname = format!("refs/heads/{candidate}");
        if run_git_ok(root, &["show-ref", "--verify", "--quiet", &refname]) {
            return candidate.to_string();
        }
    }

    if let Ok(output) = run_git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]) {
        let value = output.trim();
        if !value.is_empty() {
            return value.to_string();
        }
    }

    "main".to_string()
}

pub struct RemoteInfo {
    pub name: Option<String>,
    pub url: Option<String>,
    pub provider: Option<String>,
}

pub fn remote_info(root: &Path) -> RemoteInfo {
    let names = run_git(root, ["remote"]).unwrap_or_default();
    let mut selected: Option<&str> = None;
    for name in names.lines().map(str::trim).filter(|name| !name.is_empty()) {
        if name == "origin" {
            selected = Some("origin");
            break;
        }
        if selected.is_none() {
            selected = Some(name);
        }
    }

    let Some(name) = selected else {
        return RemoteInfo {
            name: None,
            url: None,
            provider: None,
        };
    };

    let url = run_git(root, ["remote", "get-url", name])
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let provider = url.as_deref().and_then(provider_from_url).map(str::to_string);

    RemoteInfo {
        name: Some(name.to_string()),
        url,
        provider,
    }
}

pub fn provider_from_url(url: &str) -> Option<&'static str> {
    let lower = url.to_ascii_lowercase();
    if lower.contains("github.com") {
        Some("github")
    } else if lower.contains("gitlab") {
        Some("gitlab")
    } else if lower.starts_with("http") || lower.starts_with("ssh") || lower.starts_with("git@") {
        Some("other")
    } else {
        None
    }
}

pub fn worktree_count(root: &Path) -> usize {
    run_git(root, ["worktree", "list", "--porcelain"])
        .map(|output| {
            output
                .lines()
                .filter(|line| line.starts_with("worktree "))
                .count()
        })
        .unwrap_or(0)
}

pub fn validate_repo(input: &str) -> AppResult<RepoInfo> {
    let requested = expand_path(input);
    let canonical = canonical_dir(&requested)?;

    if !is_repo(&canonical) {
        return Err(AppError::new("NOT_A_REPO", "这个目录不是 Git 仓库")
            .detail(canonical.display().to_string())
            .hint("选择一个包含 .git 的目录，或先运行 git init"));
    }

    let root = repo_root(&canonical)?;
    let name = root
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| root.display().to_string());

    let remote = remote_info(&root);

    Ok(RepoInfo {
        path: root.display().to_string(),
        name,
        default_branch: default_branch(&root),
        remote_name: remote.name,
        remote_url: remote.url,
        provider: remote.provider,
        worktree_count: worktree_count(&root),
    })
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
    fn validates_a_git_repository() {
        let repo = init_repo();
        let info = validate_repo(repo.path().to_str().unwrap()).expect("validate");

        assert_eq!(info.default_branch, "main");
        assert_eq!(info.worktree_count, 1);
        assert!(info.remote_name.is_none());
        assert!(info.path.ends_with(repo.path().file_name().unwrap().to_str().unwrap()));
    }

    #[test]
    fn rejects_a_non_repository_directory() {
        let dir = tempfile::tempdir().expect("tempdir");
        let error = validate_repo(dir.path().to_str().unwrap()).expect_err("should fail");
        assert_eq!(error.code, "NOT_A_REPO");
    }

    #[test]
    fn resolves_home_prefix() {
        let home = dirs_home();
        let expanded = expand_path("~/Code");
        assert_eq!(expanded, home.join("Code"));
    }

    fn dirs_home() -> PathBuf {
        std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .map(PathBuf::from)
            .expect("home dir")
    }
}
