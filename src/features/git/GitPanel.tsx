import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/app/store';
import { Button } from '@/components/Button';
import { useWorktreesStore } from '@/features/worktrees/store';
import { call, toAppError } from '@/lib/ipc';
import { relativeTime } from '@/lib/format';
import type { Commit, GitIdentity, GitStatus, Worktree } from '@/lib/types';
import styles from './GitPanel.module.css';

export function GitPanel({ worktree, status }: { worktree: Worktree; status: GitStatus | null }) {
  const navigate = useNavigate();
  const notify = useAppStore((state) => state.notify);
  const refreshStatus = useWorktreesStore((state) => state.refreshStatus);

  const [commits, setCommits] = useState<Commit[]>([]);
  const [identity, setIdentity] = useState<GitIdentity | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'commit' | 'push' | 'both' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [log, who] = await Promise.all([
        call<Commit[]>('git_log', {
          path: worktree.path,
          limit: 12,
          skip: 0,
          all: false,
        }),
        call<GitIdentity | null>('git_identity', { path: worktree.path }),
      ]);
      setCommits(log);
      setIdentity(who);
    } catch (cause) {
      setError(toAppError(cause).message);
    } finally {
      setLoading(false);
    }
  }, [worktree.path]);

  useEffect(() => {
    void load();
  }, [load]);

  const files = status?.files ?? [];
  const canCommit = files.length > 0 && !!identity && message.trim().length > 0;

  const commit = async () => {
    if (!canCommit) return;
    setBusy('commit');
    setError(null);
    try {
      const result = await call<{ shortHash: string; subject: string }>('git_commit', {
        path: worktree.path,
        message,
        all: true,
      });
      setMessage('');
      void call('activity_add', {
        projectId: worktree.projectId,
        worktreePath: worktree.path,
        kind: 'commit',
        title: `提交 ${result.shortHash} · ${result.subject}`,
        detail: null,
      }).catch(() => undefined);
      notify(`已提交 ${result.shortHash} · ${result.subject}`, 'success');
      await refreshStatus();
      await load();
    } catch (cause) {
      setError(toAppError(cause).message);
    } finally {
      setBusy(null);
    }
  };

  const push = async () => {
    setBusy('push');
    setError(null);
    try {
      const result = await call<{ summary: string }>('git_push', {
        path: worktree.path,
      });
      void call('activity_add', {
        projectId: worktree.projectId,
        worktreePath: worktree.path,
        kind: 'push',
        title: `推送 ${worktree.branch ?? result.summary}`,
        detail: result.summary,
      }).catch(() => undefined);
      notify(result.summary, 'success');
      await refreshStatus();
    } catch (cause) {
      const appError = toAppError(cause);
      setError(appError.hint ? `${appError.message} · ${appError.hint}` : appError.message);
    } finally {
      setBusy(null);
    }
  };

  const commitAndPush = async () => {
    if (!canCommit) return;
    setBusy('both');
    setError(null);
    try {
      const result = await call<{ shortHash: string; subject: string }>('git_commit', {
        path: worktree.path,
        message,
        all: true,
      });
      setMessage('');
      notify(`已提交 ${result.shortHash}`, 'success');
      await refreshStatus();
      const pushed = await call<{ summary: string }>('git_push', {
        path: worktree.path,
      });
      void call('activity_add', {
        projectId: worktree.projectId,
        worktreePath: worktree.path,
        kind: 'push',
        title: `推送 ${worktree.branch ?? pushed.summary}`,
        detail: pushed.summary,
      }).catch(() => undefined);
      notify(pushed.summary, 'success');
      await refreshStatus();
      await load();
    } catch (cause) {
      const appError = toAppError(cause);
      setError(appError.hint ? `${appError.message} · ${appError.hint}` : appError.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={styles.panel}>
      <div className={styles.sync}>
        <span>{status?.upstream ?? '未设置上游'}</span>
        <span className={styles.syncStat}>
          领先 {status?.ahead ?? worktree.ahead} · 落后 {status?.behind ?? worktree.behind}
        </span>
      </div>

      <div className={styles.sectionLabel}>提交 · {commits.length}</div>
      <div className={styles.commits}>
        {loading ? <div className={styles.state}>读取提交…</div> : null}
        {!loading && commits.length === 0 ? (
          <div className={styles.state}>这个分支还没有提交</div>
        ) : null}
        {commits.map((commit) => (
          <button
            key={commit.hash}
            className={styles.commit}
            onClick={() => navigate(`/review/${worktree.id}`)}
            title={commit.subject}
          >
            <span className={styles.commitGraph} />
            <span className={styles.commitBody}>
              <span className={styles.commitSubject}>{commit.subject}</span>
              <span className={styles.commitMeta}>
                {commit.shortHash} · {commit.author} · {relativeTime(commit.date)}
              </span>
            </span>
            {commit.refs.length > 0 ? (
              <span className={styles.ref}>{commit.refs[0]}</span>
            ) : null}
          </button>
        ))}
      </div>

      <div className={styles.commitBox}>
        <div className={styles.commitBoxHead}>
          <span className={styles.sectionLabel}>
            工作区更改 · {files.length}
          </span>
          {files.length > 0 ? <span className={styles.changeDot} /> : null}
        </div>

        {!identity ? (
          <div className={styles.warning}>
            还没有配置 git 提交身份。运行
            <code>git config --global user.name / user.email</code>
          </div>
        ) : null}

        {error ? <div className={styles.error}>{error}</div> : null}

        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder={files.length > 0 ? '提交信息' : '工作区没有更改'}
          rows={2}
          disabled={files.length === 0 || busy !== null}
        />

        <div className={styles.actions}>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void commitAndPush()}
            disabled={!canCommit || busy !== null}
            className={styles.primaryAction}
          >
            {busy === 'both' ? '提交并推送中…' : '提交并推送'}
          </Button>
          <Button
            size="sm"
            onClick={() => void commit()}
            disabled={!canCommit || busy !== null}
          >
            {busy === 'commit' ? '提交中…' : '提交'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void push()}
            disabled={busy !== null}
          >
            {busy === 'push' ? '推送中…' : '推送'}
          </Button>
        </div>

        <button
          className={styles.reviewLink}
          onClick={() => navigate(`/review/${worktree.id}`)}
        >
          在 Git 复核中打开
        </button>
      </div>
    </div>
  );
}
