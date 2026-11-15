import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/app/store';
import { useWorktreesStore } from '@/features/worktrees/store';
import { useUiStore } from '@/features/ui/store';
import { useTabsStore } from '@/features/tabs/store';
import { shortPath } from '@/lib/format';
import type { Project, Worktree } from '@/lib/types';
import { call, toAppError } from '@/lib/ipc';
import { confirmAction } from '@/lib/confirm';
import { Button } from './Button';
import { EmptyState } from './EmptyState';
import { IconButton } from './IconButton';
import {
  BranchIcon,
  ChevronIcon,
  FolderIcon,
  MoreIcon,
  PlusIcon,
  SearchIcon,
} from './icons';
import styles from './ProjectRail.module.css';

const EXPANDED_KEY = 'chenade.projects.expanded';

function readExpanded(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const next: Record<string, boolean> = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (typeof value === 'boolean') next[id] = value;
    }
    return next;
  } catch {
    return {};
  }
}

export function ProjectRail() {
  const projects = useAppStore((state) => state.projects);
  const currentProjectId = useAppStore((state) => state.currentProjectId);
  const selectProject = useAppStore((state) => state.selectProject);
  const addProject = useAppStore((state) => state.addProject);
  const removeProject = useAppStore((state) => state.removeProject);
  const refreshProjects = useAppStore((state) => state.refreshProjects);
  const notify = useAppStore((state) => state.notify);
  const loading = useAppStore((state) => state.loading);

  const worktrees = useWorktreesStore((state) => state.worktrees);
  const worktreeProjectId = useWorktreesStore((state) => state.projectId);
  const activeId = useWorktreesStore((state) => state.activeId);
  const selectWorktree = useWorktreesStore((state) => state.select);
  const loadingWorktrees = useWorktreesStore((state) => state.loading);
  const worktreesByProject = useWorktreesStore((state) => state.byProject);
  const loadingByProject = useWorktreesStore((state) => state.loadingByProject);
  const errorsByProject = useWorktreesStore((state) => state.errorsByProject);
  const ensureWorktrees = useWorktreesStore((state) => state.ensureLoaded);

  const openNewWorktree = useUiStore((state) => state.openNewWorktree);
  const navigate = useNavigate();
  const [filter, setFilter] = useState('');
  // 默认全部展开：一个仓库多个工作树是常态，只展开当前项目等于每次都要多点一次。
  const [expanded, setExpanded] = useState<Record<string, boolean>>(readExpanded);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    worktree: Worktree;
    projectId: string;
  } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const [projectMenu, setProjectMenu] = useState<{
    x: number;
    y: number;
    project: Project;
  } | null>(null);
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const currentProject = projects.find((project) => project.id === currentProjectId) ?? null;

  const query = filter.trim().toLowerCase();

  useEffect(() => {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify(expanded));
  }, [expanded]);

  // 展开的项目都要有自己的工作树列表：以前只缓存当前项目，其它项目展开是空的。
  useEffect(() => {
    for (const project of projects) {
      if (query || (expanded[project.id] ?? true)) void ensureWorktrees(project.id);
    }
  }, [projects, expanded, query, ensureWorktrees]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [menuOpen]);

  useEffect(() => {
    if (!contextMenu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!contextMenuRef.current?.contains(event.target as Node)) {
        setContextMenu(null);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!projectMenu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!projectMenuRef.current?.contains(event.target as Node)) {
        setProjectMenu(null);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setProjectMenu(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [projectMenu]);

  const revealPath = async (path: string) => {
    try {
      await call('project_reveal', { path });
    } catch (error) {
      notify(toAppError(error).message, 'error');
    }
  };

  const revealProject = async () => {
    if (!currentProject) return;
    await revealPath(currentProject.path);
  };

  const moveProject = async (direction: -1 | 1) => {
    if (!currentProject) return;
    const index = projects.findIndex((project) => project.id === currentProject.id);
    const next = index + direction;
    if (next < 0 || next >= projects.length) return;
    const ids = projects.map((project) => project.id);
    [ids[index], ids[next]] = [ids[next], ids[index]];
    try {
      await call('project_reorder', { ids });
      await refreshProjects();
    } catch (error) {
      notify(toAppError(error).message, 'error');
    }
  };

  const pruneWorktrees = async () => {
    if (!currentProject) return;
    try {
      await call('worktree_prune', { projectId: currentProject.id });
      await useWorktreesStore.getState().load(currentProject.id);
      notify('已清理失效的工作树记录', 'success');
    } catch (error) {
      notify(toAppError(error).message, 'error');
    }
  };

  const removeProjectWithConfirm = async (project: Project) => {
    const ok = await confirmAction(`移除项目「${project.name}」？不会删除磁盘文件。`, {
      title: '移除项目',
      confirmLabel: '移除',
    });
    if (!ok) return;
    await removeProject(project.id);
    setMenuOpen(false);
    setProjectMenu(null);
  };

  const visible = useMemo(() => {
    return projects.filter((project) => {
      if (!query) return true;
      if (project.name.toLowerCase().includes(query)) return true;
      if (project.path.toLowerCase().includes(query)) return true;
      if (project.id === worktreeProjectId) {
        return worktrees.some((worktree) =>
          (worktree.branch ?? '').toLowerCase().includes(query),
        );
      }
      return false;
    });
  }, [projects, query, worktreeProjectId, worktrees]);

  const revealWorktree = async (worktree: Worktree) => {
    try {
      await call('project_reveal', { path: worktree.path });
    } catch (error) {
      notify(toAppError(error).message, 'error');
    }
  };

  const copyWorktreePath = async (worktree: Worktree) => {
    try {
      await navigator.clipboard.writeText(worktree.path);
      notify('已复制工作树路径', 'success');
    } catch {
      notify('复制路径失败', 'error');
    }
  };

  const removeWorktree = async (worktree: Worktree, projectId: string) => {
    if (worktree.isMain) return;
    if (!(await confirmAction(`删除工作树「${worktree.branch ?? worktree.path}」？`))) return;

    try {
      await call('worktree_remove', {
        projectId,
        path: worktree.path,
        force: false,
      });
    } catch (error) {
      const appError = toAppError(error);
      const force = await confirmAction(`${appError.message}。是否强制删除？`);
      if (!force) return;
      try {
        await call('worktree_remove', {
          projectId,
          path: worktree.path,
          force: true,
        });
      } catch (forceError) {
        notify(toAppError(forceError).message, 'error');
        return;
      }
    }

    if (useTabsStore.getState().worktreeId === worktree.id) {
      useTabsStore.getState().closeAll();
    } else {
      localStorage.removeItem(`chenade.tabs.${worktree.id}`);
    }
    await useWorktreesStore.getState().load(projectId);
    notify('工作树已删除', 'success');
    setContextMenu(null);
  };

  const toggleProject = (id: string) => {
    const isExpanded = expanded[id] ?? true;
    setExpanded((value) => ({ ...value, [id]: !isExpanded }));
    if (!isExpanded) void ensureWorktrees(id);
  };

  const openWorktree = async (projectId: string, worktreeId: string) => {
    if (projectId !== useAppStore.getState().currentProjectId) {
      await useAppStore.getState().selectProject(projectId);
    }
    await useWorktreesStore.getState().select(worktreeId);
  };

  // 点项目行：当前项目 = 折叠/展开；其它项目 = 切过去并展开。
  // 折叠不再只能点那个小箭头——这是“某个项目收不回去”的直接修法。
  const activateProject = (id: string) => {
    if (id === currentProjectId) {
      toggleProject(id);
      return;
    }
    setExpanded((value) => ({ ...value, [id]: true }));
    void selectProject(id);
  };

  const setAllExpanded = (value: boolean) => {
    const next: Record<string, boolean> = {};
    for (const project of projects) next[project.id] = value;
    setExpanded(next);
  };

  return (
    <aside className={styles.rail}>
      <div className={styles.header}>
        <div className={styles.heading}>
          项目
          <span className={styles.count}>{projects.length}</span>
        </div>
        <div className={styles.headerMenuWrap} ref={menuRef}>
          <IconButton label="项目菜单" onClick={() => setMenuOpen((value) => !value)} disabled={!currentProject}>
            <MoreIcon size={14} />
          </IconButton>
          {menuOpen && currentProject ? (
            <div className={styles.headerMenu} role="menu">
              <button className={styles.menuItem} onClick={() => { setMenuOpen(false); navigate(`/projects/${currentProject.id}`); }}>
                项目总览
              </button>
              <button className={styles.menuItem} onClick={() => { setMenuOpen(false); void revealProject(); }}>
                在 Finder 中打开
              </button>
              <button className={styles.menuItem} onClick={() => { setMenuOpen(false); void moveProject(-1); }} disabled={projects[0]?.id === currentProject.id}>
                上移项目
              </button>
              <button className={styles.menuItem} onClick={() => { setMenuOpen(false); void moveProject(1); }} disabled={projects[projects.length - 1]?.id === currentProject.id}>
                下移项目
              </button>
              <button className={styles.menuItem} onClick={() => { setMenuOpen(false); setAllExpanded(true); }}>
                展开全部项目
              </button>
              <button className={styles.menuItem} onClick={() => { setMenuOpen(false); setAllExpanded(false); }}>
                折叠全部项目
              </button>
              <button className={styles.menuItem} onClick={() => { setMenuOpen(false); void pruneWorktrees(); }}>
                清理失效工作树
              </button>
              <button
                className={styles.menuItemDanger}
                onClick={() => {
                  if (currentProject) void removeProjectWithConfirm(currentProject);
                }}
              >
                移除项目
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className={styles.filter}>
        <SearchIcon size={12} />
        <input
          aria-label="筛选工作树"
          placeholder="筛选工作树"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      </div>

      <div className={styles.list}>
        {projects.length === 0 && !loading ? (
          <EmptyState
            compact
            icon={<BranchIcon size={18} />}
            title="还没有项目"
            description="添加一个本地 Git 仓库，ChenADE 会读出它的工作树。"
            actions={
              <Button variant="primary" size="sm" onClick={() => void addProject()}>
                添加项目
              </Button>
            }
          />
        ) : null}

        {visible.map((project) => {
          const isCurrent = project.id === currentProjectId;
          const isExpanded = query ? true : (expanded[project.id] ?? true);
          const projectWorktrees =
            worktreesByProject[project.id] ??
            (isCurrent && worktreeProjectId === project.id ? worktrees : []);
          const isLoadingWorktrees =
            (isCurrent && worktreeProjectId === project.id && loadingWorktrees) ||
            !!loadingByProject[project.id];
          const filteredWorktrees = query
            ? projectWorktrees.filter((worktree) =>
                (worktree.branch ?? '').toLowerCase().includes(query),
              )
            : projectWorktrees;

          return (
            <div key={project.id}>
              <div
                className={styles.projectRow}
                role="button"
                tabIndex={0}
                onClick={() => activateProject(project.id)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setProjectMenu({
                    x: event.clientX,
                    y: event.clientY,
                    project,
                  });
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  activateProject(project.id);
                }}
                title={project.path}
              >
                <button
                  type="button"
                  className={styles.chevron}
                  aria-label={isExpanded ? '折叠项目' : '展开项目'}
                  title={isExpanded ? '折叠项目' : '展开项目'}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleProject(project.id);
                  }}
                >
                  <ChevronIcon
                    size={10}
                    style={{
                      transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                      transition: 'transform 180ms ease',
                    }}
                  />
                </button>
                <FolderIcon size={13} />
                <span className={styles.projectName}>{project.name}</span>
                <span className={styles.projectCount}>{project.worktreeCount}</span>
              </div>

              {isExpanded ? (
                <div className={styles.worktrees}>
                  {filteredWorktrees.map((worktree) => {
                    const active = worktree.id === activeId;
                    return (
                      <button
                        key={worktree.id}
                        className={[styles.worktreeRow, active ? styles.active : '']
                          .filter(Boolean)
                          .join(' ')}
                        onClick={() => void openWorktree(project.id, worktree.id)}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          setContextMenu({
                            x: event.clientX,
                            y: event.clientY,
                            worktree,
                            projectId: project.id,
                          });
                        }}
                        title={`${shortPath(worktree.path)}\n${worktree.headSubject}`}
                      >
                        <BranchIcon
                          size={12}
                          className={styles.branchIcon}
                          style={{ color: active ? 'var(--lime)' : undefined }}
                        />
                        <span className={styles.branchName}>
                          {worktree.branch ?? 'detached HEAD'}
                        </span>
                        {worktree.dirty > 0 ? (
                          <span className={styles.dirty}>{worktree.dirty}</span>
                        ) : null}
                        {worktree.isMain ? <span className={styles.mainTag}>主</span> : null}
                      </button>
                    );
                  })}

                  {isLoadingWorktrees ? (
                    <div className={styles.loading}>读取工作树…</div>
                  ) : null}

                  {!isLoadingWorktrees && filteredWorktrees.length === 0 ? (
                    <div className={styles.loading}>
                      {query
                        ? '没有匹配的工作树'
                        : (errorsByProject[project.id]?.message ?? '没有工作树')}
                    </div>
                  ) : null}

                  {isCurrent ? (
                    <button
                      className={styles.newWorktree}
                      onClick={openNewWorktree}
                    >
                      <PlusIcon size={11} />
                      新建工作树
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}

        {query && visible.length === 0 ? (
          <div className={styles.loading}>没有匹配的项目</div>
        ) : null}
      </div>

      <div className={styles.footer}>
        <Button
          variant="secondary"
          size="sm"
          icon={<PlusIcon size={11} />}
          onClick={() => void addProject()}
          className={styles.addButton}
        >
          添加项目
        </Button>
      </div>

      {projectMenu
        ? createPortal(
            <div
              ref={projectMenuRef}
              className={styles.contextMenu}
              style={{
                left: Math.min(projectMenu.x, window.innerWidth - 210),
                top: Math.min(projectMenu.y, window.innerHeight - 190),
              }}
              role="menu"
            >
              <div className={styles.contextHeader}>
                <strong>{projectMenu.project.name}</strong>
                <span>{shortPath(projectMenu.project.path)}</span>
              </div>
              <button
                className={styles.contextItem}
                onClick={() => {
                  const project = projectMenu.project;
                  setProjectMenu(null);
                  navigate(`/projects/${project.id}`);
                }}
              >
                项目总览
              </button>
              <button
                className={styles.contextItem}
                onClick={() => {
                  const project = projectMenu.project;
                  setProjectMenu(null);
                  void revealPath(project.path);
                }}
              >
                在 Finder 中打开
              </button>
              <button
                className={styles.contextDanger}
                onClick={() => {
                  const project = projectMenu.project;
                  setProjectMenu(null);
                  void removeProjectWithConfirm(project);
                }}
              >
                移除项目
              </button>
            </div>,
            document.body,
          )
        : null}

      {contextMenu
        ? createPortal(
            <div
              ref={contextMenuRef}
              className={styles.contextMenu}
              style={{
                left: Math.min(contextMenu.x, window.innerWidth - 210),
                top: Math.min(contextMenu.y, window.innerHeight - 230),
              }}
              role="menu"
            >
              <div className={styles.contextHeader}>
                <strong>{contextMenu.worktree.branch ?? 'detached HEAD'}</strong>
                <span>{shortPath(contextMenu.worktree.path)}</span>
              </div>
              <button
                className={styles.contextItem}
                onClick={() => {
                  setContextMenu(null);
                  void selectWorktree(contextMenu.worktree.id);
                }}
              >
                打开工作树
              </button>
              <button
                className={styles.contextItem}
                onClick={() => {
                  const worktree = contextMenu.worktree;
                  setContextMenu(null);
                  void revealWorktree(worktree);
                }}
              >
                在文件管理器中显示
              </button>
              <button
                className={styles.contextItem}
                onClick={() => {
                  const worktree = contextMenu.worktree;
                  setContextMenu(null);
                  void copyWorktreePath(worktree);
                }}
              >
                复制工作树路径
              </button>
              <button
                className={styles.contextItem}
                onClick={() => {
                  setContextMenu(null);
                  void useWorktreesStore.getState().refreshStatus();
                }}
              >
                刷新状态
              </button>
              <button
                className={styles.contextDanger}
                disabled={contextMenu.worktree.isMain}
                onClick={() => {
                  const { worktree, projectId } = contextMenu;
                  setContextMenu(null);
                  void removeWorktree(worktree, projectId);
                }}
              >
                删除工作树
              </button>
            </div>,
            document.body,
          )
        : null}
    </aside>
  );
}
