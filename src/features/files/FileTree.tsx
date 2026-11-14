import { useEffect, useMemo, type ReactNode } from 'react';
import { useTabsStore } from '@/features/tabs/store';
import { fileStatusColor, fileStatusCode, type FileStatusCode } from '@/lib/format';
import type { FileEntry, GitStatus } from '@/lib/types';
import {
  ChevronIcon,
  FileIcon,
  FolderIcon,
  FolderOpenIcon,
  RefreshIcon,
} from '@/components/icons';
import { IconButton } from '@/components/IconButton';
import { useFilesStore } from './store';
import styles from './FileTree.module.css';

export function FileTree({ root, status }: { root: string; status: GitStatus | null }) {
  const entries = useFilesStore((state) => state.entries);
  const expanded = useFilesStore((state) => state.expanded);
  const loading = useFilesStore((state) => state.loading);
  const error = useFilesStore((state) => state.error);
  const reset = useFilesStore((state) => state.reset);
  const refresh = useFilesStore((state) => state.refresh);
  const toggleDir = useFilesStore((state) => state.toggleDir);
  const openFile = useTabsStore((state) => state.openFile);

  useEffect(() => {
    void reset(root);
  }, [root, reset]);

  const statusByPath = useMemo(() => {
    const map = new Map<string, FileStatusCode>();
    for (const file of status?.files ?? []) {
      map.set(file.path.replace(/\\/g, '/'), fileStatusCode(file.index, file.worktree));
    }
    return map;
  }, [status]);

  const rootEntries = entries[root];

  const renderRows = (directory: string, depth: number): ReactNode[] => {
    const list = entries[directory];
    if (!list) return [];

    const rows: ReactNode[] = [];

    for (const entry of list) {
      const relative = entry.path
        .slice(root.length)
        .replace(/^[/\\]/, '')
        .replace(/\\/g, '/');
      const code = entry.isDir ? null : statusByPath.get(relative) ?? null;
      const isOpen = !!expanded[entry.path];

      rows.push(
        <button
          key={entry.path}
          className={styles.row}
          style={{ paddingLeft: 8 + depth * 13 }}
          onClick={() =>
            entry.isDir ? void toggleDir(entry) : openFile(entry.path)
          }
          title={relative}
        >
          {entry.isDir ? (
            <ChevronIcon
              size={9}
              className={styles.chevron}
              style={{
                transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
              }}
            />
          ) : (
            <span className={styles.chevronSpacer} />
          )}
          {entry.isDir ? (
            isOpen ? (
              <FolderOpenIcon size={13} className={styles.folderIcon} />
            ) : (
              <FolderIcon size={13} className={styles.folderIcon} />
            )
          ) : (
            <FileIcon size={13} className={styles.fileIcon} />
          )}
          <span className={styles.name}>{entry.name}</span>
          {entry.isSymlink ? <span className={styles.symlink}>↗</span> : null}
          {code ? (
            <span className={styles.code} style={{ color: fileStatusColor(code) }}>
              {code}
            </span>
          ) : null}
        </button>,
      );

      if (entry.isDir && isOpen) {
        if (loading[entry.path] && !entries[entry.path]) {
          rows.push(
            <div
              key={`${entry.path}-loading`}
              className={styles.loading}
              style={{ paddingLeft: 21 + depth * 13 }}
            >
              读取中…
            </div>,
          );
        }
        rows.push(...renderRows(entry.path, depth + 1));
      }
    }

    return rows;
  };

  return (
    <div className={styles.tree}>
      <div className={styles.treeTop}>
        <span className={styles.treeLabel}>文件</span>
        <IconButton label="刷新文件树" onClick={() => void refresh()}>
          <RefreshIcon size={13} />
        </IconButton>
      </div>

      {error ? (
        <div className={styles.error}>
          <span>{error}</span>
          <button className={styles.retry} onClick={() => void refresh()}>
            重试
          </button>
        </div>
      ) : null}

      {!rootEntries && !error ? (
        <div className={styles.loading}>读取文件树…</div>
      ) : null}

      {rootEntries && rootEntries.length === 0 ? (
        <div className={styles.loading}>没有可显示的文件</div>
      ) : null}

      <div className={styles.rows}>{rootEntries ? renderRows(root, 0) : null}</div>
    </div>
  );
}

export type { FileEntry };
