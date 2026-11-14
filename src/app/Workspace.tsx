import { useEffect, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ProjectRail } from '@/components/ProjectRail';
import { RightPanel } from '@/components/RightPanel';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/Button';
import {
  ArrowIcon,
  BranchIcon,
  DiffIcon,
  FolderIcon,
  RefreshIcon,
} from '@/components/icons';
import { useAppStore } from './store';
import { useWorktreesStore } from '@/features/worktrees/store';
import { useUiStore } from '@/features/ui/store';
import { TabBar } from '@/features/tabs/TabBar';
import { useTabsStore } from '@/features/tabs/store';
import { TerminalPane } from '@/features/terminals/TerminalPane';
import { FileEditor } from '@/features/files/FileEditor';
import { WorktreeDiff } from '@/features/git/WorktreeDiff';
import {
  fileStatusColor,
  fileStatusCode,
  relativeTime,
  shortHash,
  shortPath,
} from '@/lib/format';
import type { GitStatus, Project, Worktree } from '@/lib/types';
import styles from './Workspace.module.css';

const RAIL_DEFAULT = 240;
const PANEL_DEFAULT = 300;
const RAIL_MIN = 190;
const RAIL_MAX = 380;
const PANEL_MIN = 240;
const PANEL_MAX = 560;

function readWidth(key: string, fallback: number): number {
  const raw = localStorage.getItem(key);
  const value = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function Workspace() {
  const projects = useAppStore((state) => state.projects);
  const currentProjectId = useAppStore((state) => state.currentProjectId);
  const loadingProjects = useAppStore((state) => state.loading);
  const addProject = useAppStore((state) => state.addProject);

  const worktrees = useWorktreesStore((state) => state.worktrees);
  const activeId = useWorktreesStore((state) => state.activeId);
  const status = useWorktreesStore((state) => state.status);
  const loadingWorktrees = useWorktreesStore((state) => state.loading);
  const worktreesError = useWorktreesStore((state) => state.error);
  const refreshStatus = useWorktreesStore((state) => state.refreshStatus);
  const loadWorktrees = useWorktreesStore((state) => state.load);

  const setPanel = useUiStore((state) => state.setPanel);
  const rightPanelVisible = useUiStore((state) => state.rightPanelVisible);
  const changesOpen = useUiStore((state) => state.changesOpen);

  const [railWidth, setRailWidth] = useState(() =>
    clamp(readWidth('chenade.layout.rail', RAIL_DEFAULT), RAIL_MIN, RAIL_MAX),
  );
  const [panelWidth, setPanelWidth] = useState(() =>
    clamp(readWidth('chenade.layout.panel', PANEL_DEFAULT), PANEL_MIN, PANEL_MAX),
  );

  useEffect(() => {
    localStorage.setItem('chenade.layout.rail', String(railWidth));
  }, [railWidth]);

  useEffect(() => {
    localStorage.setItem('chenade.layout.panel', String(panelWidth));
  }, [panelWidth]);

  const gridStyle = {
    '--rail-width': `${railWidth}px`,
    '--panel-width': `${panelWidth}px`,
  } as CSSProperties;

  const startResize =
    (side: 'rail' | 'panel') => (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = side === 'rail' ? railWidth : panelWidth;

      const onMove = (move: PointerEvent) => {
        const delta = move.clientX - startX;
        if (side === 'rail') {
          setRailWidth(clamp(startWidth + delta, RAIL_MIN, RAIL_MAX));
        } else {
          setPanelWidth(clamp(startWidth - delta, PANEL_MIN, PANEL_MAX));
        }
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    };
  const tabs = useTabsStore((state) => state.tabs);
  const tabsWorktreeId = useTabsStore((state) => state.worktreeId);
  const activeTabId = useTabsStore((state) => state.activeId);
  const navigate = useNavigate();

  const project = projects.find((item) => item.id === currentProjectId) ?? null;
  const active = worktrees.find((item) => item.id === activeId) ?? null;

  useEffect(() => {
    if (active) useTabsStore.getState().load(active);
  }, [active]);

  const tabsReady = !!active && tabsWorktreeId === active.id;
  const activeTab = tabsReady ? tabs.find((tab) => tab.id === activeTabId) ?? null : null;

  if (loadingProjects) {
    return (
      <div className={styles.grid}>
        <ProjectRail />
        <main className={styles.main}>
          <div className={styles.loadingState}>
            <span className={styles.loadingDot} />
            正在读取项目与工作树…
          </div>
        </main>
        <div className={styles.panelPlaceholder} />
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className={styles.grid}>
        <ProjectRail />
        <main className={styles.main}>
          <EmptyState
            icon={<BranchIcon size={18} />}
            title="从添加一个 Git 仓库开始"
            description="ChenADE 会读取仓库的工作树、分支与改动。所有数据都留在本机，不会上传。"
            actions={
              <Button variant="primary" onClick={() => void addProject()}>
                添加项目
              </Button>
            }
          />
        </main>
        <div className={styles.panelPlaceholder}>
          <FolderIcon size={18} />
          <span>选择项目后显示文件与 Git</span>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className={styles.grid}>
        <ProjectRail />
        <main className={styles.main}>
          <EmptyState
            icon={<BranchIcon size={18} />}
            title="选择一个项目"
            description="从左侧选择项目，或添加一个新的本地仓库。"
            actions={
              <Button variant="primary" onClick={() => void addProject()}>
                添加项目
              </Button>
            }
          />
        </main>
        <div className={styles.panelPlaceholder} />
      </div>
    );
  }

  return (
    <div
      className={[styles.grid, !rightPanelVisible ? styles.gridNoPanel : ''].filter(Boolean).join(' ')}
      style={gridStyle}
    >
      <ProjectRail />

      <div
        className={styles.splitter}
        style={{ left: `calc(10px + ${railWidth}px)` }}
        onPointerDown={startResize('rail')}
        onDoubleClick={() => setRailWidth(RAIL_DEFAULT)}
        role="separator"
        aria-label="调整左栏宽度"
        title="拖动调整左栏宽度，双击复位"
      />

      <main className={styles.main}>
        {worktreesError && !loadingWorktrees ? (
          <div className={styles.errorState}>
            <p>{worktreesError.message}</p>
            <Button size="sm" onClick={() => void loadWorktrees(project.id)}>
              重试
            </Button>
          </div>
        ) : null}

        {!worktreesError && !active && loadingWorktrees ? (
          <div className={styles.loadingState}>
            <span className={styles.loadingDot} />
            正在读取工作树…
          </div>
        ) : null}

        {!worktreesError && !loadingWorktrees && !active ? (
          <EmptyState
            icon={<BranchIcon size={18} />}
            title="这个项目还没有工作树"
            description="在终端运行 git worktree add 创建一个独立目录，然后回到这里刷新。"
            actions={
              <Button size="sm" icon={<RefreshIcon size={12} />} onClick={() => void loadWorktrees(project.id)}>
                重新读取
              </Button>
            }
          />
        ) : null}

        {active ? (
          <>
            <TabBar worktree={active} />

            <div className={styles.content}>
              {activeTab?.kind === 'terminal' ? (
                <TerminalPane tab={activeTab} />
              ) : activeTab?.kind === 'file' ? (
                <FileEditor
                  root={active.path}
                  path={activeTab.path}
                  onSaved={() => void refreshStatus()}
                />
              ) : activeTab?.kind === 'diff' ? (
                <WorktreeDiff
                  worktree={active}
                  onOpenReview={() => navigate(`/review/${active.id}`)}
                />
              ) : (
                <div className={styles.contentScroll}>
                  <WorktreeOverview
                    project={project}
                    worktree={active}
                    status={status}
                    onOpenReview={() => navigate(`/review/${active.id}`)}
                    onOpenDiff={() => useTabsStore.getState().openDiff()}
                    onOpenGit={() => setPanel('git')}
                  />
                </div>
              )}
            </div>

            {changesOpen ? (
              <ChangesPanel
                worktree={active}
                status={status}
                onOpenReview={() => navigate(`/review/${active.id}`)}
              />
            ) : null}
          </>
        ) : null}
      </main>

      {rightPanelVisible ? (
        active ? (
          <RightPanel worktree={active} status={status} />
        ) : (
          <div className={styles.panelPlaceholder}>
            <DiffIcon size={18} />
            <span>选择一个工作树后显示文件与 Git</span>
          </div>
        )
      ) : null}

      {rightPanelVisible ? (
        <div
          className={styles.splitter}
          style={{ right: `calc(10px + ${panelWidth}px)` }}
          onPointerDown={startResize('panel')}
          onDoubleClick={() => setPanelWidth(PANEL_DEFAULT)}
          role="separator"
          aria-label="调整右栏宽度"
          title="拖动调整右栏宽度，双击复位"
        />
      ) : null}
    </div>
  );
}

function WorktreeOverview({
  project,
  worktree,
  status,
  onOpenReview,
  onOpenDiff,
  onOpenGit,
}: {
  project: Project;
  worktree: Worktree;
  status: GitStatus | null;
  onOpenReview: () => void;
  onOpenDiff: () => void;
  onOpenGit: () => void;
}) {
  const files = status?.files ?? [];

  return (
    <div className={styles.overview}>
      <div className={styles.overviewHead}>
        <div>
          <h2>当前工作树</h2>
          <p>读取自本地 git，切换工作树不会影响其他目录。</p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          icon={<ArrowIcon size={12} />}
          onClick={onOpenGit}
        >
          打开 Git 面板
        </Button>
      </div>

      <div className={styles.cards}>
        <section className={styles.card}>
          <div className={styles.cardLabel}>当前提交</div>
          <div className={styles.commitHash}>{shortHash(worktree.head)}</div>
          <div className={styles.cardTitle}>{worktree.headSubject || '—'}</div>
          <div className={styles.cardMeta}>
            <span>{worktree.branch ?? 'detached HEAD'}</span>
            <span className={styles.dot}>·</span>
            <span>{status?.upstream ?? '未设置上游'}</span>
          </div>
        </section>

        <section className={styles.card}>
          <div className={styles.cardLabel}>工作区</div>
          <div className={styles.cardTitle}>
            {files.length > 0 ? `${files.length} 个文件有更改` : '工作区干净'}
          </div>
          <div className={styles.cardMeta}>
            <span>领先 {status?.ahead ?? worktree.ahead}</span>
            <span className={styles.dot}>·</span>
            <span>落后 {status?.behind ?? worktree.behind}</span>
            <span className={styles.dot}>·</span>
            <span>{worktree.isMain ? '主仓库' : `从 ${worktree.base ?? 'main'} 分出`}</span>
          </div>
          <div className={styles.cardFoot}>
            <span>{relativeTime(worktree.createdAt)}创建</span>
            <button className={styles.link} onClick={onOpenDiff}>
              查看差异
            </button>
          </div>
        </section>

        <section className={styles.card}>
          <div className={styles.cardLabel}>项目</div>
          <div className={styles.cardTitle}>{project.name}</div>
          <div className={styles.cardMeta}>
            <span className={styles.mono}>{shortPath(project.path)}</span>
          </div>
          <div className={styles.cardFoot}>
            <span>{project.remoteUrl ? '已配置远端' : '未配置远端'}</span>
            <span className={styles.mono}>{project.defaultBranch}</span>
          </div>
        </section>
      </div>

      <section className={styles.changesSection}>
        <div className={styles.sectionHead}>
          <h3>工作区更改</h3>
          <span className={styles.sectionCount}>{files.length}</span>
          {files.length > 0 ? (
            <button className={styles.link} onClick={onOpenReview}>
              在 Git 复核中打开
            </button>
          ) : null}
        </div>

        {files.length === 0 ? (
          <div className={styles.cleanRow}>
            <span className={styles.cleanDot} />
            这个工作树没有未提交的改动
          </div>
        ) : (
          <div className={styles.changeList}>
            {files.map((file) => {
              const code = fileStatusCode(file.index, file.worktree);
              return (
                <div key={file.path} className={styles.changeRow} title={file.path}>
                  <span
                    className={styles.changeCode}
                    style={{ color: fileStatusColor(code) }}
                  >
                    {code}
                  </span>
                  <span className={styles.changePath}>{file.path}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function ChangesPanel({
  worktree,
  status,
  onOpenReview,
}: {
  worktree: Worktree;
  status: GitStatus | null;
  onOpenReview: () => void;
}) {
  const files = status?.files ?? [];

  if (files.length === 0) {
    return (
      <div className={styles.changesBarClean}>
        <span className={styles.cleanDot} />
        <span>工作区干净</span>
        <span className={styles.changesHint}>这个工作树没有未提交的改动</span>
      </div>
    );
  }

  return (
    <div className={styles.changesBar}>
      <div className={styles.changesBarHead}>
        <span className={styles.changesBarTitle}>工作区更改</span>
        <span className={styles.changesBarSummary}>
          {worktree.base ?? 'main'} ← {worktree.branch ?? 'detached'} · {files.length} 个文件
        </span>
        <span className={styles.changesBarSpacer} />
        <button className={styles.link} onClick={onOpenReview}>
          在 Git 视图中打开
        </button>
      </div>
      <div className={styles.changesBarList}>
        {files.slice(0, 3).map((file) => {
          const code = fileStatusCode(file.index, file.worktree);
          return (
            <div key={file.path} className={styles.changesBarRow}>
              <span
                className={styles.changeCode}
                style={{ color: fileStatusColor(code) }}
              >
                {code}
              </span>
              <span className={styles.changePath}>{file.path}</span>
            </div>
          );
        })}
        {files.length > 3 ? (
          <span className={styles.moreChanges}>还有 {files.length - 3} 个文件…</span>
        ) : null}
      </div>
    </div>
  );
}
