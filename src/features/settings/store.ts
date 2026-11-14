import { create } from 'zustand';
import { call, toAppError } from '@/lib/ipc';
import type { AppErrorShape, Settings } from '@/lib/types';

export const DEFAULT_SETTINGS: Settings = {
  terminalShell: null,
  terminalFontSize: 12,
  defaultEditor: null,
  theme: 'dark',
  confirmCloseTerminal: true,
  loadShellProfile: true,
};

const FONT_SIZE_MIN = 8;
const FONT_SIZE_MAX = 32;

function clampFontSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SETTINGS.terminalFontSize;
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(value)));
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * IPC 结果来自磁盘，可能是旧版本或损坏的数据；这里只做必要的兜底，
 * 避免非法值直接进入终端尺寸或主题选择。
 */
function normalizeSettings(raw: Settings | null | undefined): Settings {
  if (!raw) return { ...DEFAULT_SETTINGS };
  return {
    terminalShell: normalizeText(raw.terminalShell),
    terminalFontSize: clampFontSize(
      typeof raw.terminalFontSize === 'number'
        ? raw.terminalFontSize
        : DEFAULT_SETTINGS.terminalFontSize,
    ),
    defaultEditor: normalizeText(raw.defaultEditor),
    theme: raw.theme === 'light' ? 'light' : 'dark',
    confirmCloseTerminal:
      typeof raw.confirmCloseTerminal === 'boolean'
        ? raw.confirmCloseTerminal
        : DEFAULT_SETTINGS.confirmCloseTerminal,
    loadShellProfile:
      typeof raw.loadShellProfile === 'boolean'
        ? raw.loadShellProfile
        : DEFAULT_SETTINGS.loadShellProfile,
  };
}

interface SettingsState {
  settings: Settings;
  loaded: boolean;
  loading: boolean;
  saving: boolean;
  error: AppErrorShape | null;
  load: () => Promise<void>;
  save: (next: Settings) => Promise<boolean>;
  clearError: () => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: { ...DEFAULT_SETTINGS },
  loaded: false,
  loading: false,
  saving: false,
  error: null,

  load: async () => {
    if (get().loaded || get().loading) return;

    set({ loading: true, error: null });
    try {
      const settings = normalizeSettings(await call<Settings>('settings_get'));
      set({ settings, loaded: true, loading: false });
    } catch (cause) {
      set({
        settings: { ...DEFAULT_SETTINGS },
        loaded: true,
        loading: false,
        error: toAppError(cause),
      });
    }
  },

  save: async (next) => {
    if (get().saving) return false;

    const payload = normalizeSettings(next);
    set({ saving: true, error: null });
    try {
      const saved = normalizeSettings(
        await call<Settings>('settings_set', { settings: payload }),
      );
      set({ settings: saved, loaded: true, saving: false });
      return true;
    } catch (cause) {
      set({ saving: false, error: toAppError(cause) });
      return false;
    }
  },

  clearError: () => set({ error: null }),
}));
