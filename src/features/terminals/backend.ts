import { call, isTauri } from '@/lib/ipc';
import type { TmuxStatus } from '@/lib/types';

/**
 * 终端后端状态：随包分发的 tmux 是否可用。
 *
 * 有 tmux 时，每个标签跑在一个可重连的会话里——应用退出只是 detach，
 * 重开应用后同一标签重连到原会话（详见 docs/10-fixes-2026-11-15.md 第 5 节）。
 */
let statusPromise: Promise<TmuxStatus | null> | null = null;
let cached: TmuxStatus | null = null;

export function ensureTerminalBackend(): Promise<TmuxStatus | null> {
  if (statusPromise) return statusPromise;

  if (!isTauri) {
    cached = {
      available: false,
      version: null,
      binary: null,
      socket: 'chenade',
      sessions: 0,
    };
    statusPromise = Promise.resolve(cached);
    return statusPromise;
  }

  statusPromise = call<TmuxStatus>('tmux_status')
    .then((status) => {
      cached = status;
      return status;
    })
    .catch(() => {
      cached = null;
      return null;
    });

  return statusPromise;
}

export function cachedTerminalBackend(): TmuxStatus | null {
  return cached;
}

/** 所有已持久化标签 id：启动时用它判断哪些 tmux 会话还有主。 */
export function persistedTerminalKeys(): string[] {
  const keys: string[] = [];
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key || !key.startsWith('chenade.tabs.')) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as { tabs?: Array<{ id?: unknown; kind?: unknown }> };
      for (const tab of parsed.tabs ?? []) {
        if (tab.kind === 'terminal' && typeof tab.id === 'string') keys.push(tab.id);
      }
    }
  } catch {
    // 存储损坏时宁可不清理，也不要误杀正在跑的会话。
  }
  return keys;
}

export async function pruneOrphanTerminalSessions(): Promise<void> {
  if (!isTauri) return;
  const status = await ensureTerminalBackend();
  if (!status?.available) return;
  try {
    await call('tmux_prune_sessions', { keep: persistedTerminalKeys() });
  } catch {
    // 清理失败不影响使用。
  }
}
