use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use base64::Engine;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use tauri::ipc::Channel;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::pty::{PtyEvent, PtySpawnInput, PtySpawnResult};
use crate::services::tmux::Tmux;

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    /// tmux 会话名：有值时退出前要先 detach，不能直接拆 pty。
    tmux_name: Option<String>,
    /// 客户端进程是否已经退出（由 wait 线程置位）。
    exited: Arc<AtomicBool>,
}

pub struct PtyManager {
    sessions: Mutex<HashMap<String, Session>>,
    tmux: Tmux,
}

impl Default for PtyManager {
    fn default() -> Self {
        Self::new()
    }
}

impl PtyManager {
    pub fn new() -> Self {
        Self::with_tmux(Tmux::default())
    }

    pub fn with_tmux(tmux: Tmux) -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            tmux,
        }
    }

    pub fn tmux(&self) -> &Tmux {
        &self.tmux
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
        let shell = input.shell.clone().unwrap_or_else(default_shell);
        let load_profile = input.load_profile.unwrap_or(false);
        let shell_args = input.args.clone().unwrap_or_else(|| {
            if load_profile {
                default_shell_args(&shell)
            } else {
                clean_shell_args(&shell)
            }
        });

        // 有 persist 键且 tmux 可用时，终端跑在 tmux 会话里：应用退出只是 detach，
        // 会话与进程留在 tmux server 上，重开应用按同一个键重连。
        let session_name = input
            .persist
            .as_deref()
            .map(Tmux::session_name)
            .filter(|_| self.tmux.is_available());
        let created = match session_name.as_deref() {
            Some(name) => !self.tmux.has_session(name),
            None => true,
        };
        let (program, program_args, backend) = match session_name.as_deref() {
            Some(name) => match self
                .tmux
                .attach_command(name, &input.cwd, &shell, &shell_args)
            {
                Some((program, args)) => (
                    program.display().to_string(),
                    args,
                    "tmux".to_string(),
                ),
                None => (shell.clone(), shell_args, "shell".to_string()),
            },
            None => (shell.clone(), shell_args, "shell".to_string()),
        };

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

        let mut command = CommandBuilder::new(&program);
        if !program_args.is_empty() {
            command.args(program_args);
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
        let exited = Arc::new(AtomicBool::new(false));
        let exited_flag = exited.clone();
        thread::spawn(move || {
            let _ = &exited_flag;
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
            exited_flag.store(true, Ordering::SeqCst);
        });

        let session = Session {
            master: pair.master,
            writer,
            killer,
            tmux_name: if backend == "tmux" {
                session_name.clone()
            } else {
                None
            },
            exited,
        };

        let mut sessions = self.sessions.lock().map_err(|_| {
            AppError::new("PTY_SPAWN_FAILED", "终端状态不可用")
        })?;
        sessions.insert(session_id.clone(), session);

        Ok(PtySpawnResult {
            session_id,
            shell,
            pid,
            backend: backend.clone(),
            persistent: backend == "tmux",
            created,
            session_name,
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
        let session = {
            let mut sessions = self
                .sessions
                .lock()
                .map_err(|_| AppError::new("PTY_NOT_FOUND", "终端状态不可用"))?;
            sessions.remove(session_id)
        };
        if let Some(mut session) = session {
            self.detach_and_kill(&mut session);
        }
        Ok(())
    }

    pub fn kill_all(&self) {
        let mut drained: Vec<Session> = match self.sessions.lock() {
            Ok(mut sessions) => sessions.drain().map(|(_, session)| session).collect(),
            Err(_) => Vec::new(),
        };

        // 退出应用时先把所有 tmux 客户端 detach 掉，再共用一个截止时间等它们退出：
        // 逐个等会让 5 个终端最多卡住 3 秒。
        let mut pending = 0usize;
        for session in &drained {
            if let Some(name) = session.tmux_name.clone() {
                let _ = self.tmux.detach_client(&name);
                pending += 1;
            }
        }
        if pending > 0 {
            let deadline = Instant::now() + Duration::from_millis(600);
            while Instant::now() < deadline
                && drained
                    .iter()
                    .any(|session| session.tmux_name.is_some() && !session.exited.load(Ordering::SeqCst))
            {
                thread::sleep(Duration::from_millis(10));
            }
        }

        for session in &mut drained {
            let _ = session.killer.kill();
        }
    }

    /// tmux 会话必须先 `detach-client` 并等客户端退出，再拆 pty。
    ///
    /// 实测：直接 SIGHUP 客户端后立刻关闭 pty master，会在 50ms 内把 tmux server
    /// 一起带走，会话（进程 + 屏幕）全丢——这是“应用退出后终端没了”的真实原因。
    fn detach_and_kill(&self, session: &mut Session) {
        if let Some(name) = session.tmux_name.clone() {
            let _ = self.tmux.detach_client(&name);
            let deadline = Instant::now() + Duration::from_millis(600);
            while !session.exited.load(Ordering::SeqCst) && Instant::now() < deadline {
                thread::sleep(Duration::from_millis(10));
            }
        }
        let _ = session.killer.kill();
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
            "zsh" => vec!["-d".to_string()],
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
                    persist: None,
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
                    persist: None,
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

#[cfg(all(test, unix))]
mod persist_tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    fn collect_until(rx: &mpsc::Receiver<PtyEvent>, needle: &str, timeout: Duration) -> String {
        let engine = base64::engine::general_purpose::STANDARD;
        let mut output = String::new();
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(PtyEvent::Data { data }) => {
                    let bytes = engine.decode(data).expect("base64");
                    output.push_str(&String::from_utf8_lossy(&bytes));
                    if output.contains(needle) {
                        return output;
                    }
                }
                Ok(PtyEvent::Exit { .. }) => continue,
                Ok(PtyEvent::Error { message }) => panic!("pty error: {message}"),
                Err(_) => continue,
            }
        }
        output
    }

    /// 守 docs/10-fixes-2026-11-15.md 第 5 节：关应用只 detach tmux 客户端，
    /// 会话（进程 + 屏幕）留在 tmux server 上；重开应用按同一个键重连。
    #[test]
    fn tmux_session_survives_client_exit_and_reattaches() {
        let resource_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
        let config_dir = tempfile::tempdir().expect("config dir");
        let tmux = Tmux::detect(&resource_dir, config_dir.path());
        if !tmux.is_available() {
            eprintln!("skip: bundled tmux binary not found");
            return;
        }

        let manager = PtyManager::with_tmux(tmux);
        let dir = tempfile::tempdir().expect("workdir");
        let (tx, rx) = mpsc::channel::<PtyEvent>();
        let sender: Arc<dyn Fn(PtyEvent) + Send + Sync> = Arc::new(move |event| {
            let _ = tx.send(event);
        });

        let key = format!("persist-test-{}", uuid::Uuid::new_v4());
        let input = PtySpawnInput {
            cwd: dir.path().display().to_string(),
            shell: Some("/bin/sh".to_string()),
            args: Some(Vec::new()),
            cols: 100,
            rows: 30,
            env: None,
            load_profile: Some(false),
            persist: Some(key.clone()),
        };
        let session_name = Tmux::session_name(&key);

        let first = manager
            .spawn_with_sender(input.clone(), sender.clone())
            .expect("spawn tmux session");
        assert!(first.persistent, "backend should be tmux: {first:?}");
        assert!(first.created, "first spawn should create the session");

        manager
            .write(&first.session_id, "echo marker-one\r")
            .expect("write");
        let output = collect_until(&rx, "marker-one", Duration::from_secs(8));
        assert!(output.contains("marker-one"), "output: {output}");

        // 关应用 = detach 客户端（不是 kill-session）。
        manager.kill(&first.session_id).expect("detach client");

        let second = manager
            .spawn_with_sender(input, sender.clone())
            .expect("reattach tmux session");
        assert!(second.persistent);
        assert!(!second.created, "session should already exist");
        assert_eq!(second.session_name.as_deref(), Some(session_name.as_str()));

        // 重连时 tmux 整屏重绘：之前的输出重新出现在流里。
        let redraw = collect_until(&rx, "marker-one", Duration::from_secs(8));
        assert!(redraw.contains("marker-one"), "reattach redraw: {redraw}");

        // 还是同一个 shell：新命令在同一会话里执行。
        manager
            .write(&second.session_id, "echo marker-two\r")
            .expect("write");
        let output = collect_until(&rx, "marker-two", Duration::from_secs(8));
        assert!(output.contains("marker-two"), "output: {output}");

        manager.kill(&second.session_id).expect("detach client");
        manager
            .tmux()
            .kill_session(&session_name)
            .expect("cleanup session");
    }
}
