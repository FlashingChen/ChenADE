use std::path::Path;

use crate::error::{AppError, AppResult};
use crate::models::git::{CommitResult, Identity, PushResult};

use super::{run_git, run_git_with_input, status};

pub fn identity(path: &Path) -> AppResult<Option<Identity>> {
    let name = run_git(path, ["config", "user.name"])
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let email = run_git(path, ["config", "user.email"])
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    match (name, email) {
        (Some(name), Some(email)) => Ok(Some(Identity { name, email })),
        _ => Ok(None),
    }
}

pub fn commit(path: &Path, message: &str, add_all: bool) -> AppResult<CommitResult> {
    let message = message.trim();
    if message.is_empty() {
        return Err(AppError::new("INVALID_INPUT", "提交信息不能为空"));
    }

    let current = status::get(path)?;
    if current.merge_in_progress || current.rebase_in_progress {
        return Err(AppError::new(
            "MERGE_IN_PROGRESS",
            "正在合并或变基，无法提交",
        )
        .hint("先在终端完成或中止当前操作"));
    }
    if identity(path)?.is_none() {
        return Err(AppError::new("NO_IDENTITY", "还没有配置 git 提交身份")
            .hint("运行 git config --global user.name / user.email"));
    }
    if current.files.is_empty() {
        return Err(AppError::new("NOTHING_TO_COMMIT", "没有可提交的更改"));
    }

    if add_all {
        run_git(path, ["add", "-A"])?;
    }

    run_git_with_input(path, &["commit", "-F", "-"], message).map_err(|error| {
        if error.detail.as_deref().unwrap_or("").contains("nothing to commit") {
            AppError::new("NOTHING_TO_COMMIT", "没有可提交的更改")
        } else {
            error
        }
    })?;

    let hash = run_git(path, ["rev-parse", "HEAD"])?.trim().to_string();
    let short_hash = hash.chars().take(7).collect::<String>();
    let subject = run_git(path, ["log", "-1", "--format=%s"])?
        .trim()
        .to_string();

    Ok(CommitResult {
        hash,
        short_hash,
        subject,
    })
}

pub fn push(path: &Path, remote: Option<String>, branch: Option<String>) -> AppResult<PushResult> {
    let current_branch = branch
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            run_git(path, ["symbolic-ref", "--quiet", "--short", "HEAD"])
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        })
        .ok_or_else(|| AppError::new("NO_UPSTREAM", "当前不处于任何分支，无法推送"))?;

    let upstream = run_git(
        path,
        [
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
        ],
    )
    .ok()
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty());

    let (remote_name, args) = match upstream {
        Some(upstream) => {
            let remote = upstream
                .split('/')
                .next()
                .unwrap_or("origin")
                .to_string();
            (remote, vec!["push".to_string()])
        }
        None => {
            let remote = remote
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| {
                    run_git(path, ["remote"])
                        .ok()
                        .and_then(|value| {
                            value
                                .lines()
                                .map(str::trim)
                                .find(|name| *name == "origin")
                                .or_else(|| value.lines().map(str::trim).next())
                                .map(str::to_string)
                        })
                        .unwrap_or_else(|| "origin".to_string())
                });
            let args = vec![
                "push".to_string(),
                "-u".to_string(),
                remote.clone(),
                current_branch.clone(),
            ];
            (remote, args)
        }
    };

    let args_ref: Vec<&str> = args.iter().map(String::as_str).collect();
    run_git(path, args_ref.as_slice())?;

    Ok(PushResult {
        remote: remote_name,
        branch: current_branch.clone(),
        summary: format!("已推送 {current_branch}"),
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
        run_git(dir.path(), &["config", "user.name", "ChenADE Test"]);
        run_git(dir.path(), &["config", "user.email", "test@example.com"]);
        std::fs::write(dir.path().join("README.md"), "hello\n").expect("write");
        run_git(dir.path(), &["add", "."]);
        run_git(dir.path(), &["commit", "-m", "init"]);
        dir
    }

    #[test]
    fn commits_all_changes() {
        let repo = init_repo();
        std::fs::write(repo.path().join("README.md"), "hello\nworld\n").expect("write");

        let result = commit(repo.path(), "feat: change readme", true).expect("commit");
        assert!(!result.hash.is_empty());
        assert_eq!(result.subject, "feat: change readme");

        let status = status::get(repo.path()).expect("status");
        assert!(status.files.is_empty());
    }

    #[test]
    fn pushes_to_a_bare_remote() {
        let repo = init_repo();
        let remote = tempfile::tempdir().expect("remote");
        run_git(remote.path(), &["init", "--bare"]);
        run_git(
            repo.path(),
            &["remote", "add", "origin", remote.path().to_str().unwrap()],
        );

        let result = push(repo.path(), None, None).expect("push");
        assert_eq!(result.remote, "origin");
        assert!(!result.summary.is_empty());
    }

    #[test]
    fn rejects_empty_commit_messages() {
        let repo = init_repo();
        let error = commit(repo.path(), "   ", true).expect_err("should fail");
        assert_eq!(error.code, "INVALID_INPUT");
    }
}
