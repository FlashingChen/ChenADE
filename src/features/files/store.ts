import { create } from 'zustand';
import { call, toAppError } from '@/lib/ipc';
import type { FileEntry } from '@/lib/types';

interface FilesState {
  root: string | null;
  entries: Record<string, FileEntry[]>;
  expanded: Record<string, boolean>;
  loading: Record<string, boolean>;
  error: string | null;
  reset: (root: string) => Promise<void>;
  loadDir: (path: string, force?: boolean) => Promise<void>;
  toggleDir: (entry: FileEntry) => Promise<void>;
  refresh: () => Promise<void>;
}

export const useFilesStore = create<FilesState>((set, get) => ({
  root: null,
  entries: {},
  expanded: {},
  loading: {},
  error: null,

  reset: async (root) => {
    if (get().root === root && get().entries[root]) return;
    set({ root, entries: {}, expanded: { [root]: true }, loading: {}, error: null });
    await get().loadDir(root);
  },

  loadDir: async (path, force = false) => {
    const { root, entries, loading } = get();
    if (!root) return;
    if (!force && entries[path]) return;
    if (loading[path]) return;

    set((state) => ({ loading: { ...state.loading, [path]: true }, error: null }));
    try {
      const list = await call<FileEntry[]>('files_list_dir', { root, path });
      set((state) => ({
        entries: { ...state.entries, [path]: list },
        loading: { ...state.loading, [path]: false },
      }));
    } catch (error) {
      set((state) => ({
        loading: { ...state.loading, [path]: false },
        error: toAppError(error).message,
      }));
    }
  },

  toggleDir: async (entry) => {
    const { expanded } = get();
    const isOpen = !!expanded[entry.path];
    if (isOpen) {
      set({ expanded: { ...expanded, [entry.path]: false } });
      return;
    }
    set({ expanded: { ...expanded, [entry.path]: true } });
    await get().loadDir(entry.path);
  },

  refresh: async () => {
    const root = get().root;
    if (!root) return;
    set({ entries: {}, expanded: { [root]: true }, loading: {}, error: null });
    await get().loadDir(root);
  },
}));
