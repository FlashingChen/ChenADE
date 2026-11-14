import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '@/app/store';
import { useSettingsStore } from '@/features/settings/store';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { FileIcon, FolderOpenIcon } from '@/components/icons';
import { call, toAppError } from '@/lib/ipc';
import { highlightLine } from '@/lib/highlight';
import type { FileContent } from '@/lib/types';
import styles from './CodeViewer.module.css';

const MAX_LINES = 5000;

export function CodeViewer({ root, path }: { root: string; path: string }) {
  const notify = useAppStore((state) => state.notify);
  const defaultEditor = useSettingsStore((state) => state.settings.defaultEditor);
  const [file, setFile] = useState<FileContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setFile(null);

    call<FileContent>('files_read', { root, path })
      .then((content) => {
        if (!cancelled) {
          setFile(content);
          setLoading(false);
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(toAppError(cause).message);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [root, path]);

  const lines = useMemo(() => {
    if (!file) return [];
    const all = file.content.split('\n');
    const limited = all.slice(0, MAX_LINES);
    return limited.map((line, index) => ({
      number: index + 1,
      tokens: highlightLine(line, file.language),
    }));
  }, [file]);

  const relative = path.startsWith(root)
    ? path.slice(root.length).replace(/^[/\\]/, '')
    : path;
  const crumbs = relative.split('/').filter(Boolean);

  const openExternal = async () => {
    try {
      await call('files_open_external', { root, path, editor: defaultEditor ?? undefined });
    } catch (cause) {
      notify(toAppError(cause).message, 'error');
    }
  };

  return (
    <div className={styles.viewer}>
      <div className={styles.toolbar}>
        <FolderOpenIcon size={12} className={styles.folderIcon} />
        <div className={styles.crumbs}>
          {crumbs.map((crumb, index) => (
            <span key={`${crumb}-${index}`} className={styles.crumb}>
              {crumb}
              {index < crumbs.length - 1 ? <span className={styles.sep}>/</span> : null}
            </span>
          ))}
        </div>
        <span className={styles.meta}>{file?.language ?? 'Text'}</span>
        <span className={styles.readonly}>只读</span>
        <Button size="sm" variant="ghost" onClick={() => void openExternal()}>
          在编辑器中打开
        </Button>
      </div>

      {loading ? <div className={styles.state}>读取文件…</div> : null}

      {!loading && error ? (
        <EmptyState
          compact
          icon={<FileIcon size={18} />}
          title="无法预览这个文件"
          description={error}
          actions={
            <Button size="sm" onClick={() => void openExternal()}>
              在编辑器中打开
            </Button>
          }
        />
      ) : null}

      {!loading && file ? (
        <div className={styles.scroll}>
          <div className={styles.code}>
            {lines.map((line) => (
              <div className={styles.line} key={line.number}>
                <span className={styles.lineNumber}>{line.number}</span>
                <span className={styles.source}>
                  {line.tokens.map((token, index) => (
                    <span
                      key={`${line.number}-${index}`}
                      className={styles[token.kind]}
                    >
                      {token.text}
                    </span>
                  ))}
                </span>
              </div>
            ))}
            {file.content.split('\n').length > MAX_LINES ? (
              <div className={styles.truncated}>
                文件较长，已显示前 {MAX_LINES} 行。请使用外部编辑器查看完整内容。
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
