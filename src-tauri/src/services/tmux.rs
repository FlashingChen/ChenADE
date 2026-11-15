use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::error::{AppError, AppResult};

/// 私有 socket 名：与用户自己的 tmux 完全隔离，避免误连到 ~/.tmux 的会话。
pub const SOCKET: &str = "chenade";
/// 会话名前缀，用于启动时清理孤儿会话。
pub const SESSION_PREFIX: &str = "chenade-";

const CONFIG_HEADER: &str = "# managed by ChenADE — regenerated on launch, edits are lost\n";

const CONFIG_BODY: &str = r#"set -g default-terminal "tmux-256color"
set -sg escape-time 0
set -g history-limit 50000
set -g mouse on
set -g focus-events on
set -g status off
set -g visual-activity off
set -g visual-bell off
set -g bell-action none
set -g allow-passthrough on
set -g set-clipboard on
set -g destroy-unattached off
set -g renumber-windows on
set -as terminal-features ",xterm-256color:RGB"
set -as terminal-features ",xterm-256color:hyperlinks"
"#;

/// tmux 后端：随应用分发一份静态链接的 tmux，用私有 socket 跑每个终端标签的会话。
///
/// 找不到二进制时（未打包、其它平台）所有方法都返回“不可用”，PtyManager 自动回退普通 PTY。
#[derive(Debug, Clone, Default)]
pub struct Tmux {
    binary: Option<PathBuf>,
    config: Option<PathBuf>,
    version: Option<String>,
}

impl Tmux {
    /// 解析二进制并生成配置。缺二进制不算错误：回退普通 shell 即可。
    pub fn detect(resource_dir: &Path, config_dir: &Path) -> Self {
        let binary = locate_binary(resource_dir);
        let version = binary.as_deref().and_then(read_version);
        let config = binary
            .as_ref()
            .and_then(|_| write_config(config_dir).ok());
        Self {
            binary,
            config,
            version,
        }
    }

    pub fn binary(&self) -> Option<&Path> {
        self.binary.as_deref()
    }

    pub fn is_available(&self) -> bool {
        self.binary.is_some()
    }

    pub fn version(&self) -> Option<&str> {
        self.version.as_deref()
    }

    /// 会话名由标签 id 归一化而来：重启后 tabId 不变即可确定性重连。
    pub fn session_name(key: &str) -> String {
        let mut sanitized = String::with_capacity(key.len());
        for ch in key.chars() {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                sanitized.push(ch);
            } else {
                sanitized.push('-');
            }
        }
        let sanitized = sanitized.trim_matches('-');
        let tail: String = sanitized
            .chars()
            .rev()
            .take(48)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        format!("{SESSION_PREFIX}{tail}")
    }

    fn base_command(&self) -> Option<Command> {
        let binary = self.binary.as_ref()?;
        let mut command = Command::new(binary);
        command
            .arg("-L")
            .arg(SOCKET)
            // 在 tmux 里启动 ChenADE 时，TMUX 变量会让新客户端报错。
            .env_remove("TMUX")
            .env_remove("TMUX_PANE");
        if let Some(config) = self.config.as_ref() {
            command.arg("-f").arg(config);
        }
        Some(command)
    }

    /// 探测会话是否存在。
    ///
    /// 刚起完 server 时偶发一次 "no server running" 的假阴性（socket 刚绑定），
    /// 假阴性会让前端把重连当成新会话、往正在跑的任务里补发命令，所以重试一次。
    pub fn has_session(&self, name: &str) -> bool {
        for attempt in 0..2 {
            if attempt > 0 {
                std::thread::sleep(std::time::Duration::from_millis(80));
            }
            let Some(mut command) = self.base_command() else {
                return false;
            };
            let found = command
                .arg("has-session")
                .arg("-t")
                .arg(name)
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status()
                .map(|status| status.success())
                .unwrap_or(false);
            if found {
                return true;
            }
        }
        false
    }

    /// 让客户端干净断开（应用退出/关标签时用）。
    ///
    /// 直接 kill 客户端会和 pty 拆除抢跑：实测 SIGHUP 之后立刻关闭 master，
    /// 会在 50ms 内把 tmux server 一起带走，会话（进程 + 屏幕）全丢。
    /// `detach-client` 的 `-t` 在 3.5a 里按 client 解析（报 "can't find client"），
    /// 所以先用 `list-clients` 取到该会话的客户端 tty，再用 `-s <tty>` 断开。
    pub fn detach_client(&self, session: &str) -> AppResult<()> {
        let mut ttys = Vec::new();
        for attempt in 0..20 {
            ttys = self.client_ttys(session);
            if !ttys.is_empty() || attempt == 19 {
                break;
            }
            // 同样的 socket 竞态：server 刚绑定完时第一次查询可能看不到客户端。
            // CI 的 runner 更慢，给到 1s，避免“查不到客户端 → 直接 kill → server 一起没”。
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        for tty in ttys {
            let Some(mut command) = self.base_command() else {
                return Ok(());
            };
            command
                .arg("detach-client")
                .arg("-s")
                .arg(&tty)
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status()
                .map_err(|error| {
                    AppError::new("TMUX_ERROR", "无法断开终端会话").detail(error.to_string())
                })?;
        }

        // 等到 server 真的把客户端摘掉：detach-client 返回成功 ≠ 断开已完成。
        for _ in 0..24 {
            if self.client_ttys(session).is_empty() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
        Ok(())
    }

    pub fn client_ttys(&self, session: &str) -> Vec<String> {
        let Some(mut command) = self.base_command() else {
            return Vec::new();
        };
        let output = command
            .arg("list-clients")
            .arg("-F")
            .arg("#{session_name}\t#{client_tty}")
            .output();
        let Ok(output) = output else {
            return Vec::new();
        };
        if !output.status.success() {
            return Vec::new();
        }
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter_map(|line| line.split_once('\t'))
            .filter(|(name, _)| *name == session)
            .map(|(_, tty)| tty.trim().to_string())
            .filter(|tty| !tty.is_empty())
            .collect()
    }

    pub fn kill_session(&self, name: &str) -> AppResult<()> {
        let Some(mut command) = self.base_command() else {
            return Ok(());
        };
        command
            .arg("kill-session")
            .arg("-t")
            .arg(name)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map_err(|error| {
                AppError::new("TMUX_ERROR", "无法结束终端会话").detail(error.to_string())
            })?;
        Ok(())
    }

    pub fn list_sessions(&self) -> Vec<String> {
        let Some(mut command) = self.base_command() else {
            return Vec::new();
        };
        let output = command
            .arg("list-sessions")
            .arg("-F")
            .arg("#{session_name}")
            .output();
        let Ok(output) = output else {
            return Vec::new();
        };
        if !output.status.success() {
            // 没有 server 时 tmux 以非零退出，这是正常状态。
            return Vec::new();
        }
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(|line| line.trim().to_string())
            .filter(|line| !line.is_empty())
            .collect()
    }

    /// 启动（或重连）一个会话的客户端命令。
    pub fn attach_command(
        &self,
        name: &str,
        cwd: &str,
        shell: &str,
        args: &[String],
    ) -> Option<(PathBuf, Vec<String>)> {
        let binary = self.binary.clone()?;
        let mut argv: Vec<String> = vec![
            "-L".to_string(),
            SOCKET.to_string(),
            "-u".to_string(),
        ];
        if let Some(config) = self.config.as_ref() {
            argv.push("-f".to_string());
            argv.push(config.display().to_string());
        }
        argv.extend([
            "new-session".to_string(),
            "-A".to_string(),
            "-s".to_string(),
            name.to_string(),
            "-c".to_string(),
            cwd.to_string(),
        ]);
        argv.push("--".to_string());
        argv.push(shell.to_string());
        argv.extend(args.iter().cloned());
        Some((binary, argv))
    }
}

/// 只认 macOS：随包分发的是 Mach-O universal 二进制，在 Linux/Windows 上即使文件存在
/// 也不能执行；其它平台一律回退普通 PTY（CI 在三个系统上跑测试，不能把这条漏掉）。
fn locate_binary(resource_dir: &Path) -> Option<PathBuf> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = resource_dir;
        return None;
    }

    #[cfg(target_os = "macos")]
    {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Some(override_path) = env::var_os("CHENADE_TMUX") {
        candidates.push(PathBuf::from(override_path));
    }
    candidates.push(resource_dir.join("bin").join(exe_name()));
    candidates.push(resource_dir.join("resources").join("bin").join(exe_name()));
    if let Ok(exe) = env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("bin").join(exe_name()));
            candidates.push(dir.join("resources").join("bin").join(exe_name()));
            // macOS .app：ChenADE.app/Contents/MacOS/ChenADE → Contents/Resources/bin/tmux
            if let Some(contents) = dir.parent() {
                candidates.push(contents.join("Resources").join("bin").join(exe_name()));
            }
        }
    }
    // 开发构建（target/debug/chenade）直接读仓库里的资源，避免每次先打包。
    #[cfg(debug_assertions)]
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("bin")
            .join(exe_name()),
    );

    candidates.into_iter().find(|path| path.is_file())
    }
}

fn exe_name() -> &'static str {
    if cfg!(windows) {
        "tmux.exe"
    } else {
        "tmux"
    }
}

fn read_version(binary: &Path) -> Option<String> {
    let output = Command::new(binary).arg("-V").output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        Some("tmux".to_string())
    } else {
        Some(text)
    }
}

fn write_config(config_dir: &Path) -> std::io::Result<PathBuf> {
    std::fs::create_dir_all(config_dir)?;
    let path = config_dir.join("tmux.conf");
    let content = format!("{CONFIG_HEADER}{CONFIG_BODY}");
    let needs_write = std::fs::read_to_string(&path)
        .map(|existing| existing != content)
        .unwrap_or(true);
    if needs_write {
        std::fs::write(&path, content)?;
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_name_is_stable_and_safe() {
        assert_eq!(Tmux::session_name("t-1750000000000-1"), "chenade-t-1750000000000-1");
        assert_eq!(Tmux::session_name("a/b:c d"), "chenade-a-b-c-d");
        assert_eq!(Tmux::session_name("..."), "chenade-");
    }

    #[test]
    fn session_name_is_bounded() {
        let long = "x".repeat(200);
        let name = Tmux::session_name(&long);
        assert_eq!(name, format!("{SESSION_PREFIX}{}", "x".repeat(48)));
    }

    #[test]
    fn config_is_written_and_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let path = write_config(dir.path()).unwrap();
        let first = std::fs::read_to_string(&path).unwrap();
        assert!(first.contains("default-terminal"));
        write_config(dir.path()).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), first);
    }

    #[test]
    fn attach_command_uses_private_socket_and_attach_flag() {
        let tmux = Tmux {
            binary: Some(PathBuf::from("/tmp/tmux")),
            config: Some(PathBuf::from("/tmp/tmux.conf")),
            version: None,
        };
        let (program, argv) = tmux
            .attach_command("chenade-t-1", "/tmp/work", "/bin/zsh", &["-l".to_string()])
            .unwrap();
        assert_eq!(program, PathBuf::from("/tmp/tmux"));
        assert!(argv.contains(&"-A".to_string()));
        assert!(argv.contains(&"chenade-t-1".to_string()));
        assert!(argv.contains(&"/tmp/work".to_string()));
        assert_eq!(argv.last().unwrap(), "-l");
    }
}
