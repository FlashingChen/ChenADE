import { create } from 'zustand';

export type Panel = 'files' | 'git';

interface UiState {
  panel: Panel;
  paletteOpen: boolean;
  newWorktreeOpen: boolean;
  settingsOpen: boolean;
  rightPanelVisible: boolean;
  changesOpen: boolean;
  setPanel: (panel: Panel) => void;
  openPalette: () => void;
  closePalette: () => void;
  openNewWorktree: () => void;
  closeNewWorktree: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  toggleRightPanel: () => void;
  toggleChanges: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  panel: 'files',
  paletteOpen: false,
  newWorktreeOpen: false,
  settingsOpen: false,
  rightPanelVisible: true,
  changesOpen: true,
  setPanel: (panel) => set({ panel }),
  openPalette: () => set({ paletteOpen: true }),
  closePalette: () => set({ paletteOpen: false }),
  openNewWorktree: () => set({ newWorktreeOpen: true }),
  closeNewWorktree: () => set({ newWorktreeOpen: false }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  toggleRightPanel: () => set((state) => ({ rightPanelVisible: !state.rightPanelVisible })),
  toggleChanges: () => set((state) => ({ changesOpen: !state.changesOpen })),
}));
