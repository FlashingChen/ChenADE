use serde::Serialize;

use crate::error::AppResult;
use crate::services::git;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub git_version: String,
    pub platform: String,
    pub arch: String,
}

#[tauri::command]
pub fn app_info() -> AppResult<AppInfo> {
    let git_version = git::git_version().unwrap_or_else(|_| "未安装".to_string());

    Ok(AppInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        git_version,
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
    })
}
