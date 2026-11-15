mod commands;
mod error;
mod models;
mod services;

pub use error::AppError;

use services::db::Db;
use services::pty::PtyManager;
use services::tmux::Tmux;
use tauri::Manager;
use tracing_subscriber::EnvFilter;

pub fn run() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("chenade=info"));

    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let db = Db::init(app.handle())?;
            app.manage(db);

            // 随包分发的 tmux 二进制 + 生成的 tmux.conf；找不到就回退普通 PTY。
            let resource_dir = app
                .path()
                .resource_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."));
            let config_dir = app
                .path()
                .app_config_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("chenade"));
            let tmux = Tmux::detect(&resource_dir, &config_dir);
            tracing::info!(
                available = tmux.is_available(),
                version = tmux.version().unwrap_or("none"),
                "tmux backend"
            );
            app.manage(PtyManager::with_tmux(tmux));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::app_info,
            commands::projects::projects_list,
            commands::projects::project_validate,
            commands::projects::project_add,
            commands::projects::project_remove,
            commands::projects::project_reorder,
            commands::projects::project_touch,
            commands::projects::project_reveal,
            commands::worktrees::worktrees_list,
            commands::worktrees::worktree_status,
            commands::worktrees::worktree_create,
            commands::worktrees::worktree_remove,
            commands::worktrees::worktree_prune,
            commands::worktrees::git_branches,
            commands::files::files_list_dir,
            commands::files::files_read,
            commands::files::files_reveal,
            commands::files::files_open_external,
            commands::git::git_log,
            commands::git::git_diff_worktree,
            commands::git::git_diff_commit,
            commands::git::git_identity,
            commands::git::git_commit,
            commands::git::git_push,
            commands::git::git_compare_url,
            commands::git::open_external_url,
            commands::git::git_reveal_path,
            commands::settings::settings_get,
            commands::settings::settings_set,
            commands::activity::activity_list,
            commands::activity::activity_add,
            commands::search::search_files,
            commands::files::files_write,
            commands::pty::pty_spawn,
            commands::pty::pty_write,
            commands::pty::pty_resize,
            commands::pty::pty_kill,
            commands::tmux::tmux_status,
            commands::tmux::tmux_prune_sessions,
        ])
        .build(tauri::generate_context!())
        .expect("error while building ChenADE")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(manager) = app_handle.try_state::<PtyManager>() {
                    manager.kill_all();
                }
            }
        });
}
