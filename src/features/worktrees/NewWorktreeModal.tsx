import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '@/app/store';
import { Button } from '@/components/Button';
import { IconButton } from '@/components/IconButton';
import { XIcon } from '@/components/icons';
import { call, toAppError } from '@/lib/ipc';
import { shortPath } from '@/lib/format';
import type { Branch, Worktree } from '@/lib/types';
import { useTabsStore } from '@/features/tabs/store';
import { useUiStore } from '@/features/ui/store';
import { useWorktreesStore } from '@/features/worktrees/store';
import styles from './NewWorktreeModal.module.css';

export function NewWorktreeModal() {
  const open = useUiStore((state) => state.newWorktreeOpen);
  const close = useUiStore((state) => state.closeNewWorktree);
  const notify = useAppStore((state) => state.notify);
  const refreshProjects = useAppStore((state) => state.refreshProjects);
  const projects = useAppStore((state) => state.projects);
  const currentProjectId = useAppStore((state) => state.currentProjectId);

  const project = projects.find((item) => item.id === currentProjectId) ?? null;

  const [branch, setBranch] = useState('');
  const [base, setBase] = useState('main');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [copyEnvLocal, setCopyEnvLocal] = useState(true);
  const [openTerminal, setOpenTerminal] = useState(true);
  const [installDeps, setInstallDeps] = useState(false);
  const [startCommand, setStartCommand] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const branchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || !project) return;
    setBranch('');
    setBase(project.defaultBranch);
    setCopyEnvLocal(true);
    setOpenTerminal(true);
    setInstallDeps(false);
    setStartCommand('');
    setError(null);
    setSubmitting(false);
    setBranches([]);
    setLoadingBranches(true);

    let cancelled = false;
    call<Branch[]>('git_branches', { path: project.path })
      .then((list) => {
        if (!cancelled) setBranches(list);
      })
      .catch(() => {
        if (!cancelled) setBranches([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingBranches(false);
      });

    const frame = requestAnimationFrame(() => {
      branchRef.current?.focus();
      branchRef.current?.setSelectionRange(0, 0);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [open, project]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, submitting, close]);

  const slug = useMemo(() => {
    const tail = branch.trim().split('/').filter(Boolean).pop() ?? '';
    return tail.replace(/[^A-Za-z0-9_-]/g, '-');
  }, [branch]);

  const branchValid =
    branch.trim().length > 0 &&
    /^[A-Za-z0-9._/-]+$/.test(branch.trim()) &&
    !branch.trim().startsWith('/') &&
    !branch.trim().endsWith('/') &&
    !branch.includes('..') &&
    !branch.trim().endsWith('.lock');

  const noCommits = !!project && !loadingBranches && branches.length === 0;

  const baseOptions = branches.length
    ? branches
    : project
      ? [
          {
            name: project.defaultBranch,
            hash: '',
            updatedAt: null,
            isCurrent: false,
          },
        ]
      : [];

  const previewPath = project ? `${project.path}/.worktrees/${slug || '…'}` : '';
  const previewCommand = project
    ? `git worktree add .worktrees/${slug || '…'} -b ${branch.trim() || '…'} ${base || '…'}`
    : '';

  const initialCommand = useMemo(() => {
    const parts: string[] = [];
    if (installDeps) parts.push('pnpm install --prefer-offline');
    if (startCommand.trim()) parts.push(startCommand.trim());
    return parts.join(' && ');
  }, [installDeps, startCommand]);

  const submit = async () => {
    if (!project || !branchValid || !base || submitting || noCommits) return;

    setSubmitting(true);
    setError(null);
    try {
      const created = await call<Worktree>('worktree_create', {
        input: {
          projectId: project.id,
          branch: branch.trim(),
          base,
          path: null,
          copyEnvLocal,
        },
      });

      void call('activity_add', {
        projectId: project.id,
        worktreePath: created.path,
        kind: 'worktree',
        title: `新建工作树 ${created.branch ?? created.path}`,
        detail: base,
      }).catch(() => undefined);

      const worktrees = useWorktreesStore.getState();
      await worktrees.load(project.id);
      await worktrees.select(created.id);

      useTabsStore.getState().load(created);
      if (openTerminal) {
        useTabsStore.getState().addTerminal(created, {
          title: startCommand.trim() ? startCommand.trim().split(/\s+/)[0] : '终端',
          initialCommand: initialCommand || undefined,
        });
      }

      await refreshProjects();
      notify(`已创建工作树 ${created.branch ?? created.path}`, 'success');
      close();
    } catch (cause) {
      const appError = toAppError(cause);
      setError(
        appError.hint ? `${appError.message} · ${appError.hint}` : appError.message,
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (!open || !project) return null;

  return (
    <div
      className={styles.backdrop}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !submitting) close();
      }}
    >
      <div className={styles.panel} role="dialog" aria-modal="true" aria-label="新建 Worktree">
        <div className={styles.header}>
          <div>
            <h2>新建 Worktree</h2>
            <p>从 {project.name} 检出一个独立目录。分支、终端与文件面板都跟着工作树走，互不干扰。</p>
          </div>
          <IconButton label="关闭" onClick={close} disabled={submitting}>
            <XIcon size={14} />
          </IconButton>
        </div>

        <div className={styles.body}>
          <label className={styles.field}>
            <span className={styles.label}>仓库</span>
            <div className={styles.readonlyField}>
              <span className={styles.repoName}>{project.name}</span>
              <span className={styles.repoPath}>
                {shortPath(project.path)} · {project.defaultBranch} ·{' '}
                {project.worktreeCount} 个工作树
              </span>
            </div>
          </label>

          <label className={styles.field}>
            <span className={styles.label}>分支名</span>
            <div className={styles.inputWrap}>
              <input
                ref={branchRef}
                value={branch}
                onChange={(event) => setBranch(event.target.value)}
                placeholder="feat/session-replay"
                spellCheck={false}
                aria-invalid={!branchValid}
              />
              {branch.trim() ? (
                <span className={branchValid ? styles.valid : styles.invalid}>
                  {branchValid ? '可用' : '名称无效'}
                </span>
              ) : null}
            </div>
            <span className={styles.hint}>
              目录会按分支名生成：.worktrees/{slug || '…'}
            </span>
          </label>

          <div className={styles.row}>
            <label className={styles.field}>
              <span className={styles.label}>起点分支</span>
              <select value={base} onChange={(event) => setBase(event.target.value)}>
                {baseOptions.map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.name}
                    {item.isCurrent ? ' · 当前' : ''}
                  </option>
                ))}
              </select>
              <span className={styles.hint}>
                {branches.find((item) => item.name === base)?.hash
                  ? `${branches.find((item) => item.name === base)?.hash} · 本地分支`
                  : '与远端保持一致的起点'}
              </span>
            </label>

            <label className={styles.field}>
              <span className={styles.label}>工作树目录</span>
              <div className={styles.readonlyField}>
                <span className={styles.pathPreview}>{shortPath(previewPath)}</span>
              </div>
              <span className={styles.hint}>与主仓库共享 .git，不复制对象</span>
            </label>
          </div>

          <div className={styles.sectionLabel}>创建后</div>
          <div className={styles.options}>
            <label className={styles.checkRow}>
              <input
                type="checkbox"
                checked={copyEnvLocal}
                onChange={(event) => setCopyEnvLocal(event.target.checked)}
              />
              <span>
                复制 .env.local
                <small>本地端口与密钥不会进入 git</small>
              </span>
            </label>

            <label className={styles.checkRow}>
              <input
                type="checkbox"
                checked={installDeps}
                onChange={(event) => setInstallDeps(event.target.checked)}
              />
              <span>
                安装依赖并预热缓存
                <small>运行 pnpm install --prefer-offline</small>
              </span>
            </label>

            <label className={styles.checkRow}>
              <input
                type="checkbox"
                checked={openTerminal}
                onChange={(event) => setOpenTerminal(event.target.checked)}
              />
              <span>
                启动终端
                <small>在新工作树目录里打开一个 shell</small>
              </span>
            </label>
          </div>

          <label className={styles.field}>
            <span className={styles.label}>启动命令（可选）</span>
            <input
              value={startCommand}
              onChange={(event) => setStartCommand(event.target.value)}
              placeholder="claude"
              spellCheck={false}
            />
            <span className={styles.hint}>
              例如 claude、codex、pnpm dev；会在终端创建后自动执行
            </span>
          </label>

          {noCommits ? (
            <div className={styles.warning}>
              这个仓库还没有任何提交，git worktree 需要一个提交作为起点。
              先在终端完成首次提交：<code>git add . && git commit -m "init"</code>，然后重新打开这个窗口。
            </div>
          ) : null}

          <div className={styles.command}>
            <code>{previewCommand}</code>
          </div>

          {error ? <div className={styles.error}>{error}</div> : null}
        </div>

        <div className={styles.footer}>
          <span className={styles.footerHint}>创建后会自动切换到新工作树</span>
          <div className={styles.footerActions}>
            <Button variant="ghost" onClick={close} disabled={submitting}>
              取消
            </Button>
            <Button
              variant="primary"
              onClick={() => void submit()}
              disabled={!branchValid || !base || submitting || noCommits}
            >
              {submitting ? '创建中…' : '创建工作树'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
