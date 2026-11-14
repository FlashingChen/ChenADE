import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/app/store';
import { useWorktreesStore } from '@/features/worktrees/store';
import { useUiStore } from '@/features/ui/store';
import { useTabsStore } from '@/features/tabs/store';
import { shortPath } from '@/lib/format';
import { call } from '@/lib/ipc';
import type { SearchHit } from '@/lib/types';
import {
  BranchIcon,
  DiffIcon,
  FileIcon,
  FolderIcon,
  GearIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  TerminalIcon,
} from './icons';
import styles from './CommandPalette.module.css';

interface PaletteItem {
  id: string;
  group: '命令' | '工作树' | '文件';
  label: string;
  hint?: string;
  icon: ReactNode;
  run: () => void;
}

export function CommandPalette() {
  const open = useUiStore((state) => state.paletteOpen);
  const close = useUiStore((state) => state.closePalette);
  const navigate = useNavigate();

  const projects = useAppStore((state) => state.projects);
  const currentProjectId = useAppStore((state) => state.currentProjectId);
  const addProject = useAppStore((state) => state.addProject);
  const openNewWorktree = useUiStore((state) => state.openNewWorktree);

  const worktrees = useWorktreesStore((state) => state.worktrees);
  const activeId = useWorktreesStore((state) => state.activeId);
  const selectWorktree = useWorktreesStore((state) => state.select);
  const refreshStatus = useWorktreesStore((state) => state.refreshStatus);
  const openFile = useTabsStore((state) => state.openFile);

  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [fileHits, setFileHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const project = projects.find((item) => item.id === currentProjectId);
  const active = worktrees.find((item) => item.id === activeId);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setIndex(0);
    setFileHits([]);
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open || !active || query.trim().length < 2) {
      setFileHits([]);
      setSearching(false);
      return;
    }

    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      call<SearchHit[]>('search_files', {
        root: active.path,
        query: query.trim(),
        limit: 24,
      })
        .then((hits) => {
          if (!cancelled) setFileHits(hits);
        })
        .catch(() => {
          if (!cancelled) setFileHits([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, active, query]);

  const items = useMemo<PaletteItem[]>(() => {
    if (!open) return [];

    const commands: PaletteItem[] = [
      {
        id: 'add-project',
        group: '命令',
        label: '添加项目',
        hint: '选择本地 Git 仓库',
        icon: <PlusIcon size={13} />,
        run: () => void addProject(),
      },
      {
        id: 'refresh',
        group: '命令',
        label: '刷新工作树状态',
        hint: active?.branch ?? '当前工作树',
        icon: <RefreshIcon size={13} />,
        run: () => void refreshStatus(),
      },
    ];

    if (project) {
      commands.push({
        id: 'new-worktree',
        group: '命令',
        label: '新建 Worktree',
        hint: project.name,
        icon: <PlusIcon size={13} />,
        run: openNewWorktree,
      });

      commands.push({
        id: 'project-home',
        group: '命令',
        label: '打开项目总览',
        hint: project.name,
        icon: <FolderIcon size={13} />,
        run: () => navigate(`/projects/${project.id}`),
      });
    }

    if (active) {
      commands.push({
        id: 'git-review',
        group: '命令',
        label: '打开 Git 复核',
        hint: active.branch ?? undefined,
        icon: <DiffIcon size={13} />,
        run: () => navigate(`/review/${active.id}`),
      });
    }

    commands.push({
      id: 'new-terminal',
      group: '命令',
      label: '新建终端',
      hint: '⌘T',
      icon: <TerminalIcon size={13} />,
      run: () => {
        const worktrees = useWorktreesStore.getState();
        const activeWorktree = worktrees.worktrees.find(
          (item) => item.id === worktrees.activeId,
        );
        if (activeWorktree) useTabsStore.getState().addTerminal(activeWorktree);
      },
    });

    commands.push({
      id: 'settings',
      group: '命令',
      label: '打开设置',
      hint: '⌘,',
      icon: <GearIcon size={13} />,
      run: () => useUiStore.getState().openSettings(),
    });

    const worktreeItems: PaletteItem[] = worktrees.map((worktree) => ({
      id: `wt-${worktree.id}`,
      group: '工作树',
      label: worktree.branch ?? 'detached HEAD',
      hint: shortPath(worktree.path),
      icon: <BranchIcon size={13} />,
      run: () => void selectWorktree(worktree.id),
    }));

    const fileItems: PaletteItem[] = fileHits.map((hit) => ({
      id: `file-${hit.kind}-${hit.path}-${hit.line ?? 0}`,
      group: '文件',
      label: hit.path.startsWith(active?.path ?? '')
        ? hit.path.slice((active?.path ?? '').length).replace(/^[/\\]/, '')
        : hit.path,
      hint: hit.line ? `第 ${hit.line} 行 · ${hit.preview ?? ''}` : '文件名匹配',
      icon: <FileIcon size={13} />,
      run: () => openFile(hit.path),
    }));

    return [...commands, ...worktreeItems, ...fileItems];
  }, [
    open,
    project,
    active,
    worktrees,
    addProject,
    openNewWorktree,
    refreshStatus,
    navigate,
    selectWorktree,
    fileHits,
    active,
    openFile,
  ]);

  const visible = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return items;
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(value) ||
        (item.hint ?? '').toLowerCase().includes(value),
    );
  }, [items, query]);

  useEffect(() => {
    setIndex((value) => Math.min(value, Math.max(visible.length - 1, 0)));
  }, [visible.length]);

  if (!open) return null;

  const runItem = (item: PaletteItem | undefined) => {
    if (!item) return;
    item.run();
    close();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setIndex((value) => (visible.length ? (value + 1) % visible.length : 0));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setIndex((value) =>
        visible.length ? (value - 1 + visible.length) % visible.length : 0,
      );
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      runItem(visible[index]);
    }
  };

  let lastGroup = '';

  return (
    <div
      className={styles.backdrop}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className={styles.panel} role="dialog" aria-modal="true" aria-label="全局搜索">
        <div className={styles.inputRow}>
          <SearchIcon size={15} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="搜索工作树、文件与命令"
            aria-label="搜索工作树、文件与命令"
          />
          <span className={styles.esc}>Esc</span>
        </div>

        <div className={styles.list}>
          {searching ? <div className={styles.empty}>搜索文件…</div> : null}
          {!searching && visible.length === 0 ? (
            <div className={styles.empty}>没有匹配项</div>
          ) : (
            visible.map((item, itemIndex) => {
              const showGroup = item.group !== lastGroup;
              lastGroup = item.group;
              return (
                <div key={item.id}>
                  {showGroup ? <div className={styles.group}>{item.group}</div> : null}
                  <button
                    className={[
                      styles.item,
                      itemIndex === index ? styles.itemActive : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onPointerEnter={() => setIndex(itemIndex)}
                    onClick={() => runItem(item)}
                  >
                    <span className={styles.itemIcon}>{item.icon}</span>
                    <span className={styles.itemLabel}>{item.label}</span>
                    {item.hint ? <span className={styles.itemHint}>{item.hint}</span> : null}
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className={styles.footer}>
          <span>
            <span className={styles.key}>↑</span>
            <span className={styles.key}>↓</span> 选择
          </span>
          <span>
            <span className={styles.key}>↵</span> 打开
          </span>
          <span>
            <span className={styles.key}>Esc</span> 关闭
          </span>
        </div>
      </div>
    </div>
  );
}
