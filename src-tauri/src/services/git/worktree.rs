use std::path::{Path, PathBuf};

use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::worktree::Worktree;

use super::{run_git, run_git_ok};

struct RawWorktree {
    path: PathBuf,
    head: String,
    branch: Option<String>,
    locked: bool,
    prunable: bool,
}

pub fn list_worktrees(
    project_id: &str,
    repo_root: &Path,
    default_branch: &str,
) -> AppResult<Vec<Worktree>> {
    let output = run_git(repo_root, ["worktree", "list", "--porcelain"])?;
    let raw = parse_porcelain(&output, repo_root);
    let canonical_repo = std::fs::canonicalize(repo_root).unwrap_or_else(|_| repo_root.to_path_buf());

    let mut result = Vec::with_capacity(raw.len());

    for item in raw {
        let canonical_path = std::fs::canonicalize(&item.path).unwrap_or_else(|_| item.path.clone());
        let is_main = canonical_path == canonical_repo;

        let dirty = count_dirty(&item.path);
        let upstream = upstream_of(&item.path, item.branch.as_deref());
        let (ahead, behind) = ahead_behind(&item.path);
        let head_subject = head_subject(&item.path);

        let base = if is_main {
            None
        } else {
            item.branch
                .as_deref()
                .filter(|branch| *branch != default_branch)
                .map(|_| default_branch.to_string())
                .or_else(|| Some(default_branch.to_string()))
        };

        let created_at = std::fs::metadata(&item.path)
            .and_then(|metadata| metadata.created())
            .ok()
            .map(|time| chrono::DateTime::<chrono::Utc>::from(time).to_rfc3339());

        result.push(Worktree {
            id: Uuid::new_v5(&Uuid::NAMESPACE_URL, item.path.to_string_lossy().as_bytes())
                .to_string(),
            project_id: project_id.to_string(),
            path: item.path.display().to_string(),
            branch: item.branch,
            head: item.head,
            head_subject,
            is_main,
            base,
            dirty,
            ahead,
            behind,
            upstream,
            locked: item.locked,
            prunable: item.prunable,
            created_at,
        });
    }

    Ok(result)
}

fn parse_porcelain(output: &str, repo_root: &Path) -> Vec<RawWorktree> {
    let mut items = Vec::new();
    let mut current: Option<RawWorktree> = None;

    for line in output.lines() {
        if line.is_empty() {
            if let Some(item) = current.take() {
                items.push(item);
            }
            continue;
        }

        if let Some(path) = line.strip_prefix("worktree ") {
            if let Some(previous) = current.take() {
                items.push(previous);
            }
            let path = if Path::new(path).is_absolute() {
                PathBuf::from(path)
            } else {
                repo_root.join(path)
            };
            current = Some(RawWorktree {
                path,
                head: String::new(),
                branch: None,
                locked: false,
                prunable: false,
            });
            continue;
        }

        let Some(item) = current.as_mut() else {
            continue;
        };

        if let Some(head) = line.strip_prefix("HEAD ") {
            item.head = head.to_string();
        } else if let Some(branch) = line.strip_prefix("branch ") {
            item.branch = branch
                .strip_prefix("refs/heads/")
                .map(str::to_string)
                .or_else(|| Some(branch.to_string()));
        } else if line == "locked" || line.starts_with("locked ") {
            item.locked = true;
        } else if line == "prunable" || line.starts_with("prunable ") {
            item.prunable = true;
        }
    }

    if let Some(item) = current.take() {
        items.push(item);
    }

    items
}

fn count_dirty(path: &Path) -> i64 {
    run_git(path, ["status", "--porcelain"])
        .map(|output| output.lines().filter(|line| !line.is_empty()).count() as i64)
        .unwrap_or(0)
}

fn upstream_of(path: &Path, branch: Option<&str>) -> Option<String> {
    if branch.is_none() {
        return None;
    }

    run_git(
        path,
        [
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
        ],
    )
    .ok()
    .map(|output| output.trim().to_string())
    .filter(|value| !value.is_empty())
}

fn ahead_behind(path: &Path) -> (i64, i64) {
    let Ok(output) = run_git(
        path,
        ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
    ) else {
        return (0, 0);
    };

    let mut parts = output.split_whitespace();
    let ahead = parts.next().and_then(|value| value.parse().ok()).unwrap_or(0);
    let behind = parts.next().and_then(|value| value.parse().ok()).unwrap_or(0);
    (ahead, behind)
}

fn head_subject(path: &Path) -> String {
    run_git(path, ["log", "-1", "--format=%s"])
        .map(|output| output.trim().to_string())
        .unwrap_or_default()
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
    fn lists_main_worktree_and_branch_worktree() {
        let repo = init_repo();
        let worktree_path = repo.path().join("wt");
        run_git(
            repo.path(),
            &[
                "worktree",
                "add",
                worktree_path.to_str().unwrap(),
                "-b",
                "feat/x",
                "main",
            ],
        );

        let worktrees =
            list_worktrees("p1", repo.path(), "main").expect("list worktrees");

        assert_eq!(worktrees.len(), 2);
        assert_eq!(worktrees[0].branch.as_deref(), Some("main"));
        assert!(worktrees[0].is_main);
        assert_eq!(worktrees[1].branch.as_deref(), Some("feat/x"));
        assert_eq!(worktrees[1].base.as_deref(), Some("main"));
        assert_eq!(worktrees[1].dirty, 0);
        assert!(!worktrees[1].id.is_empty());
    }

    #[test]
    fn counts_dirty_files_in_a_worktree() {
        let repo = init_repo();
        let worktree_path = repo.path().join("wt");
        run_git(
            repo.path(),
            &[
                "worktree",
                "add",
                worktree_path.to_str().unwrap(),
                "-b",
                "feat/x",
                "main",
            ],
        );

        std::fs::write(worktree_path.join("README.md"), "changed\n").expect("write");

        let worktrees =
            list_worktrees("p1", repo.path(), "main").expect("list worktrees");
        assert_eq!(worktrees[1].dirty, 1);
    }
}

pub fn create(
    input: &crate::models::worktree::CreateWorktreeInput,
    repo_root: &Path,
    default_branch: &str,
) -> AppResult<Worktree> {
    let branch = input.branch.trim();
    if branch.is_empty() {
        return Err(AppError::new("INVALID_INPUT", "分支名不能为空"));
    }

    if !run_git_ok(repo_root, &["check-ref-format", "--branch", branch]) {
        return Err(AppError::new("INVALID_INPUT", "分支名不合法")
            .detail(branch.to_string())
            .hint("使用小写字母、数字、/、-、_，且不能以 - 开头"));
    }

    if !run_git_ok(repo_root, &["rev-parse", "--verify", "--quiet", "HEAD"]) {
        return Err(AppError::new(
            "NO_COMMITS",
            "仓库还没有任何提交，无法创建工作树",
        )
        .hint("先在主仓库完成第一次提交：git add . && git commit -m \"init\""));
    }

    let base = input.base.trim();
    if base.is_empty() {
        return Err(AppError::new("INVALID_INPUT", "起点分支不能为空"));
    }
    let base_rev = format!("{base}^{{commit}}");
    if !run_git_ok(repo_root, &["rev-parse", "--verify", "--quiet", &base_rev]) {
        return Err(AppError::new("BRANCH_NOT_FOUND", "起点分支不存在")
            .detail(base.to_string()));
    }

    if run_git_ok(
        repo_root,
        &["show-ref", "--verify", "--quiet", &format!("refs/heads/{branch}")],
    ) {
        return Err(AppError::new("BRANCH_EXISTS", "这个分支已经存在")
            .detail(branch.to_string()));
    }

    let target = match input.path.as_deref().filter(|value| !value.trim().is_empty()) {
        Some(value) => crate::services::git::repo::expand_path(value),
        None => {
            let slug = branch
                .rsplit('/')
                .next()
                .unwrap_or(branch)
                .chars()
                .map(|character| {
                    if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                        character
                    } else {
                        '-'
                    }
                })
                .collect::<String>();
            repo_root.join(".worktrees").join(slug)
        }
    };

    if target.exists() {
        return Err(AppError::new("WORKTREE_EXISTS", "目录已经存在")
            .detail(target.display().to_string()));
    }

    let parent = target.parent().ok_or_else(|| {
        AppError::new("INVALID_INPUT", "工作树目录不合法")
    })?;
    std::fs::create_dir_all(parent)?;
    let canonical_repo = std::fs::canonicalize(repo_root).unwrap_or_else(|_| repo_root.to_path_buf());
    let canonical_parent = std::fs::canonicalize(parent).unwrap_or_else(|_| parent.to_path_buf());
    if !canonical_parent.starts_with(&canonical_repo) {
        return Err(AppError::new(
            "PATH_OUTSIDE_ROOT",
            "工作树目录必须位于当前仓库内",
        ));
    }

    let target_text = target.display().to_string();
    crate::services::git::run_git(
        repo_root,
        &["worktree", "add", &target_text, "-b", branch, base],
    )?;

    if input.copy_env_local {
        let source = repo_root.join(".env.local");
        if source.is_file() {
            let destination = target.join(".env.local");
            std::fs::copy(&source, &destination).map_err(|error| {
                AppError::new("IO_ERROR", "复制 .env.local 失败")
                    .detail(error.to_string())
            })?;
        }
    }

    let worktrees = list_worktrees(&input.project_id, repo_root, default_branch)?;
    let canonical_target = std::fs::canonicalize(&target).unwrap_or(target);
    worktrees
        .into_iter()
        .find(|worktree| {
            std::fs::canonicalize(&worktree.path)
                .map(|path| path == canonical_target)
                .unwrap_or(false)
        })
        .ok_or_else(|| {
            AppError::new("WORKTREE_NOT_FOUND", "工作树创建后未能读取")
                .detail(target_text)
        })
}

pub fn branches(repo_root: &Path) -> AppResult<Vec<crate::models::git::Branch>> {
    let output = run_git(
        repo_root,
        [
            "branch",
            "--format=%(refname:short)%09%(objectname:short)%09%(committerdate:iso8601)%09%(HEAD)",
        ],
    )?;

    let mut branches = Vec::new();
    for line in output.lines() {
        let mut parts = line.split('\t');
        let Some(name) = parts.next() else { continue };
        if name.trim().is_empty() {
            continue;
        }
        let hash = parts.next().unwrap_or_default().to_string();
        let updated_at = parts
            .next()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        let is_current = parts.next().map(str::trim) == Some("*");

        branches.push(crate::models::git::Branch {
            name: name.to_string(),
            hash,
            updated_at,
            is_current,
        });
    }

    Ok(branches)
}


#[cfg(test)]
mod create_tests {
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
        std::fs::write(dir.path().join(".gitignore"), ".env.local\n").expect("gitignore");
        run_git(dir.path(), &["add", "."]);
        run_git(dir.path(), &["commit", "-m", "init"]);
        dir
    }

    #[test]
    fn creates_a_worktree_and_copies_env_local() {
        let repo = init_repo();
        std::fs::write(repo.path().join(".env.local"), "SECRET=local\n").expect("env");

        let input = crate::models::worktree::CreateWorktreeInput {
            project_id: "p1".to_string(),
            branch: "feat/session-replay".to_string(),
            base: "main".to_string(),
            path: None,
            copy_env_local: true,
        };

        let created = create(&input, repo.path(), "main").expect("create");
        assert_eq!(created.branch.as_deref(), Some("feat/session-replay"));
        assert!(std::path::Path::new(&created.path).ends_with(std::path::Path::new(".worktrees").join("session-replay")));
        assert!(Path::new(&created.path).join(".env.local").is_file());
        assert_eq!(created.dirty, 0);
    }

    #[test]
    fn removes_a_linked_worktree() {
        let repo = init_repo();
        let worktree_path = repo.path().join("wt");
        run_git(
            repo.path(),
            &[
                "worktree",
                "add",
                worktree_path.to_str().unwrap(),
                "-b",
                "feat/remove",
                "main",
            ],
        );

        remove(repo.path(), &worktree_path, false).expect("remove worktree");
        assert!(!worktree_path.exists());
        let worktrees =
            list_worktrees("p1", repo.path(), "main").expect("list worktrees");
        assert_eq!(worktrees.len(), 1);
    }

    #[test]
    fn rejects_a_repository_without_commits() {
        let dir = tempfile::tempdir().expect("tempdir");
        run_git(dir.path(), &["init", "-b", "main"]);

        let input = crate::models::worktree::CreateWorktreeInput {
            project_id: "p1".to_string(),
            branch: "feat/test".to_string(),
            base: "main".to_string(),
            path: None,
            copy_env_local: false,
        };

        let error = create(&input, dir.path(), "main").expect_err("should fail");
        assert_eq!(error.code, "NO_COMMITS");
    }

    #[test]
    fn rejects_existing_branch() {
        let repo = init_repo();
        let input = crate::models::worktree::CreateWorktreeInput {
            project_id: "p1".to_string(),
            branch: "main".to_string(),
            base: "main".to_string(),
            path: None,
            copy_env_local: false,
        };

        let error = create(&input, repo.path(), "main").expect_err("should fail");
        assert_eq!(error.code, "BRANCH_EXISTS");
    }
}

pub fn remove(repo_root: &Path, target: &Path, force: bool) -> AppResult<()> {
    let target_text = target.display().to_string();
    let mut args = vec!["worktree", "remove"];
    if force {
        args.push("--force");
    }
    args.push(&target_text);
    run_git(repo_root, args.as_slice())?;
    Ok(())
}

pub fn prune(repo_root: &Path) -> AppResult<()> {
    run_git(repo_root, ["worktree", "prune"])?;
    Ok(())
}
