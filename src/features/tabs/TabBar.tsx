import { IconButton } from '@/components/IconButton';
import {
  CommitIcon,
  DiffIcon,
  FileIcon,
  PlusIcon,
  TerminalIcon,
  XIcon,
} from '@/components/icons';
import { peekTerminalSession } from '@/features/terminals/session';
import { WorktreeActions } from '@/features/worktrees/WorktreeActions';
import { useSettingsStore } from '@/features/settings/store';
import { useUiStore } from '@/features/ui/store';
import { confirmAction } from '@/lib/confirm';
import type { Worktree } from '@/lib/types';
import { useTabsStore, type Tab } from './store';
import styles from './TabBar.module.css';

const ICONS = {
  terminal: TerminalIcon,
  file: FileIcon,
  diff: DiffIcon,
};

export function TabBar({ worktree }: { worktree: Worktree }) {
  const tabs = useTabsStore((state) => state.tabs);
  const activeId = useTabsStore((state) => state.activeId);
  const selectTab = useTabsStore((state) => state.selectTab);
  const addTerminal = useTabsStore((state) => state.addTerminal);
  const closeTab = useTabsStore((state) => state.closeTab);
  const confirmClose = useSettingsStore((state) => state.settings.confirmCloseTerminal);
  const changesOpen = useUiStore((state) => state.changesOpen);
  const toggleChanges = useUiStore((state) => state.toggleChanges);

  const handleClose = async (tab: Tab) => {
    if (tab.kind === 'terminal') {
      const session = peekTerminalSession(tab.id);
      if (confirmClose && session && (session.state === 'running' || session.state === 'starting')) {
        const confirmed = await confirmAction(
          `关闭“${tab.title}”会结束正在运行的进程，继续？`,
        );
        if (!confirmed) return;
      }
    }
    closeTab(tab.id);
  };

  return (
    <div className={styles.tabbar}>
      <div className={styles.tabsRow}>
        <button
          className={[styles.tab, activeId === null ? styles.active : '']
            .filter(Boolean)
            .join(' ')}
          onClick={() => selectTab(null)}
          title="工作树概览"
        >
          <CommitIcon size={12} />
          <span>概览</span>
        </button>

        {tabs.map((tab) => {
          const Icon = ICONS[tab.kind];
          const isActive = tab.id === activeId;
          return (
            <div
              key={tab.id}
              className={[styles.tabWrap, isActive ? styles.activeWrap : '']
                .filter(Boolean)
                .join(' ')}
            >
              <button
                className={styles.tab}
                onClick={() => selectTab(tab.id)}
                title={tab.kind === 'file' ? tab.path : tab.title}
              >
                <Icon size={12} />
                <span className={styles.title}>{tab.title}</span>
              </button>
              <button
                className={styles.close}
                aria-label={`关闭 ${tab.title}`}
                onClick={() => void handleClose(tab)}
              >
                <XIcon size={9} />
              </button>
            </div>
          );
        })}
      </div>

      <WorktreeActions worktree={worktree} />
      <IconButton
        label={changesOpen ? '隐藏工作区更改' : '显示工作区更改'}
        onClick={toggleChanges}
        active={changesOpen}
        className={styles.addButton}
      >
        <DiffIcon size={12} />
      </IconButton>
      <IconButton
        label="新建终端"
        onClick={() => addTerminal(worktree)}
        className={styles.addButton}
      >
        <PlusIcon size={12} />
      </IconButton>
    </div>
  );
}
