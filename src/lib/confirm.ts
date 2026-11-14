import { confirm as tauriConfirm } from '@tauri-apps/plugin-dialog';
import { isTauri } from './ipc';

export async function confirmAction(
  message: string,
  title = 'ChenADE',
): Promise<boolean> {
  if (!isTauri) return window.confirm(message);

  try {
    return await tauriConfirm(message, {
      title,
      kind: 'warning',
      okLabel: '继续',
      cancelLabel: '取消',
    });
  } catch {
    return window.confirm(message);
  }
}
