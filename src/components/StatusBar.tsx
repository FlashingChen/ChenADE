import { useAppStore } from '@/app/store';
import { useWorktreesStore } from '@/features/worktrees/store';
import { useTabsStore } from '@/features/tabs/store';
import { Kbd } from './Kbd';
import styles from './StatusBar.module.css';

export function StatusBar() {
  const info = useAppStore((state) => state.info);
  const projects = useAppStore((state) => state.projects);
  const loading = useAppStore((state) => state.loading);
  const worktrees = useWorktreesStore((state) => state.worktrees);
  const activeId = useWorktreesStore((state) => state.activeId);
  const tabs = useTabsStore((state) => state.tabs);
  const tabsWorktreeId = useTabsStore((state) => state.worktreeId);

  const active = worktrees.find((worktree) => worktree.id === activeId) ?? null;
  const visibleTabs = active && tabsWorktreeId === active.id ? tabs : [];
  const terminalCount = visibleTabs.filter((tab) => tab.kind === 'terminal').length;
  const totalWorktrees = projects.reduce(
    (sum, project) => sum + project.worktreeCount,
    0,
  );

  return (
    <footer className={styles.statusbar}>
      <div className={styles.left}>
        <span className={styles.dot} data-state={loading ? 'loading' : 'idle'} />
        <span>{loading ? '正在读取项目…' : active ? '工作树已就绪' : '终端就绪'}</span>
        <span className={styles.dim}>·</span>
        <span>{terminalCount} 个终端</span>
        <span className={styles.dim}>·</span>
        <span>
          {projects.length} 个仓库 · {totalWorktrees} 个工作树
        </span>
      </div>
      <div className={styles.right}>
        <span>{visibleTabs.length} 个标签页</span>
        <span>{active?.branch ?? '—'}</span>
        <span>UTF-8</span>
        <span className={styles.git}>{info?.gitVersion ?? 'git —'}</span>
        <span className={styles.kbdHint}>
          <Kbd>⌘K</Kbd>
        </span>
      </div>
    </footer>
  );
}
