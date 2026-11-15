import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/app/store';
import { IconButton } from '@/components/IconButton';
import { FolderOpenIcon, MoreIcon, RefreshIcon } from '@/components/icons';
import { confirmAction } from '@/lib/confirm';
import { call, toAppError } from '@/lib/ipc';
import { useTabsStore } from '@/features/tabs/store';
import { useWorktreesStore } from '@/features/worktrees/store';
import type { Worktree } from '@/lib/types';
import styles from './WorktreeActions.module.css';

export function WorktreeActions({ worktree }: { worktree: Worktree }) {
  const notify = useAppStore((state) => state.notify);
  const currentProjectId = useAppStore((state) => state.currentProjectId);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [menuOpen]);

  const reveal = async () => {
    try {
      await call('project_reveal', { path: worktree.path });
    } catch (error) {
      notify(toAppError(error).message, 'error');
    }
  };

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
    <div className={styles.actions} ref={menuRef}>
      <IconButton
        label="刷新工作树状态"
        onClick={() => void useWorktreesStore.getState().refreshStatus()}
      >
        <RefreshIcon size={13} />
      </IconButton>
      <IconButton label="在文件管理器中显示" onClick={() => void reveal()}>
        <FolderOpenIcon size={13} />
      </IconButton>
      <div className={styles.menuWrap}>
        <IconButton label="更多操作" onClick={() => setMenuOpen((value) => !value)}>
          <MoreIcon size={13} />
        </IconButton>
        {menuOpen ? (
          <div className={styles.menu} role="menu">
            <button className={styles.menuItem} onClick={() => { setMenuOpen(false); void reveal(); }}>
              在文件管理器中显示
            </button>
            <button className={styles.menuItem} onClick={() => { setMenuOpen(false); void copyPath(); }}>
              复制工作树路径
            </button>
            <button className={styles.menuItem} onClick={() => { setMenuOpen(false); void useWorktreesStore.getState().refreshStatus(); }}>
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
  );
}
