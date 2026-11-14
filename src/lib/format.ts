export function shortPath(path: string): string {
  const unix = path.replace(/^\/(?:Users|home)\/[^/]+/, '~');
  const windows = path.replace(/^[A-Za-z]:\\Users\\[^\\]+/, '~');
  return windows.length < unix.length ? windows : unix;
}

export function shortHash(hash: string | null | undefined): string {
  if (!hash) return '';
  return hash.slice(0, 7);
}

export function relativeTime(input: string | null | undefined): string {
  if (!input) return '—';
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return '—';

  const diff = Date.now() - date.getTime();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;

  return date.toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
  });
}

export type FileStatusCode = 'M' | 'A' | 'D' | 'U' | 'R' | '?';

export function fileStatusCode(index: string, worktree: string): FileStatusCode {
  const value = `${index}${worktree}`.replace(/ /g, '');
  if (!value) return 'M';
  if (value.includes('?')) return '?';
  if (value.includes('U')) return 'U';
  if (value.includes('R')) return 'R';
  if (value.includes('A')) return 'A';
  if (value.includes('D')) return 'D';
  return 'M';
}

export function fileStatusColor(code: FileStatusCode): string {
  switch (code) {
    case 'M':
      return 'var(--amber)';
    case 'A':
      return 'var(--lime)';
    case 'D':
      return 'var(--coral)';
    case 'R':
      return 'var(--teal)';
    case 'U':
    case '?':
    default:
      return 'var(--text-4)';
  }
}

export function countLabel(count: number, suffix: string): string {
  return `${count}${suffix}`;
}
