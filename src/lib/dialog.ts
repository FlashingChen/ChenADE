import { open } from '@tauri-apps/plugin-dialog';
import { isTauri } from './ipc';

export async function pickRepoDirectory(): Promise<string | null> {
  if (!isTauri) {
    const value = window.prompt('仓库路径（浏览器预览模式）', '/Users/demo/Code/ChenADE');
    return value?.trim() ? value.trim() : null;
  }

  const selected = await open({
    directory: true,
    multiple: false,
    title: '选择 Git 仓库',
  });

  return typeof selected === 'string' ? selected : null;
}
