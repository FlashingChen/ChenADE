import { create } from 'zustand';
import { call, toAppError } from '@/lib/ipc';
import type { AppErrorShape, GitStatus, Worktree } from '@/lib/types';

let loadSequence = 0;

function activeKey(projectId: string): string {
  return `chenade.activeWorktree.${projectId}`;
}

interface WorktreesState {
  projectId: string | null;
  worktrees: Worktree[];
  activeId: string | null;
  status: GitStatus | null;
  loading: boolean;
  statusLoading: boolean;
  error: AppErrorShape | null;
  load: (projectId: string) => Promise<void>;
  select: (id: string) => Promise<void>;
  refreshStatus: () => Promise<void>;
}

export const useWorktreesStore = create<WorktreesState>((set, get) => ({
  projectId: null,
  worktrees: [],
  activeId: null,
  status: null,
  loading: false,
  statusLoading: false,
  error: null,

  load: async (projectId) => {
    const sequence = ++loadSequence;
    set({
      projectId,
      loading: true,
      error: null,
      status: null,
      statusLoading: false,
    });

    try {
      const worktrees = await call<Worktree[]>('worktrees_list', { projectId });
      if (sequence !== loadSequence || get().projectId !== projectId) return;

      const stored = localStorage.getItem(activeKey(projectId));
      const preferred =
        worktrees.find((worktree) => worktree.id === stored) ??
        worktrees.find((worktree) => !worktree.isMain) ??
        worktrees[0] ??
        null;

      set({
        worktrees,
        activeId: preferred?.id ?? null,
        loading: false,
      });

      if (preferred) {
        localStorage.setItem(activeKey(projectId), preferred.id);
        await get().select(preferred.id);
      }
    } catch (error) {
      if (sequence !== loadSequence) return;
      set({ loading: false, error: toAppError(error) });
    }
  },

  select: async (id) => {
    const worktree = get().worktrees.find((item) => item.id === id);
    if (!worktree) return;

    const sequence = loadSequence;
    set({ activeId: id, statusLoading: true, status: null });
    if (get().projectId) {
      localStorage.setItem(activeKey(get().projectId as string), id);
    }

    try {
      const status = await call<GitStatus>('worktree_status', { path: worktree.path });
      if (get().activeId !== id || get().projectId !== worktree.projectId || sequence !== loadSequence) {
        return;
      }
      set({ status, statusLoading: false });
    } catch (error) {
      if (get().activeId !== id) return;
      set({ statusLoading: false, error: toAppError(error) });
    }
  },

  refreshStatus: async () => {
    const { activeId, worktrees } = get();
    const worktree = worktrees.find((item) => item.id === activeId);
    if (!worktree) return;

    set({ statusLoading: true });
    try {
      const status = await call<GitStatus>('worktree_status', { path: worktree.path });
      if (get().activeId !== worktree.id) return;
      set({ status, statusLoading: false });
    } catch (error) {
      set({ statusLoading: false, error: toAppError(error) });
    }
  },
}));
