import { useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { CommandPalette } from '@/components/CommandPalette';
import { StatusBar } from '@/components/StatusBar';
import { ToastViewport } from '@/components/ToastViewport';
import { TopBar } from '@/components/TopBar';
import { SettingsModal } from '@/features/settings/SettingsModal';
import { NewWorktreeModal } from '@/features/worktrees/NewWorktreeModal';
import { useUiStore } from '@/features/ui/store';
import { useTabsStore } from '@/features/tabs/store';
import { useWorktreesStore } from '@/features/worktrees/store';
import { useSettingsStore } from '@/features/settings/store';
import { useAppStore } from './store';
import styles from './AppShell.module.css';

let bootStarted = false;

export function AppShell() {
  const navigate = useNavigate();
  const settingsOpen = useUiStore((state) => state.settingsOpen);

  useEffect(() => {
    if (bootStarted) return;
    bootStarted = true;
    void useAppStore.getState().bootstrap();
    void useSettingsStore.getState().load();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      const ui = useUiStore.getState();

      if (key === 'escape') {
        if (ui.paletteOpen) {
          ui.closePalette();
          return;
        }
        if (ui.settingsOpen) {
          ui.closeSettings();
          return;
        }
        if (ui.newWorktreeOpen) {
          ui.closeNewWorktree();
          return;
        }
        return;
      }

      if (!mod) return;

      if (key === 'k' || key === 'p') {
        event.preventDefault();
        ui.openPalette();
        return;
      }

      if (key === 't') {
        event.preventDefault();
        const worktrees = useWorktreesStore.getState();
        const active = worktrees.worktrees.find((item) => item.id === worktrees.activeId);
        if (active) useTabsStore.getState().addTerminal(active);
        return;
      }

      if (key === 'w') {
        event.preventDefault();
        const tabs = useTabsStore.getState();
        if (tabs.activeId) tabs.closeTab(tabs.activeId);
        return;
      }

      if (key === 'b') {
        event.preventDefault();
        ui.toggleRightPanel();
        return;
      }

      if (key === 'j') {
        event.preventDefault();
        ui.toggleChanges();
        return;
      }

      if (key === 'r') {
        event.preventDefault();
        void useWorktreesStore.getState().refreshStatus();
        return;
      }

      if (key === 'n' && event.shiftKey) {
        event.preventDefault();
        ui.openNewWorktree();
        return;
      }

      if (key === 'g' && event.shiftKey) {
        event.preventDefault();
        const worktrees = useWorktreesStore.getState();
        if (worktrees.activeId) navigate(`/review/${worktrees.activeId}`);
        return;
      }

      if (key === ',') {
        event.preventDefault();
        ui.openSettings();
        return;
      }

      if (key >= '1' && key <= '9') {
        event.preventDefault();
        const tabs = useTabsStore.getState();
        const index = Number(key) - 1;
        const target = index === -1 ? null : tabs.tabs[index];
        tabs.selectTab(target?.id ?? null);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [navigate]);

  return (
    <div className={styles.shell}>
      <TopBar />
      <div className={styles.body}>
        <Outlet />
      </div>
      <StatusBar />
      <ToastViewport />
      <CommandPalette />
      <NewWorktreeModal />
      <SettingsModal
        open={settingsOpen}
        onClose={() => useUiStore.getState().closeSettings()}
      />
    </div>
  );
}
