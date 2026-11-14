use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;

use base64::Engine;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use tauri::ipc::Channel;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::pty::{PtyEvent, PtySpawnInput, PtySpawnResult};

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

pub struct PtyManager {
    sessions: Mutex<HashMap<String, Session>>,
}

impl Default for PtyManager {
    fn default() -> Self {
        Self::new()
    }
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    pub fn spawn(
        &self,
        input: PtySpawnInput,
        on_event: Channel<PtyEvent>,
    ) -> AppResult<PtySpawnResult> {
        let sender: Arc<dyn Fn(PtyEvent) + Send + Sync> = Arc::new(move |event| {
            let _ = on_event.send(event);
        });
        self.spawn_with_sender(input, sender)
    }

    pub(crate) fn spawn_with_sender(
        &self,
        input: PtySpawnInput,
        sender: Arc<dyn Fn(PtyEvent) + Send + Sync>,
    ) -> AppResult<PtySpawnResult> {
        let shell = input.shell.unwrap_or_else(default_shell);
        let load_profile = input.load_profile.unwrap_or(false);
        let size = PtySize {
            rows: input.rows.max(2),
            cols: input.cols.max(2),
            pixel_width: 0,
            pixel_height: 0,
        };

        let pty_system = native_pty_system();
        let pair = pty_system.openpty(size).map_err(|error| {
            AppError::new("PTY_SPAWN_FAILED", "无法创建终端")
                .detail(error.to_string())
        })?;

        let mut command = CommandBuilder::new(&shell);
        let args = input.args.unwrap_or_else(|| {
            if load_profile {
                default_shell_args(&shell)
            } else {
                clean_shell_args(&shell)
            }
        });
        if !args.is_empty() {
            command.args(args);
        }
        command.cwd(&input.cwd);
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");

        if !load_profile {
            if let Some(path) = enriched_path() {
                command.env("PATH", path);
            }
            configure_clean_shell(&mut command, &shell);
        }
        if let Some(env) = input.env {
            for (key, value) in env {
                command.env(key, value);
            }
        }

        let mut child = pair
            .slave
            .spawn_command(command)
            .map_err(|error| {
                AppError::new("PTY_SPAWN_FAILED", "无法启动终端进程")
                    .detail(error.to_string())
                    .hint("检查 shell 路径与工作树目录权限")
            })?;

        // The slave is no longer needed once the child is spawned.
        drop(pair.slave);

        let mut reader = pair.master.try_clone_reader().map_err(|error| {
            AppError::new("PTY_SPAWN_FAILED", "无法读取终端输出")
                .detail(error.to_string())
        })?;
        let writer = pair.master.take_writer().map_err(|error| {
            AppError::new("PTY_SPAWN_FAILED", "无法写入终端")
                .detail(error.to_string())
        })?;
        let killer = child.clone_killer();
        let pid = child.process_id().unwrap_or(0);

        let session_id = Uuid::new_v4().to_string();
        let reader_sender = sender.clone();
        let reader_id = session_id.clone();
        thread::spawn(move || {
            let engine = base64::engine::general_purpose::STANDARD;
            let mut buffer = [0u8; 16 * 1024];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(read) => {
                        let data = engine.encode(&buffer[..read]);
                        reader_sender(PtyEvent::Data { data });
                    }
                    Err(_) => break,
                }
            }
            tracing::debug!(session_id = %reader_id, "pty reader closed");
        });

        let exit_sender = sender;
        thread::spawn(move || {
            match child.wait() {
                Ok(status) => {
                    exit_sender(PtyEvent::Exit {
                        code: Some(status.exit_code() as i32),
                        signal: status.signal().map(str::to_string),
                    });
                }
                Err(error) => {
                    exit_sender(PtyEvent::Error {
                        message: error.to_string(),
                    });
                }
            }
        });

        let session = Session {
            master: pair.master,
            writer,
            killer,
        };

        let mut sessions = self.sessions.lock().map_err(|_| {
            AppError::new("PTY_SPAWN_FAILED", "终端状态不可用")
        })?;
        sessions.insert(session_id.clone(), session);

        Ok(PtySpawnResult {
            session_id,
            shell,
            pid,
        })
    }

    pub fn write(&self, session_id: &str, data: &str) -> AppResult<()> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| AppError::new("PTY_NOT_FOUND", "终端状态不可用"))?;
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| AppError::new("PTY_NOT_FOUND", "终端已关闭"))?;
        session
            .writer
            .write_all(data.as_bytes())
            .map_err(|error| AppError::new("IO_ERROR", "写入终端失败").detail(error.to_string()))?;
        session
            .writer
            .flush()
            .map_err(|error| AppError::new("IO_ERROR", "刷新终端失败").detail(error.to_string()))
    }

    pub fn resize(&self, session_id: &str, cols: u16, rows: u16) -> AppResult<()> {
        let sessions = self
            .sessions
            .lock()
            .map_err(|_| AppError::new("PTY_NOT_FOUND", "终端状态不可用"))?;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| AppError::new("PTY_NOT_FOUND", "终端已关闭"))?;
        session
            .master
            .resize(PtySize {
                rows: rows.max(2),
                cols: cols.max(2),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| AppError::new("IO_ERROR", "调整终端尺寸失败").detail(error.to_string()))
    }

    pub fn kill(&self, session_id: &str) -> AppResult<()> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| AppError::new("PTY_NOT_FOUND", "终端状态不可用"))?;
        if let Some(mut session) = sessions.remove(session_id) {
            let _ = session.killer.kill();
        }
        Ok(())
    }

    pub fn kill_all(&self) {
        if let Ok(mut sessions) = self.sessions.lock() {
            for (_, mut session) in sessions.drain() {
                let _ = session.killer.kill();
            }
        }
    }
}

fn clean_shell_args(shell: &str) -> Vec<String> {
    #[cfg(unix)]
    {
        let name = std::path::Path::new(shell)
            .file_name()
            .map(|value| value.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        match name.as_str() {
            "zsh" => Vec::new(),
            "bash" => vec!["--noprofile".to_string(), "--norc".to_string()],
            "fish" => vec!["--no-config".to_string()],
            _ => Vec::new(),
        }
    }
    #[cfg(not(unix))]
    {
        let _ = shell;
        Vec::new()
    }
}

fn configure_clean_shell(command: &mut CommandBuilder, shell: &str) {
    let name = std::path::Path::new(shell)
        .file_name()
        .map(|value| value.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    match name.as_str() {
        "zsh" => {
            if let Some(dir) = clean_zsh_dir() {
                command.env("ZDOTDIR", dir);
            }
        }
        "bash" => {
            command.env("PS1", "\\[\\033[32m\\]❯\\[\\033[0m\\] ");
        }
        _ => {
            command.env("PS1", "❯ ");
        }
    }
}

fn clean_zsh_dir() -> Option<PathBuf> {
    let dir = std::env::temp_dir().join("chenade-clean-zsh");
    std::fs::create_dir_all(&dir).ok()?;
    let rc = dir.join(".zshrc");
    let _ = std::fs::write(
        &rc,
        "PROMPT='%F{green}❯%f '\nRPROMPT=''\nunset RPS1\n",
    );
    Some(dir)
}

fn enriched_path() -> Option<String> {
    let mut paths: Vec<PathBuf> = vec![
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
        PathBuf::from("/bin"),
    ];
    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        paths.push(home.join(".local/bin"));
        paths.push(home.join(".cargo/bin"));
        paths.push(home.join(".local/share/pnpm"));
    }
    if let Some(current) = std::env::var_os("PATH") {
        paths.extend(std::env::split_paths(&current));
    }
    std::env::join_paths(paths)
        .ok()
        .map(|value| value.to_string_lossy().to_string())
}

fn default_shell_args(shell: &str) -> Vec<String> {
    #[cfg(unix)]
    {
        let name = std::path::Path::new(shell)
            .file_name()
            .map(|value| value.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        if matches!(name.as_str(), "zsh" | "bash" | "fish") {
            return vec!["-l".to_string()];
        }
    }
    Vec::new()
}

fn default_shell() -> String {
    #[cfg(unix)]
    {
        std::env::var("SHELL")
            .ok()
            .filter(|shell| !shell.trim().is_empty())
            .unwrap_or_else(|| {
                if std::path::Path::new("/bin/zsh").exists() {
                    "/bin/zsh".to_string()
                } else {
                    "/bin/bash".to_string()
                }
            })
    }

    #[cfg(windows)]
    {
        "powershell.exe".to_string()
    }
}


#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    #[test]
    fn spawns_shell_and_streams_output() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (tx, rx) = mpsc::channel::<PtyEvent>();
        let sender: Arc<dyn Fn(PtyEvent) + Send + Sync> = Arc::new(move |event| {
            let _ = tx.send(event);
        });

        let manager = PtyManager::new();
        let result = manager
            .spawn_with_sender(
                PtySpawnInput {
                    cwd: dir.path().display().to_string(),
                    shell: Some("/bin/sh".to_string()),
                    args: Some(vec![
                        "-c".to_string(),
                        "printf 'hello-pty'; exit 3".to_string(),
                    ]),
                    cols: 80,
                    rows: 24,
                    env: None,
                    load_profile: Some(false),
                },
                sender,
            )
            .expect("spawn pty");

        assert!(!result.session_id.is_empty());

        let engine = base64::engine::general_purpose::STANDARD;
        let mut output = String::new();
        let mut exit_code = None;
        let deadline = Instant::now() + Duration::from_secs(5);

        while Instant::now() < deadline {
            match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(PtyEvent::Data { data }) => {
                    let bytes = engine.decode(data).expect("base64");
                    output.push_str(&String::from_utf8_lossy(&bytes));
                }
                Ok(PtyEvent::Exit { code, .. }) => {
                    exit_code = code;
                    break;
                }
                Ok(PtyEvent::Error { message }) => panic!("pty error: {message}"),
                Err(_) => continue,
            }
        }

        assert!(output.contains("hello-pty"), "output: {output}");
        assert_eq!(exit_code, Some(3));
        manager.kill(&result.session_id).expect("kill");
    }
}


#[cfg(all(test, unix))]
mod clean_shell_tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    #[test]
    fn clean_zsh_uses_simple_prompt_and_skips_user_rc() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (tx, rx) = mpsc::channel::<PtyEvent>();
        let sender: Arc<dyn Fn(PtyEvent) + Send + Sync> = Arc::new(move |event| {
            let _ = tx.send(event);
        });

        let manager = PtyManager::new();
        let result = manager
            .spawn_with_sender(
                PtySpawnInput {
                    cwd: dir.path().display().to_string(),
                    shell: Some("/bin/zsh".to_string()),
                    args: None,
                    cols: 80,
                    rows: 24,
                    env: None,
                    load_profile: Some(false),
                },
                sender,
            )
            .expect("spawn clean zsh");

        let engine = base64::engine::general_purpose::STANDARD;
        let mut output = String::new();
        let deadline = Instant::now() + Duration::from_secs(4);

        while Instant::now() < deadline {
            match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(PtyEvent::Data { data }) => {
                    let bytes = engine.decode(data).expect("base64");
                    output.push_str(&String::from_utf8_lossy(&bytes));
                    if output.contains('❯') {
                        break;
                    }
                }
                Ok(PtyEvent::Exit { .. }) => break,
                Ok(PtyEvent::Error { message }) => panic!("pty error: {message}"),
                Err(_) => continue,
            }
        }

        assert!(output.contains('❯'), "clean prompt missing: {output:?}");
        manager.kill(&result.session_id).expect("kill");
    }
}
