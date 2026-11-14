import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/app/store';
import { useUiStore } from '@/features/ui/store';
import { isTauri } from '@/lib/ipc';
import { shortPath } from '@/lib/format';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { Kbd } from './Kbd';
import {
  CheckIcon,
  ChevronIcon,
  FolderIcon,
  GearIcon,
  LogoMark,
  PlusIcon,
  SearchIcon,
} from './icons';
import styles from './TopBar.module.css';

export function TopBar() {
  const navigate = useNavigate();
  const info = useAppStore((state) => state.info);
  const projects = useAppStore((state) => state.projects);
  const currentProjectId = useAppStore((state) => state.currentProjectId);
  const selectProject = useAppStore((state) => state.selectProject);
  const addProject = useAppStore((state) => state.addProject);

  const openPalette = useUiStore((state) => state.openPalette);
  const openNewWorktree = useUiStore((state) => state.openNewWorktree);
  const openSettings = useUiStore((state) => state.openSettings);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const currentProject = projects.find((project) => project.id === currentProjectId) ?? null;
  const needsTrafficLights = isTauri && /Mac/.test(navigator.userAgent);

  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [menuOpen]);

  return (
    <header
      className={[styles.topbar, needsTrafficLights ? styles.mac : ''].filter(Boolean).join(' ')}
      data-tauri-drag-region
    >
      <div className={styles.brand} data-tauri-drag-region>
        <span className={styles.logo}>
          <LogoMark size={24} />
        </span>
        <span className={styles.name} data-tauri-drag-region>
          ChenADE
        </span>
        <span className={styles.version}>{info?.version ?? '0.1.0'}</span>
      </div>

      <span className={styles.divider} />

      <div className={styles.projectWrap} ref={menuRef}>
        <button
          className={styles.projectButton}
          onClick={() => setMenuOpen((value) => !value)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <FolderIcon size={13} />
          <span className={styles.projectName}>{currentProject?.name ?? '添加项目'}</span>
          <ChevronIcon
            size={11}
            style={{
              transform: menuOpen ? 'rotate(90deg)' : 'rotate(0deg)',
              transition: 'transform 180ms ease',
            }}
          />
        </button>

        {menuOpen ? (
          <div className={styles.menu} role="menu">
            {projects.map((project) => (
              <button
                key={project.id}
                className={styles.menuItem}
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  void selectProject(project.id);
                }}
              >
                <span className={styles.menuIcon}>
                  <FolderIcon size={13} />
                </span>
                <span className={styles.menuText}>
                  <span className={styles.menuTitle}>{project.name}</span>
                  <span className={styles.menuPath}>{shortPath(project.path)}</span>
                </span>
                {project.id === currentProjectId ? (
                  <span className={styles.menuCheck}>
                    <CheckIcon size={12} />
                  </span>
                ) : null}
              </button>
            ))}

            {projects.length === 0 ? (
              <div className={styles.menuEmpty}>还没有添加项目</div>
            ) : null}

            {currentProject ? (
              <button
                className={styles.menuAdd}
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  navigate(`/projects/${currentProject.id}`);
                }}
              >
                <FolderIcon size={12} />
                项目总览
              </button>
            ) : null}

            <button
              className={styles.menuAdd}
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                void addProject();
              }}
            >
              <PlusIcon size={12} />
              添加项目
            </button>
          </div>
        ) : null}
      </div>

      <div className={styles.spacer} />

      <button className={styles.search} onClick={openPalette}>
        <SearchIcon size={13} />
        <span className={styles.searchText}>搜索工作树、文件与命令</span>
        <Kbd>⌘K</Kbd>
      </button>

      <IconButton label="设置" onClick={openSettings}>
        <GearIcon size={15} />
      </IconButton>

      <Button
        variant="primary"
        icon={<PlusIcon size={12} />}
        onClick={openNewWorktree}
        disabled={!currentProject}
      >
        新建 Worktree
      </Button>

      <span className={styles.avatar}>陈</span>
    </header>
  );
}
