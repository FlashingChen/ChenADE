pub mod compare;
pub mod diff;
pub mod log;
pub mod ops;
pub mod repo;
pub mod status;
pub mod worktree;

use std::path::Path;
use std::process::{Command, Output};

use crate::error::{AppError, AppResult};

/// Run git with a stable, non-interactive environment.
pub fn run_git<'a, A>(cwd: &Path, args: A) -> AppResult<String>
where
    A: AsRef<[&'a str]>,
{
    let args = args.as_ref();
    let output = git_output(cwd, args)?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::new("GIT_FAILED", "Git 命令执行失败")
            .detail(format!("git {}: {stderr}", args.join(" "))));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

pub fn run_git_ok<'a, A>(cwd: &Path, args: A) -> bool
where
    A: AsRef<[&'a str]>,
{
    git_output(cwd, args.as_ref())
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn git_output(cwd: &Path, args: &[&str]) -> AppResult<Output> {
    Command::new("git")
        .current_dir(cwd)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .env("LANG", "C")
        .output()
        .map_err(|error| spawn_error(error, Some(cwd)))
}

/// 把 `Command::output()` 的 io 错误翻译成人话。
///
/// `current_dir` 不存在时内核返回的也是 ENOENT，和“找不到 git 可执行文件”完全同码。
/// 以前一律报“找不到 git，请先安装 Git”——项目目录被移动/删除的用户会一头雾水地
/// 去重装 Git（docs/11 实测：clash-verge-rev 的目录已不存在）。
fn spawn_error(error: std::io::Error, cwd: Option<&Path>) -> AppError {
    if error.kind() == std::io::ErrorKind::NotFound && cwd.map(|path| !path.exists()).unwrap_or(false)
    {
        let path = cwd.map(|path| path.display().to_string()).unwrap_or_default();
        return AppError::new("PROJECT_PATH_MISSING", "项目目录不存在")
            .detail(path)
            .hint("目录可能已被移动或删除：在左栏移除该项目后重新添加，或点“重试”");
    }

    if error.kind() == std::io::ErrorKind::NotFound {
        return AppError::new("GIT_NOT_FOUND", "找不到 git，请先安装 Git")
            .detail(error.to_string())
            .hint("安装 Git 后重启 ChenADE");
    }

    AppError::new("GIT_FAILED", "无法启动 git").detail(error.to_string())
}

pub fn git_version() -> AppResult<String> {
    let output = Command::new("git")
        .arg("--version")
        .env("LC_ALL", "C")
        .output()
        .map_err(|error| spawn_error(error, None))?;

    if !output.status.success() {
        return Err(AppError::new("GIT_NOT_FOUND", "无法运行 git"));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

pub fn run_git_with_input(cwd: &Path, args: &[&str], input: &str) -> AppResult<String> {
    use std::io::Write as _;
    use std::process::Stdio;

    let mut child = Command::new("git")
        .current_dir(cwd)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .env("LANG", "C")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| spawn_error(error, Some(cwd)))?;

    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(input.as_bytes())
            .map_err(|error| AppError::new("IO_ERROR", "写入 git 输入失败").detail(error.to_string()))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|error| AppError::new("IO_ERROR", "等待 git 完成失败").detail(error.to_string()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::new("GIT_FAILED", "Git 命令执行失败")
            .detail(format!("git {}: {stderr}", args.join(" "))));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[cfg(test)]
mod spawn_error_tests {
    use super::*;
    use std::io::{Error, ErrorKind};

    #[test]
    fn missing_cwd_is_reported_as_missing_project_not_missing_git() {
        let dir = tempfile::tempdir().unwrap();
        let gone = dir.path().join("removed-worktree");
        let error = spawn_error(Error::new(ErrorKind::NotFound, "No such file"), Some(&gone));
        assert_eq!(error.code, "PROJECT_PATH_MISSING");
        assert!(error.message.contains("项目目录不存在"));
    }

    #[test]
    fn missing_executable_keeps_git_hint() {
        let dir = tempfile::tempdir().unwrap();
        let error = spawn_error(Error::new(ErrorKind::NotFound, "No such file"), Some(dir.path()));
        assert_eq!(error.code, "GIT_NOT_FOUND");
    }

    #[test]
    fn other_io_errors_are_not_mistaken_for_git() {
        let dir = tempfile::tempdir().unwrap();
        let error = spawn_error(Error::new(ErrorKind::PermissionDenied, "denied"), Some(dir.path()));
        assert_eq!(error.code, "GIT_FAILED");
    }
}
