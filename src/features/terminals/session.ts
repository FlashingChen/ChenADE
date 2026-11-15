import { Channel } from '@tauri-apps/api/core';
import { call, isTauri, toAppError } from '@/lib/ipc';
import type { PtyEvent, PtySpawnResult } from '@/lib/types';
import { useSettingsStore } from '@/features/settings/store';

export type TerminalState = 'idle' | 'starting' | 'running' | 'exited' | 'error';

const MAX_CHUNKS = 300;
const sessions = new Map<string, TerminalSession>();

function decodeBase64(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export class TerminalSession {
  readonly tabId: string;
  readonly cwd: string;
  private readonly initialCommand: string | null;
  state: TerminalState = 'idle';
  sessionId: string | null = null;
  shell = '';
  error: string | null = null;
  exitCode: number | null = null;
  cols = 80;
  rows = 24;
  /** 后端是 tmux 时会话可跨应用重启存活；关标签要显式 kill-session。 */
  persistent = false;
  backend: 'tmux' | 'shell' = 'shell';

  private chunks: Uint8Array[] = [];
  private channel: Channel<PtyEvent> | null = null;
  private dataListeners = new Set<(chunk: Uint8Array) => void>();
  private stateListeners = new Set<() => void>();

  constructor(tabId: string, cwd: string, initialCommand?: string) {
    this.tabId = tabId;
    this.cwd = cwd;
    this.initialCommand = initialCommand?.trim() || null;
  }

  get hasChannel(): boolean {
    return this.channel !== null;
  }

  getBuffer(): Uint8Array[] {
    return this.chunks;
  }

  onData(listener: (chunk: Uint8Array) => void): () => void {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  onState(listener: () => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  async start(): Promise<void> {
    if (this.state === 'starting' || this.state === 'running') return;

    this.state = 'starting';
    this.error = null;
    this.exitCode = null;
    this.emitState();

    if (!isTauri) {
      this.state = 'running';
      this.shell = 'preview';
      this.pushText(
        '\x1b[38;2;181;230;85mChenADE 浏览器预览\x1b[0m\r\n' +
          '真实终端会在 Tauri 桌面应用中启动。\r\n\r\n' +
          '\x1b[38;2;210;210;215m❯\x1b[0m ',
      );
      this.emitState();
      return;
    }

    const channel = new Channel<PtyEvent>();
    this.channel = channel;
    channel.onmessage = (event) => {
      if (this.channel === channel) this.handleEvent(event);
    };

    try {
      const config = useSettingsStore.getState().settings;
      const result = await call<PtySpawnResult>('pty_spawn', {
        input: {
          cwd: this.cwd,
          shell: config.terminalShell ?? undefined,
          loadProfile: config.loadShellProfile,
          cols: this.cols,
          rows: this.rows,
          // 标签 id 就是 tmux 会话键：重启后同一个标签能确定性重连。
          persist: this.tabId,
        },
        onEvent: channel,
      });

      if (this.channel !== channel) {
        void call('pty_kill', { sessionId: result.sessionId }).catch(() => undefined);
        return;
      }

      this.sessionId = result.sessionId;
      this.shell = result.shell;
      this.persistent = result.persistent;
      this.backend = result.backend;
      this.state = 'running';
      this.emitState();

      // The pane may have been fitted while spawn was in flight. Apply the
      // latest grid size so full-screen TUIs paint into the whole pane.
      if (this.cols > 0 && this.rows > 0) {
        void call('pty_resize', {
          sessionId: result.sessionId,
          cols: this.cols,
          rows: this.rows,
        }).catch(() => undefined);
      }

      // 重连已有 tmux 会话时不要再补发命令，否则会往正在跑的任务里灌输入。
      const shouldRunInitial = this.initialCommand && (!result.persistent || result.created);
      if (shouldRunInitial && this.initialCommand) {
        const command = this.initialCommand;
        setTimeout(() => {
          if (this.sessionId) this.write(`${command}\r`);
        }, 120);
      }
    } catch (error) {
      const appError = toAppError(error);
      this.state = 'error';
      this.error = appError.hint
        ? `${appError.message} · ${appError.hint}`
        : appError.message;
      this.emitState();
    }
  }

  write(data: string): void {
    if (this.sessionId) {
      void call('pty_write', { sessionId: this.sessionId, data }).catch((error) => {
        this.error = toAppError(error).message;
        this.state = 'error';
        this.emitState();
      });
      return;
    }

    if (!isTauri && this.state === 'running') {
      this.pushText(data.replace(/\r/g, '\r\n'));
    }
  }

  resize(cols: number, rows: number): void {
    if (cols < 2 || rows < 2) return;
    if (cols === this.cols && rows === this.rows) return;
    this.cols = cols;
    this.rows = rows;
    if (this.sessionId) {
      void call('pty_resize', { sessionId: this.sessionId, cols, rows }).catch(
        () => undefined,
      );
    }
  }

  /**
   * 起进程之前把「已经布局好的」行列写进 session。
   * 不这么做的话 pty_spawn 会用默认的 80×24，全屏 TUI 会先按 80 列排一帧并 flush
   * 进 scrollback，之后 resize 也不会重画那部分（见 docs/09-terminal-artifacts.md 3.3）。
   */
  prepareSize(cols: number, rows: number): void {
    if (cols < 2 || rows < 2) return;
    this.cols = cols;
    this.rows = rows;
  }

  kill(): void {
    if (this.sessionId) {
      void call('pty_kill', { sessionId: this.sessionId }).catch(() => undefined);
      this.sessionId = null;
    }
    this.channel = null;
    if (this.state === 'running' || this.state === 'starting') {
      this.state = 'exited';
      this.emitState();
    }
  }

  dispose(): void {
    this.kill();
    if (this.persistent) {
      // 关标签 = 结束这个 tmux 会话；应用退出走的是 kill_all（只 detach）。
      void call('tmux_kill_session', { key: this.tabId }).catch(() => undefined);
    }
    this.channel = null;
    this.dataListeners.clear();
    this.stateListeners.clear();
    sessions.delete(this.tabId);
  }

  private handleEvent(event: PtyEvent): void {
    if (event.type === 'data') {
      const chunk = decodeBase64(event.data);
      this.chunks.push(chunk);
      if (this.chunks.length > MAX_CHUNKS) {
        this.chunks.splice(0, this.chunks.length - MAX_CHUNKS);
      }
      for (const listener of this.dataListeners) listener(chunk);
      return;
    }

    if (event.type === 'exit') {
      this.state = 'exited';
      this.exitCode = event.code;
      this.sessionId = null;
      this.emitState();
      return;
    }

    this.state = 'error';
    this.error = event.message;
    this.emitState();
  }

  private pushText(text: string): void {
    const bytes = new TextEncoder().encode(text);
    this.chunks.push(bytes);
    for (const listener of this.dataListeners) listener(bytes);
  }

  private emitState(): void {
    for (const listener of this.stateListeners) listener();
  }
}

export function getTerminalSession(
  tabId: string,
  cwd: string,
  initialCommand?: string,
): TerminalSession {
  const existing = sessions.get(tabId);
  if (existing) return existing;
  const session = new TerminalSession(tabId, cwd, initialCommand);
  sessions.set(tabId, session);
  return session;
}

export function disposeTerminalSession(tabId: string): void {
  const session = sessions.get(tabId);
  if (!session) return;
  session.dispose();
}

export function peekTerminalSession(tabId: string): TerminalSession | undefined {
  return sessions.get(tabId);
}
