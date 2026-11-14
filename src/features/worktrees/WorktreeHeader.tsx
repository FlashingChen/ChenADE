import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/app/store';
import { IconButton } from '@/components/IconButton';
import { Pill } from '@/components/Pill';
import {
  BranchIcon,
  FolderOpenIcon,
  MoreIcon,
  RefreshIcon,
} from '@/components/icons';
import { shortPath, relativeTime } from '@/lib/format';
import { call, toAppError } from '@/lib/ipc';
import { useTabsStore } from '@/features/tabs/store';
import { useWorktreesStore } from '@/features/worktrees/store';
import { confirmAction } from '@/lib/confirm';
import type { GitStatus, Worktree } from '@/lib/types';
import styles from './WorktreeHeader.module.css';

interface WorktreeHeaderProps {
  worktree: Worktree;
  status: GitStatus | null;
  statusLoading: boolean;
  onRefresh: () => void;
  onReveal: () => void;
}

export function WorktreeHeader({
  worktree,
  status,
  statusLoading,
  onRefresh,
  onReveal,
}: WorktreeHeaderProps) {
  const notify = useAppStore((state) => state.notify);
  const currentProjectId = useAppStore((state) => state.currentProjectId);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const dirty = status?.files.length ?? worktree.dirty;
  const ahead = status?.ahead ?? worktree.ahead;
  const behind = status?.behind ?? worktree.behind;

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [menuOpen]);

  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(worktree.path);
      notify('已复制工作树路径', 'success');
    } catch {
      notify('复制路径失败', 'error');
    }
  };

  const removeWorktree = async () => {
    if (!currentProjectId || worktree.isMain) return;
    if (!(await confirmAction(`删除工作树「${worktree.branch ?? worktree.path}」？`))) return;

    try {
      await call('worktree_remove', {
        projectId: currentProjectId,
        path: worktree.path,
        force: false,
      });
    } catch (error) {
      const appError = toAppError(error);
      const force = await confirmAction(`${appError.message}。是否强制删除？`);
      if (!force) return;
      try {
        await call('worktree_remove', {
          projectId: currentProjectId,
          path: worktree.path,
          force: true,
        });
      } catch (forceError) {
        notify(toAppError(forceError).message, 'error');
        return;
      }
    }

    useTabsStore.getState().closeAll();
    await useWorktreesStore.getState().load(currentProjectId);
    notify('工作树已删除', 'success');
  };

  return (
    <header className={styles.header}>
      <div className={styles.main}>
        <div className={styles.titleRow}>
          <BranchIcon size={15} className={styles.branchIcon} />
          <h1 className={styles.branch} title={worktree.branch ?? 'detached HEAD'}>
            {worktree.branch ?? 'detached HEAD'}
          </h1>
          {dirty > 0 ? (
            <Pill tone="amber">{dirty} 个更改</Pill>
          ) : (
            <Pill tone="dim">干净</Pill>
          )}
          {ahead > 0 ? <span className={styles.ahead}>领先 {ahead}</span> : null}
          {behind > 0 ? <span className={styles.ahead}>落后 {behind}</span> : null}
          {statusLoading ? <span className={styles.loadingDot} title="正在刷新" /> : null}
        </div>
        <div className={styles.sub}>
          <span className={styles.path} title={worktree.path}>
            {shortPath(worktree.path)}
          </span>
          <span className={styles.dot}>·</span>
          <span>{worktree.isMain ? '主仓库' : `从 ${worktree.base ?? 'main'} 分出`}</span>
          <span className={styles.dot}>·</span>
          <span>{relativeTime(worktree.createdAt)}</span>
        </div>
      </div>

      <div className={styles.actions}>
        <IconButton label="刷新工作树状态" onClick={onRefresh}>
          <RefreshIcon size={14} />
        </IconButton>
        <IconButton label="在文件管理器中显示" onClick={onReveal}>
          <FolderOpenIcon size={14} />
        </IconButton>
        <div className={styles.menuWrap} ref={menuRef}>
          <IconButton label="更多操作" onClick={() => setMenuOpen((value) => !value)}>
            <MoreIcon size={14} />
          </IconButton>
          {menuOpen ? (
            <div className={styles.menu} role="menu">
              <button className={styles.menuItem} onClick={() => { setMenuOpen(false); onReveal(); }}>
                在文件管理器中显示
              </button>
              <button className={styles.menuItem} onClick={() => { setMenuOpen(false); void copyPath(); }}>
                复制工作树路径
              </button>
              <button className={styles.menuItem} onClick={() => { setMenuOpen(false); onRefresh(); }}>
                刷新状态
              </button>
              <button
                className={styles.menuDanger}
                onClick={() => { setMenuOpen(false); void removeWorktree(); }}
                disabled={worktree.isMain}
              >
                删除工作树
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
