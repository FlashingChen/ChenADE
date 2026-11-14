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
        .map_err(|error| {
            AppError::new("GIT_NOT_FOUND", "找不到 git，请先安装 Git")
                .detail(error.to_string())
                .hint("安装 Git 后重启 ChenADE")
        })
}

pub fn git_version() -> AppResult<String> {
    let output = Command::new("git")
        .arg("--version")
        .env("LC_ALL", "C")
        .output()
        .map_err(|error| {
            AppError::new("GIT_NOT_FOUND", "找不到 git，请先安装 Git")
                .detail(error.to_string())
        })?;

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
        .map_err(|error| {
            AppError::new("GIT_NOT_FOUND", "找不到 git，请先安装 Git")
                .detail(error.to_string())
        })?;

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
