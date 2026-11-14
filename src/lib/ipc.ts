import { invoke } from '@tauri-apps/api/core';
import type { AppErrorShape } from './types';
import { mockInvoke } from './mock';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export const isTauri =
  typeof window !== 'undefined' && typeof window.__TAURI_INTERNALS__ !== 'undefined';

export function toAppError(error: unknown): AppErrorShape {
  if (error && typeof error === 'object') {
    const candidate = error as Partial<AppErrorShape>;
    if (typeof candidate.code === 'string' && typeof candidate.message === 'string') {
      return {
        code: candidate.code,
        message: candidate.message,
        detail: candidate.detail,
        hint: candidate.hint,
      };
    }
    if (error instanceof Error) {
      return { code: 'UNKNOWN', message: error.message };
    }
  }

  if (typeof error === 'string') {
    return { code: 'UNKNOWN', message: error };
  }

  return { code: 'UNKNOWN', message: '发生未知错误' };
}

export async function call<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!isTauri) {
    return mockInvoke<T>(command, args);
  }

  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw toAppError(error);
  }
}
