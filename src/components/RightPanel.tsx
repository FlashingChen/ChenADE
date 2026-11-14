import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/app/store';
import { useUiStore } from '@/features/ui/store';
import { FileTree } from '@/features/files/FileTree';
import { GitPanel } from '@/features/git/GitPanel';
import type { GitStatus, Worktree } from '@/lib/types';
import styles from './RightPanel.module.css';

interface RightPanelProps {
  worktree: Worktree;
  status: GitStatus | null;
}

export function RightPanel({ worktree, status }: RightPanelProps) {
  const navigate = useNavigate();
  const projects = useAppStore((state) => state.projects);
  const currentProjectId = useAppStore((state) => state.currentProjectId);
  const panel = useUiStore((state) => state.panel);
  const setPanel = useUiStore((state) => state.setPanel);

  const project = projects.find((item) => item.id === currentProjectId);
  const files = status?.files ?? [];

  return (
    <aside className={styles.panel}>
      <div className={styles.top}>
        <div className={styles.segmented} role="tablist" aria-label="右侧面板">
          <button
            role="tab"
            aria-selected={panel === 'files'}
            className={panel === 'files' ? styles.segmentActive : styles.segment}
            onClick={() => setPanel('files')}
          >
            文件
          </button>
          <button
            role="tab"
            aria-selected={panel === 'git'}
            className={panel === 'git' ? styles.segmentActive : styles.segment}
            onClick={() => setPanel('git')}
          >
            Git
          </button>
        </div>
      </div>

      <div className={styles.toolbar}>
        <span className={styles.toolbarPath}>
          {project?.name ?? '—'} / {worktree.branch ?? 'detached'}
        </span>
      </div>

      <div className={styles.body}>
        {panel === 'files' ? (
          <FileTree root={worktree.path} status={status} />
        ) : (
          <GitPanel worktree={worktree} status={status} />
        )}
      </div>

      <div className={styles.footer}>
        <span>{files.length > 0 ? `${files.length} 个文件有更改` : '没有待提交的更改'}</span>
        <button
          className={styles.footerLink}
          onClick={() => navigate(`/review/${worktree.id}`)}
        >
          在 Git 视图中打开
        </button>
      </div>
    </aside>
  );
}
