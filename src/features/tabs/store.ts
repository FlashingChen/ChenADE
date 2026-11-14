import { create } from 'zustand';
import type { Worktree } from '@/lib/types';
import { disposeTerminalTab } from '@/features/terminals/registry';

export type Tab =
  | {
      id: string;
      kind: 'terminal';
      title: string;
      cwd: string;
      autoStart: boolean;
      initialCommand?: string;
    }
  | {
      id: string;
      kind: 'file';
      title: string;
      path: string;
    }
  | {
      id: string;
      kind: 'diff';
      title: string;
    };

interface PersistedTabs {
  tabs: Tab[];
  activeId: string | null;
}

interface TabsState {
  worktreeId: string | null;
  tabs: Tab[];
  activeId: string | null;
  load: (worktree: Worktree) => void;
  selectTab: (id: string | null) => void;
  addTerminal: (
    worktree: Worktree,
    options?: { title?: string; initialCommand?: string },
  ) => void;
  openFile: (path: string) => void;
  openDiff: () => void;
  closeTab: (id: string) => void;
  closeAll: () => void;
}

const keyFor = (worktreeId: string) => `chenade.tabs.${worktreeId}`;
let terminalSequence = 0;

function readPersisted(worktreeId: string): PersistedTabs | null {
  try {
    const raw = localStorage.getItem(keyFor(worktreeId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedTabs;
    if (!Array.isArray(parsed.tabs)) return null;

    const tabs: Tab[] = parsed.tabs
      .filter((tab) => tab && typeof tab.id === 'string')
      .map((tab) => {
        if (tab.kind === 'terminal') {
          return {
            id: tab.id,
            kind: 'terminal' as const,
            title: tab.title,
            cwd: tab.cwd,
            autoStart: false,
          };
        }
        if (tab.kind === 'file') return tab;
        return tab;
      })
      .filter((tab) => tab.kind === 'terminal' || tab.kind === 'file' || tab.kind === 'diff');

    return {
      tabs,
      activeId: tabs.some((tab) => tab.id === parsed.activeId)
        ? parsed.activeId
        : (tabs[0]?.id ?? null),
    };
  } catch {
    return null;
  }
}

export const useTabsStore = create<TabsState>((set, get) => ({
  worktreeId: null,
  tabs: [],
  activeId: null,

  load: (worktree) => {
    if (get().worktreeId === worktree.id) return;
    const persisted = readPersisted(worktree.id);
    set({
      worktreeId: worktree.id,
      tabs: persisted?.tabs ?? [],
      activeId: persisted?.activeId ?? null,
    });
  },

  selectTab: (id) => {
    set({ activeId: id });
    persist(get());
  },

  addTerminal: (worktree, options) => {
    terminalSequence += 1;
    const tab: Tab = {
      id: `t-${Date.now()}-${terminalSequence}`,
      kind: 'terminal',
      title: options?.title || '终端',
      cwd: worktree.path,
      autoStart: true,
      initialCommand: options?.initialCommand,
    };
    const tabs = [...get().tabs, tab];
    set({ tabs, activeId: tab.id });
    persist(get());
  },

  openFile: (path) => {
    const id = `f:${path}`;
    const existing = get().tabs.find((tab) => tab.id === id);
    if (existing) {
      set({ activeId: id });
      persist(get());
      return;
    }

    const title = path.split('/').pop() ?? path;
    const tab: Tab = { id, kind: 'file', title, path };
    const tabs = [...get().tabs, tab];
    set({ tabs, activeId: id });
    persist(get());
  },

  openDiff: () => {
    const id = 'd:worktree';
    const existing = get().tabs.find((tab) => tab.id === id);
    if (existing) {
      set({ activeId: id });
      persist(get());
      return;
    }

    const tab: Tab = { id, kind: 'diff', title: '更改' };
    const tabs = [...get().tabs, tab];
    set({ tabs, activeId: id });
    persist(get());
  },

  closeTab: (id) => {
    const state = get();
    const index = state.tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;

    const closing = state.tabs[index];
    if (closing.kind === 'terminal') {
      disposeTerminalTab(closing.id);
    }

    const tabs = state.tabs.filter((tab) => tab.id !== id);
    let activeId = state.activeId;
    if (activeId === id) {
      activeId = tabs[Math.min(index, tabs.length - 1)]?.id ?? null;
    }

    set({ tabs, activeId });
    persist(get());
  },

  closeAll: () => {
    for (const tab of get().tabs) {
      if (tab.kind === 'terminal') disposeTerminalTab(tab.id);
    }
    set({ tabs: [], activeId: null });
    persist(get());
  },
}));

function persist(state: TabsState): void {
  if (!state.worktreeId) return;
  const payload: PersistedTabs = { tabs: state.tabs, activeId: state.activeId };
  try {
    localStorage.setItem(keyFor(state.worktreeId), JSON.stringify(payload));
  } catch {
    // Storage can be unavailable; tabs still work for this session.
  }
}
