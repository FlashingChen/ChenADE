import { create } from 'zustand';

/**
 * 应用内确认框。
 *
 * 以前走 `@tauri-apps/plugin-dialog` 的原生 confirm：在 WKWebView 里一旦原生对话框
 * 调用失败，fallback 是 `window.confirm`——Tauri 的 webview 不实现它，直接返回 false，
 * 表现为“点了移除项目/删除工作树毫无反应”（docs/11）。改成本地弹窗后行为完全可控，
 * 也能被 Playwright 覆盖。
 */

export interface ConfirmDialogOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 危险操作：确认按钮用珊瑚色。 */
  danger?: boolean;
}

export interface ConfirmOptions extends ConfirmDialogOptions {
  message: string;
}

interface ConfirmRequest extends Required<ConfirmOptions> {
  id: number;
  resolve: (value: boolean) => void;
}

interface ConfirmState {
  request: ConfirmRequest | null;
  open: (options: ConfirmOptions) => Promise<boolean>;
  settle: (value: boolean) => void;
}

let sequence = 0;

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  request: null,

  open: (options) => {
    // 前一个没答完的确认按“取消”收尾，避免 promise 悬空。
    get().request?.resolve(false);

    return new Promise<boolean>((resolve) => {
      set({
        request: {
          id: (sequence += 1),
          title: options.title ?? 'ChenADE',
          message: options.message,
          confirmLabel: options.confirmLabel ?? '继续',
          cancelLabel: options.cancelLabel ?? '取消',
          danger: options.danger ?? true,
          resolve,
        },
      });
    });
  },

  settle: (value) => {
    const request = get().request;
    if (!request) return;
    set({ request: null });
    request.resolve(value);
  },
}));

export function confirmAction(
  message: string,
  options?: ConfirmDialogOptions,
): Promise<boolean> {
  return useConfirmStore.getState().open({ ...options, message });
}
