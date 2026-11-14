use std::path::Path;
use std::process::Command;

use crate::error::{AppError, AppResult};

pub fn reveal(path: &Path) -> AppResult<()> {
    let status = {
        #[cfg(target_os = "macos")]
        {
            Command::new("open").arg("-R").arg(path).status()?
        }
        #[cfg(target_os = "windows")]
        {
            Command::new("explorer")
                .arg(format!("/select,{}", path.display()))
                .status()?
        }
        #[cfg(target_os = "linux")]
        {
            let target = path.parent().unwrap_or(path);
            Command::new("xdg-open").arg(target).status()?
        }
    };

    if status.success() {
        Ok(())
    } else {
        Err(AppError::new("IO_ERROR", "无法打开文件管理器")
            .detail(format!("exit status: {status}")))
    }
}

#[allow(dead_code)]
pub fn open_external(path: &Path) -> AppResult<()> {
    let status = {
        #[cfg(target_os = "macos")]
        {
            Command::new("open").arg(path).status()?
        }
        #[cfg(target_os = "windows")]
        {
            Command::new("cmd")
                .args(["/C", "start", ""])
                .arg(path)
                .status()?
        }
        #[cfg(target_os = "linux")]
        {
            Command::new("xdg-open").arg(path).status()?
        }
    };

    if status.success() {
        Ok(())
    } else {
        Err(AppError::new("IO_ERROR", "无法打开外部应用")
            .detail(format!("exit status: {status}")))
    }
}

#[allow(dead_code)]
pub fn open_url(url: &str) -> AppResult<()> {
    let parsed = url::Url::parse(url)
        .map_err(|error| AppError::new("INVALID_INPUT", "链接格式不正确").detail(error.to_string()))?;

    if parsed.scheme() != "https" {
        return Err(AppError::new("INVALID_INPUT", "只允许打开 HTTPS 链接"));
    }

    let status = {
        #[cfg(target_os = "macos")]
        {
            Command::new("open").arg(url).status()?
        }
        #[cfg(target_os = "windows")]
        {
            Command::new("cmd").args(["/C", "start", ""]).arg(url).status()?
        }
        #[cfg(target_os = "linux")]
        {
            Command::new("xdg-open").arg(url).status()?
        }
    };

    if status.success() {
        Ok(())
    } else {
        Err(AppError::new("IO_ERROR", "无法打开浏览器")
            .detail(format!("exit status: {status}")))
    }
}
