import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { IconButton } from '@/components/IconButton';
import { Pill } from '@/components/Pill';
import {
  ArrowIcon,
  BranchIcon,
  CommitIcon,
  DiffIcon,
  FileIcon,
  FolderIcon,
  RefreshIcon,
  SendIcon,
  TerminalIcon,
} from '@/components/icons';
import { useAppStore } from './store';
import { useWorktreesStore } from '@/features/worktrees/store';
import { call, toAppError } from '@/lib/ipc';
import { relativeTime, shortHash, shortPath } from '@/lib/format';
import type { Activity, Branch, Provider, Worktree } from '@/lib/types';
import styles from './ProjectHome.module.css';

const ACTIVITY_LIMIT = 20;

function providerLabel(provider: Provider): string {
  switch (provider) {
    case 'github':
      return 'GitHub';
    case 'gitlab':
      return 'GitLab';
    case 'other':
      return '自建远端';
    default:
      return '本地仓库';
  }
}

function isRemoteRef(name: string): boolean {
  return (
    name.startsWith('origin/') ||
    name.startsWith('upstream/') ||
    name.startsWith('remotes/')
  );
}

function activityIcon(kind: string) {
  const key = kind.toLowerCase();
  if (key.includes('commit')) return <CommitIcon size={12} />;
  if (key.includes('push') || key.includes('pull') || key.includes('sync')) {
    return <SendIcon size={12} />;
  }
  if (key.includes('worktree') || key.includes('branch') || key.includes('checkout')) {
    return <BranchIcon size={12} />;
  }
  if (key.includes('file') || key.includes('diff')) return <FileIcon size={12} />;
  if (key.includes('terminal') || key.includes('pty')) return <TerminalIcon size={12} />;
  return <RefreshIcon size={12} />;
}

function activityToneClass(kind: string): string {
  const key = kind.toLowerCase();
  if (key.includes('error') || key.includes('fail')) return styles.toneCoral;
  if (key.includes('commit')) return styles.toneLime;
  if (key.includes('push') || key.includes('pull') || key.includes('sync')) {
    return styles.toneTeal;
  }
  if (key.includes('worktree') || key.includes('branch') || key.includes('checkout')) {
    return styles.toneAmber;
  }
  return styles.toneDim;
}

function branchRank(branch: Branch, defaultBranch: string): number {
  if (branch.isCurrent) return 0;
  if (branch.name === defaultBranch) return 1;
  return 2;
}

export function ProjectHomePage() {
  const { projectId } = useParams();
  const navigate = useNavigate();

  const projects = useAppStore((state) => state.projects);
  const currentProjectId = useAppStore((state) => state.currentProjectId);
  const notify = useAppStore((state) => state.notify);

  const storeProjectId = useWorktreesStore((state) => state.projectId);
  const storeWorktrees = useWorktreesStore((state) => state.worktrees);
  const storeActiveId = useWorktreesStore((state) => state.activeId);
  const worktreesLoading = useWorktreesStore((state) => state.loading);
  const worktreesError = useWorktreesStore((state) => state.error);

  const project = useMemo(
    () => projects.find((item) => item.id === projectId) ?? null,
    [projects, projectId],
  );

  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branchesError, setBranchesError] = useState<string | null>(null);

  const [activities, setActivities] = useState<Activity[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);

  const loadBranches = useCallback(async (path: string) => {
    setBranchesLoading(true);
    setBranchesError(null);
    try {
      const list = await call<Branch[]>('git_branches', { path });
      setBranches(list);
    } catch (cause) {
      setBranches([]);
      setBranchesError(toAppError(cause).message);
    } finally {
      setBranchesLoading(false);
    }
  }, []);

  const loadActivity = useCallback(async (id: string) => {
    setActivityLoading(true);
    setActivityError(null);
    try {
      const list = await call<Activity[]>('activity_list', {
        projectId: id,
        limit: ACTIVITY_LIMIT,
      });
      setActivities(list);
    } catch (cause) {
      setActivities([]);
      setActivityError(toAppError(cause).message);
    } finally {
      setActivityLoading(false);
    }
  }, []);

  const projectKey = project?.id ?? null;
  const projectPath = project?.path ?? null;

  useEffect(() => {
    if (!projectKey || !projectPath) return;

    void (async () => {
      if (useAppStore.getState().currentProjectId !== projectKey) {
        await useAppStore.getState().selectProject(projectKey);
      }
      const worktreeStore = useWorktreesStore.getState();
      if (worktreeStore.projectId !== projectKey || worktreeStore.worktrees.length === 0) {
        await worktreeStore.load(projectKey);
      }
    })();

    void loadBranches(projectPath);
    void loadActivity(projectKey);
  }, [projectKey, projectPath, loadBranches, loadActivity]);

  const handleRefresh = () => {
    if (!project) return;
    void loadBranches(project.path);
    void loadActivity(project.id);
    void useWorktreesStore.getState().load(project.id);
  };

  const handleReveal = async () => {
    if (!project) return;
    try {
      await call('project_reveal', { path: project.path });
    } catch (cause) {
      notify(toAppError(cause).message, 'error');
    }
  };

  const handleOpenWorktree = async (worktree: Worktree) => {
    await useWorktreesStore.getState().select(worktree.id);
    navigate('/');
  };

  if (!project) {
    return (
      <div className={styles.page}>
        <EmptyState
          icon={<FolderIcon size={18} />}
          title="找不到这个项目"
          description="它可能已被移除，或路径暂时不可访问。"
          actions={<Button onClick={() => navigate('/')}>返回工作区</Button>}
        />
      </div>
    );
  }

  const isCurrent = project.id === currentProjectId;
  const hasStoreWorktrees = storeProjectId === project.id;
  const projectWorktrees = hasStoreWorktrees
    ? storeWorktrees.filter((worktree) => worktree.projectId === project.id)
    : [];
  const worktreeCount = hasStoreWorktrees ? projectWorktrees.length : project.worktreeCount;
  const activeWorktree =
    projectWorktrees.find((worktree) => worktree.id === storeActiveId) ?? null;
  const sortedBranches = [...branches].sort((left, right) => {
    const rank = branchRank(left, project.defaultBranch) - branchRank(right, project.defaultBranch);
    if (rank !== 0) return rank;
    return left.name.localeCompare(right.name);
  });

  const loadingWorktrees = worktreesLoading || !hasStoreWorktrees;
  const refreshing =
    worktreesLoading || branchesLoading || activityLoading;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerMain}>
          <span className={styles.headerIcon}>
            <FolderIcon size={16} />
          </span>
          <div className={styles.headerText}>
            <h1>
              {project.name}
              {isCurrent ? <Pill tone="lime">当前项目</Pill> : <Pill tone="dim">未激活</Pill>}
            </h1>
            <p className={styles.path} title={project.path}>
              {shortPath(project.path)}
            </p>
          </div>
        </div>
        <div className={styles.headerActions}>
          <IconButton
            label="刷新概览"
            onClick={handleRefresh}
            disabled={refreshing}
            className={refreshing ? styles.spinning : undefined}
          >
            <RefreshIcon size={13} />
          </IconButton>
          <Button size="sm" variant="secondary" icon={<FolderIcon size={12} />} onClick={handleReveal}>
            在 Finder 中打开
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<ArrowIcon size={12} />}
            onClick={() => navigate('/')}
          >
            返回工作区
          </Button>
        </div>
      </header>

      <section className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.statLabel}>默认分支</span>
          <span className={[styles.statValue, styles.mono].join(' ')}>
            {project.defaultBranch}
          </span>
          <span className={styles.statSub}>{providerLabel(project.provider)}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>工作树数量</span>
          <span className={styles.statValueBig}>{worktreeCount}</span>
          <span className={styles.statSub}>
            {activeWorktree
              ? `当前 ${activeWorktree.branch ?? 'detached HEAD'}`
              : '尚未选择工作树'}
          </span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>远端</span>
          <span className={[styles.statValue, styles.mono].join(' ')} title={project.remoteUrl ?? undefined}>
            {project.remoteUrl ?? '未配置'}
          </span>
          <span className={styles.statSub}>{project.remoteName ?? '无远端名称'}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>最后活跃</span>
          <span className={styles.statValue}>
            {relativeTime(project.lastOpenedAt ?? project.addedAt)}
          </span>
          <span className={styles.statSub}>添加于 {relativeTime(project.addedAt)}</span>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>工作树</h2>
          {projectWorktrees.length > 0 ? (
            <span className={styles.count}>{projectWorktrees.length}</span>
          ) : null}
          {worktreesError ? (
            <span className={styles.sectionHint}>读取失败</span>
          ) : loadingWorktrees ? (
            <span className={styles.sectionHint}>正在读取…</span>
          ) : null}
        </div>

        {worktreesError ? (
          <div className={styles.error}>
            {worktreesError.message}
            {worktreesError.hint ? ` · ${worktreesError.hint}` : ''}
          </div>
        ) : loadingWorktrees ? (
          <div className={styles.loading}>正在读取工作树…</div>
        ) : projectWorktrees.length === 0 ? (
          <div className={styles.emptyBox}>
            <EmptyState
              compact
              icon={<BranchIcon size={16} />}
              title="还没有工作树"
              description="这个项目还没有可用的工作树记录。"
              actions={
                <Button size="sm" variant="ghost" onClick={handleRefresh}>
                  重新读取
                </Button>
              }
            />
          </div>
        ) : (
          <div className={styles.worktreeGrid}>
            {projectWorktrees.map((worktree) => {
              const isActive = worktree.id === storeActiveId;
              return (
                <article
                  key={worktree.id}
                  className={[styles.worktreeCard, isActive ? styles.worktreeActive : '']
                    .filter(Boolean)
                    .join(' ')}
                >
                  <div className={styles.worktreeHead}>
                    <span className={styles.worktreeBranch} title={worktree.branch ?? 'detached HEAD'}>
                      <BranchIcon size={12} />
                      {worktree.branch ?? 'detached HEAD'}
                    </span>
                    <span className={styles.badges}>
                      {worktree.isMain ? <Pill tone="teal">主</Pill> : null}
                      {isActive ? <Pill tone="lime">当前</Pill> : null}
                      {worktree.locked ? <Pill tone="amber">锁定</Pill> : null}
                      {worktree.prunable ? <Pill tone="coral">可清理</Pill> : null}
                    </span>
                  </div>

                  <p className={styles.worktreeSubject} title={worktree.headSubject}>
                    {worktree.headSubject || '没有提交记录'}
                  </p>

                  <div className={styles.worktreeMeta}>
                    <span className={worktree.dirty > 0 ? styles.warn : styles.clean}>
                      {worktree.dirty > 0 ? `${worktree.dirty} 个更改` : '工作区干净'}
                    </span>
                    <span className={styles.mono}>
                      ↑{worktree.ahead} ↓{worktree.behind}
                    </span>
                    {worktree.upstream ? (
                      <span className={styles.upstream} title={worktree.upstream}>
                        {worktree.upstream}
                      </span>
                    ) : null}
                  </div>

                  <div className={styles.worktreePath} title={worktree.path}>
                    {shortPath(worktree.path)}
                  </div>

                  <div className={styles.worktreeActions}>
                    <Button
                      size="sm"
                      variant={isActive ? 'secondary' : 'ghost'}
                      icon={<ArrowIcon size={11} />}
                      onClick={() => void handleOpenWorktree(worktree)}
                    >
                      打开
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<DiffIcon size={11} />}
                      onClick={() => navigate(`/review/${worktree.id}`)}
                    >
                      Git 复核
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>分支</h2>
          {sortedBranches.length > 0 ? (
            <span className={styles.count}>{sortedBranches.length}</span>
          ) : null}
          {branchesError ? (
            <span className={styles.sectionHint}>读取失败</span>
          ) : branchesLoading ? (
            <span className={styles.sectionHint}>正在读取…</span>
          ) : null}
        </div>

        {branchesError ? (
          <div className={styles.error}>{branchesError}</div>
        ) : branchesLoading && sortedBranches.length === 0 ? (
          <div className={styles.loading}>正在读取分支…</div>
        ) : sortedBranches.length === 0 ? (
          <div className={styles.emptyLine}>没有读取到本地分支。</div>
        ) : (
          <div className={styles.branchList}>
            {sortedBranches.map((branch) => (
              <div key={branch.name} className={styles.branchRow}>
                <span className={styles.branchName} title={branch.name}>
                  <BranchIcon size={12} />
                  <span className={styles.branchText}>{branch.name}</span>
                </span>
                <span className={styles.badges}>
                  {branch.isCurrent ? <Pill tone="lime">当前</Pill> : null}
                  {branch.name === project.defaultBranch ? <Pill tone="teal">默认</Pill> : null}
                  {isRemoteRef(branch.name) ? <Pill tone="dim">远端</Pill> : null}
                </span>
                <span className={styles.branchHash}>{shortHash(branch.hash)}</span>
                <span className={styles.branchTime}>{relativeTime(branch.updatedAt)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>最近活动</h2>
          {activities.length > 0 ? <span className={styles.count}>{activities.length}</span> : null}
          {activityError ? (
            <span className={styles.sectionHint}>读取失败</span>
          ) : activityLoading ? (
            <span className={styles.sectionHint}>正在读取…</span>
          ) : null}
        </div>

        {activityError ? (
          <div className={styles.error}>{activityError}</div>
        ) : activityLoading && activities.length === 0 ? (
          <div className={styles.loading}>正在读取最近活动…</div>
        ) : activities.length === 0 ? (
          <div className={styles.emptyLine}>这个项目还没有记录活动。</div>
        ) : (
          <ul className={styles.activityList}>
            {activities.map((activity) => (
              <li key={activity.id} className={styles.activityRow}>
                <span
                  className={[styles.activityIcon, activityToneClass(activity.kind)].join(' ')}
                  title={activity.kind}
                >
                  {activityIcon(activity.kind)}
                </span>
                <div className={styles.activityMain}>
                  <div className={styles.activityTitle} title={activity.title}>
                    {activity.title}
                  </div>
                  <div className={styles.activityMeta}>
                    {activity.detail ? (
                      <span className={styles.activityDetail} title={activity.detail}>
                        {activity.detail}
                      </span>
                    ) : null}
                    {activity.worktreePath ? (
                      <span className={styles.activityPath} title={activity.worktreePath}>
                        {shortPath(activity.worktreePath)}
                      </span>
                    ) : null}
                  </div>
                </div>
                <time className={styles.activityTime} dateTime={activity.createdAt}>
                  {relativeTime(activity.createdAt)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
