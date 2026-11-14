import { create } from 'zustand';
import { pickRepoDirectory } from '@/lib/dialog';
import { call, toAppError } from '@/lib/ipc';
import { useWorktreesStore } from '@/features/worktrees/store';
import type {
  AppErrorShape,
  AppInfo,
  Project,
  ToastMessage,
  ToastTone,
} from '@/lib/types';

const LAST_PROJECT_KEY = 'chenade.lastProject';
let toastTimer: ReturnType<typeof setTimeout> | null = null;

interface AppState {
  info: AppInfo | null;
  projects: Project[];
  currentProjectId: string | null;
  loading: boolean;
  error: AppErrorShape | null;
  toast: ToastMessage | null;
  bootstrap: () => Promise<void>;
  refreshProjects: () => Promise<void>;
  selectProject: (id: string) => Promise<void>;
  addProject: () => Promise<void>;
  removeProject: (id: string) => Promise<void>;
  clearError: () => void;
  notify: (message: string, tone?: ToastTone) => void;
  dismissToast: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  info: null,
  projects: [],
  currentProjectId: null,
  loading: true,
  error: null,
  toast: null,

  bootstrap: async () => {
    set({ loading: true, error: null });
    try {
      const [info, projects] = await Promise.all([
        call<AppInfo>('app_info'),
        call<Project[]>('projects_list'),
      ]);

      const stored = localStorage.getItem(LAST_PROJECT_KEY);
      const current =
        projects.find((project) => project.id === stored)?.id ?? projects[0]?.id ?? null;

      set({ info, projects, currentProjectId: current, loading: false });

      if (current) {
        localStorage.setItem(LAST_PROJECT_KEY, current);
        void call('project_touch', { id: current }).catch(() => undefined);
        void useWorktreesStore.getState().load(current);
      }
    } catch (error) {
      set({ loading: false, error: toAppError(error) });
    }
  },

  refreshProjects: async () => {
    try {
      const projects = await call<Project[]>('projects_list');
      const current = get().currentProjectId;
      const nextCurrent =
        projects.find((project) => project.id === current)?.id ?? projects[0]?.id ?? null;

      set({ projects, currentProjectId: nextCurrent });

      if (nextCurrent && nextCurrent !== current) {
        localStorage.setItem(LAST_PROJECT_KEY, nextCurrent);
        await useWorktreesStore.getState().load(nextCurrent);
      }
    } catch (error) {
      get().notify(toAppError(error).message, 'error');
    }
  },

  selectProject: async (id) => {
    if (get().currentProjectId === id) return;
    set({ currentProjectId: id });
    localStorage.setItem(LAST_PROJECT_KEY, id);
    void call('project_touch', { id }).catch(() => undefined);
    await useWorktreesStore.getState().load(id);
  },

  addProject: async () => {
    let path: string | null = null;
    try {
      path = await pickRepoDirectory();
    } catch (error) {
      get().notify(toAppError(error).message, 'error');
      return;
    }
    if (!path) return;

    try {
      const project = await call<Project>('project_add', { path });
      void call('activity_add', {
        projectId: project.id,
        worktreePath: null,
        kind: 'project',
        title: `添加项目 ${project.name}`,
        detail: project.path,
      }).catch(() => undefined);
      await get().refreshProjects();
      await get().selectProject(project.id);
      get().notify(`已添加 ${project.name}`, 'success');
    } catch (error) {
      const appError = toAppError(error);
      get().notify(appError.hint ? `${appError.message} · ${appError.hint}` : appError.message, 'error');
    }
  },

  removeProject: async (id) => {
    try {
      await call('project_remove', { id });
      await get().refreshProjects();
    } catch (error) {
      get().notify(toAppError(error).message, 'error');
    }
  },

  clearError: () => set({ error: null }),

  notify: (message, tone = 'info') => {
    if (toastTimer) clearTimeout(toastTimer);
    const toast: ToastMessage = { id: Date.now(), message, tone };
    set({ toast });
    toastTimer = setTimeout(() => {
      set({ toast: null });
      toastTimer = null;
    }, 3400);
  },

  dismissToast: () => {
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = null;
    set({ toast: null });
  },
}));
