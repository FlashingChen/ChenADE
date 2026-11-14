import { useEffect, useState } from 'react';
import { Button } from '@/components/Button';
import { IconButton } from '@/components/IconButton';
import { RefreshIcon } from '@/components/icons';
import { call, toAppError } from '@/lib/ipc';
import type { DiffFile, Worktree } from '@/lib/types';
import { DiffView } from './DiffView';
import styles from './WorktreeDiff.module.css';

export function WorktreeDiff({
  worktree,
  onOpenReview,
}: {
  worktree: Worktree;
  onOpenReview: () => void;
}) {
  const [files, setFiles] = useState<DiffFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const diff = await call<DiffFile[]>('git_diff_worktree', {
        path: worktree.path,
      });
      setFiles(diff);
    } catch (cause) {
      setError(toAppError(cause).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [worktree.path]);

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <span className={styles.title}>工作区更改</span>
        <span className={styles.summary}>
          {worktree.base ?? 'main'} ← {worktree.branch ?? 'detached'}
        </span>
        <span className={styles.spacer} />
        <IconButton label="刷新差异" onClick={() => void load()}>
          <RefreshIcon size={13} />
        </IconButton>
        <Button size="sm" variant="ghost" onClick={onOpenReview}>
          在 Git 复核中打开
        </Button>
      </div>
      <div className={styles.body}>
        <DiffView
          files={files}
          loading={loading}
          error={error}
          emptyText="工作区干净，没有未提交的改动。"
        />
      </div>
    </div>
  );
}
