import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAppStore } from './store';
import { useWorktreesStore } from '@/features/worktrees/store';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { IconButton } from '@/components/IconButton';
import { ArrowIcon, DiffIcon, RefreshIcon } from '@/components/icons';
import { DiffView } from '@/features/git/DiffView';
import { call, toAppError } from '@/lib/ipc';
import { relativeTime, shortHash, shortPath } from '@/lib/format';
import type { Commit, DiffFile } from '@/lib/types';
import styles from './GitReview.module.css';

export function GitReviewPage() {
  const { worktreeId } = useParams();
  const navigate = useNavigate();
  const worktrees = useWorktreesStore((state) => state.worktrees);
  const status = useWorktreesStore((state) => state.status);
  const projects = useAppStore((state) => state.projects);
  const currentProjectId = useAppStore((state) => state.currentProjectId);
  const notify = useAppStore((state) => state.notify);

  const worktree = worktrees.find((item) => item.id === worktreeId);
  const project = projects.find((item) => item.id === currentProjectId);

  const [commits, setCommits] = useState<Commit[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [files, setFiles] = useState<DiffFile[]>([]);
  const [loadingLog, setLoadingLog] = useState(false);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedCommit = useMemo(
    () => commits.find((commit) => commit.hash === selected) ?? null,
    [commits, selected],
  );

  const loadLog = async () => {
    if (!worktree) return;
    setLoadingLog(true);
    setError(null);
    try {
      const log = await call<Commit[]>('git_log', {
        path: worktree.path,
        limit: 80,
        skip: 0,
        all: true,
      });
      setCommits(log);
      setSelected((current) => {
        if (current && log.some((commit) => commit.hash === current)) return current;
        return log[0]?.hash ?? null;
      });
    } catch (cause) {
      setError(toAppError(cause).message);
    } finally {
      setLoadingLog(false);
    }
  };

  useEffect(() => {
    void loadLog();
  }, [worktree?.id]);

  useEffect(() => {
    if (!worktree || !selected) {
      setFiles([]);
      return;
    }
    let cancelled = false;
    setLoadingDiff(true);
    setError(null);
    call<DiffFile[]>('git_diff_commit', { path: worktree.path, hash: selected })
      .then((diff) => {
        if (!cancelled) setFiles(diff);
      })
      .catch((cause) => {
        if (!cancelled) setError(toAppError(cause).message);
      })
      .finally(() => {
        if (!cancelled) setLoadingDiff(false);
      });

    return () => {
      cancelled = true;
    };
  }, [worktree?.path, selected]);

  const createMergeRequest = async () => {
    if (!worktree || !project) return;
    const base = project.defaultBranch;
    const head = worktree.branch ?? base;
    try {
      const url = await call<string | null>('git_compare_url', {
        path: worktree.path,
        base,
        head,
      });
      if (!url) {
        notify('未配置远端，或暂不支持该托管平台', 'info');
        return;
      }
      await call('open_external_url', { url });
    } catch (cause) {
      notify(toAppError(cause).message, 'error');
    }
  };

  if (!worktree) {
    return (
      <div className={styles.page}>
        <EmptyState
          icon={<DiffIcon size={18} />}
          title="找不到这个工作树"
          description="回到工作区重新选择工作树后再试。"
          actions={<Button onClick={() => navigate('/')}>返回工作区</Button>}
        />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.headerMain}>
          <DiffIcon size={14} className={styles.headerIcon} />
          <div>
            <h1>Git 复核</h1>
            <p>
              {worktree.branch ?? 'detached HEAD'} · {shortPath(worktree.path)}
            </p>
          </div>
        </div>
        <div className={styles.headerActions}>
          <span className={styles.syncDot} />
          <span className={styles.syncText}>
            {status?.upstream ?? '未设置上游'} · 领先 {status?.ahead ?? worktree.ahead}
          </span>
          <IconButton label="刷新提交" onClick={() => void loadLog()}>
            <RefreshIcon size={14} />
          </IconButton>
          <Button
            size="sm"
            variant="ghost"
            icon={<ArrowIcon size={12} />}
            onClick={() => navigate('/')}
          >
            返回工作区
          </Button>
        </div>
      </div>

      {error ? <div className={styles.error}>{error}</div> : null}

      <div className={styles.grid}>
        <aside className={styles.commitList}>
          <div className={styles.commitListHead}>
            <span>提交</span>
            <span className={styles.count}>{commits.length}</span>
            {loadingLog ? <span className={styles.loading}>读取中…</span> : null}
          </div>
          <div className={styles.commitScroll}>
            {commits.map((commit, index) => (
              <button
                key={commit.hash}
                className={[
                  styles.commitRow,
                  commit.hash === selected ? styles.commitSelected : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => setSelected(commit.hash)}
              >
                <span className={styles.graph}>
                  <span
                    className={styles.graphLine}
                    style={{ top: index === 0 ? '50%' : 0 }}
                  />
                  <span className={styles.graphDot} />
                </span>
                <span className={styles.commitText}>
                  <span className={styles.commitSubject}>{commit.subject}</span>
                  <span className={styles.commitMeta}>
                    {commit.shortHash} · {commit.author} · {relativeTime(commit.date)}
                  </span>
                  {commit.refs.length > 0 ? (
                    <span className={styles.refs}>
                      {commit.refs.map((ref) => (
                        <span key={ref} className={styles.ref}>
                          {ref}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </span>
              </button>
            ))}
          </div>
        </aside>

        <main className={styles.diffPane}>
          <div className={styles.diffHead}>
            <span className={styles.diffSubject}>
              {selectedCommit?.subject ?? '选择一个提交'}
            </span>
            {selectedCommit ? (
              <span className={styles.diffMeta}>
                {shortHash(selectedCommit.hash)} · {selectedCommit.author} ·{' '}
                {files.length} 个文件
              </span>
            ) : null}
          </div>
          <div className={styles.diffBody}>
            <DiffView
              files={files}
              loading={loadingDiff}
              error={error}
              emptyText={selectedCommit ? '这个提交没有文件差异。' : '从左侧选择一个提交。'}
            />
          </div>
        </main>

        <aside className={styles.detail}>
          <div className={styles.detailLabel}>提交详情</div>
          {selectedCommit ? (
            <>
              <div className={styles.detailTitle}>{selectedCommit.subject}</div>
              <div className={styles.detailMeta}>
                {selectedCommit.author} · {relativeTime(selectedCommit.date)}
              </div>
              <div className={styles.detailRows}>
                <span>提交</span>
                <code>{shortHash(selectedCommit.hash)}</code>
                <span>父提交</span>
                <code>{selectedCommit.parents.map(shortHash).join(', ') || '—'}</code>
                <span>来源分支</span>
                <code>{worktree.branch ?? 'detached'}</code>
                <span>目标分支</span>
                <code>{project?.defaultBranch ?? 'main'}</code>
                <span>变更</span>
                <code>{files.length} 个文件</code>
              </div>
              <Button
                variant="primary"
                size="sm"
                className={styles.mergeButton}
                onClick={() => void createMergeRequest()}
              >
                创建合并请求
              </Button>
              <button className={styles.backLink} onClick={() => navigate('/')}>
                回到工作区
              </button>
            </>
          ) : (
            <div className={styles.detailEmpty}>选择一个提交查看详情。</div>
          )}
        </aside>
      </div>
    </div>
  );
}
