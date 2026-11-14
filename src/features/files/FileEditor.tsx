import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type UIEvent as ReactUIEvent,
} from 'react';
import { useAppStore } from '@/app/store';
import { useSettingsStore } from '@/features/settings/store';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { FileIcon, FolderOpenIcon } from '@/components/icons';
import { call, toAppError } from '@/lib/ipc';
import type { FileContent, WriteResult } from '@/lib/types';
import styles from './FileEditor.module.css';

const MAX_GUTTER_LINES = 5000;
const TAB = '  ';

interface FileEditorProps {
  root: string;
  path: string;
  onSaved?: (result: WriteResult) => void;
}

function countLines(value: string): number {
  let count = 1;
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 10) count += 1;
  }
  return count;
}

function isWritableEncoding(encoding: string): boolean {
  const normalized = encoding.trim().toLowerCase().replace(/[_-]/g, '');
  if (!normalized) return true;
  return normalized === 'utf8';
}

function relativePath(root: string, path: string): string {
  if (!root) return path;
  const base = root.replace(/[\\/]+$/, '');
  if (!base) return path;
  if (path === base) return path;
  if (path.startsWith(`${base}/`) || path.startsWith(`${base}\\`)) {
    return path.slice(base.length + 1);
  }
  return path;
}

export function FileEditor({ root, path, onSaved }: FileEditorProps) {
  const notify = useAppStore((state) => state.notify);
  const defaultEditor = useSettingsStore((state) => state.settings.defaultEditor);

  const [file, setFile] = useState<FileContent | null>(null);
  const [text, setText] = useState('');
  const [baseline, setBaseline] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLPreElement>(null);
  const loadTokenRef = useRef(0);

  useEffect(() => {
    loadTokenRef.current += 1;
    const token = loadTokenRef.current;
    let cancelled = false;

    setLoading(true);
    setLoadError(null);
    setSaveError(null);
    setSaving(false);
    setFile(null);
    setText('');
    setBaseline('');

    call<FileContent>('files_read', { root, path })
      .then((content) => {
        if (cancelled || token !== loadTokenRef.current) return;
        setFile(content);
        setText(content.content);
        setBaseline(content.content);
        setLoading(false);
      })
      .catch((cause) => {
        if (cancelled || token !== loadTokenRef.current) return;
        setLoadError(toAppError(cause).message);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [root, path, reloadKey]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) textarea.scrollTop = 0;
    const gutter = gutterRef.current;
    if (gutter) gutter.style.transform = 'translateY(0px)';
  }, [file]);

  const lineCount = useMemo(() => countLines(text), [text]);
  const charCount = text.length;
  const dirty = file !== null && text !== baseline;

  const readOnlyReason = file
    ? file.truncated
      ? '文件内容被截断，保存会覆盖未加载的部分，请使用外部编辑器修改。'
      : !isWritableEncoding(file.encoding)
        ? `编码为 ${file.encoding}，请在外部编辑器中修改。`
        : null
    : null;
  const readOnly = readOnlyReason !== null;

  const save = useCallback(async () => {
    if (saving || !file || readOnly || text === baseline) return;

    const token = loadTokenRef.current;
    const payload = text;
    setSaving(true);
    setSaveError(null);

    try {
      const result = await call<WriteResult>('files_write', {
        root,
        path,
        content: payload,
      });

      if (loadTokenRef.current === token) {
        setBaseline(payload);
        notify('已保存', 'success');
      }
      onSaved?.(result);
    } catch (cause) {
      if (loadTokenRef.current === token) {
        const message = toAppError(cause).message;
        setSaveError(message);
        notify(message, 'error');
      }
    } finally {
      if (loadTokenRef.current === token) setSaving(false);
    }
  }, [baseline, file, notify, onSaved, path, readOnly, root, saving, text]);

  useEffect(() => {
    const handler = (event: globalThis.KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      void save();
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [save]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Tab' || event.shiftKey || readOnly) return;

    event.preventDefault();
    const textarea = event.currentTarget;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const next = `${text.slice(0, start)}${TAB}${text.slice(end)}`;
    setText(next);
    setSaveError(null);

    requestAnimationFrame(() => {
      const node = textareaRef.current;
      if (!node) return;
      node.selectionStart = start + TAB.length;
      node.selectionEnd = start + TAB.length;
    });
  };

  const handleScroll = (event: ReactUIEvent<HTMLTextAreaElement>) => {
    const gutter = gutterRef.current;
    if (gutter) {
      gutter.style.transform = `translateY(-${event.currentTarget.scrollTop}px)`;
    }
  };

  const openExternal = async () => {
    try {
      await call('files_open_external', { root, path, editor: defaultEditor ?? undefined });
    } catch (cause) {
      notify(toAppError(cause).message, 'error');
    }
  };

  const relative = relativePath(root, path);
  const crumbs = relative.split(/[\\/]/).filter(Boolean);

  const gutterText = useMemo(() => {
    const visible = Math.min(lineCount, MAX_GUTTER_LINES);
    const numbers: string[] = [];
    for (let line = 1; line <= visible; line += 1) numbers.push(String(line));
    return numbers.join('\n');
  }, [lineCount]);

  const gutterDigits = String(Math.min(lineCount, MAX_GUTTER_LINES)).length;
  const gutterStyle = {
    width: `calc(${Math.max(3, gutterDigits)}ch + 26px)`,
  };

  const status = readOnly
    ? { label: '只读', className: styles.statusReadonly }
    : saving
      ? { label: '保存中…', className: styles.statusSaving }
      : dirty
        ? { label: '已修改', className: styles.statusDirty }
        : { label: '已保存', className: styles.statusSaved };

  return (
    <div className={styles.editor}>
      <div className={styles.toolbar}>
        <FolderOpenIcon size={12} className={styles.folderIcon} />
        <div className={styles.crumbs} title={relative}>
          {crumbs.map((crumb, index) => (
            <span key={`${crumb}-${index}`} className={styles.crumb}>
              {crumb}
              {index < crumbs.length - 1 ? <span className={styles.sep}>/</span> : null}
            </span>
          ))}
        </div>

        {file ? (
          <>
            <span className={`${styles.meta} ${styles.language}`}>
              {file.language || 'Text'}
            </span>
            <span className={`${styles.meta} ${styles.encoding}`}>{file.encoding}</span>
            <span
              className={`${styles.meta} ${styles.counts}`}
              title={lineCount > MAX_GUTTER_LINES ? '行号仅显示前 5000 行' : undefined}
            >
              {lineCount} 行 · {charCount} 字符
            </span>
            <span
              className={`${styles.status} ${status.className}`}
              title={readOnlyReason ?? undefined}
              aria-live="polite"
            >
              {status.label}
            </span>
          </>
        ) : null}

        <Button
          size="sm"
          variant="ghost"
          onClick={() => void openExternal()}
          title="在外部编辑器中打开"
        >
          外部打开
        </Button>
        <Button
          size="sm"
          variant="primary"
          onClick={() => void save()}
          disabled={!dirty || saving || readOnly}
          title="保存 (⌘/Ctrl+S)"
        >
          {saving ? '保存中…' : '保存'}
        </Button>
      </div>

      {file && readOnlyReason ? (
        <div className={styles.notice}>只读 · {readOnlyReason}</div>
      ) : null}

      {saveError ? (
        <div className={`${styles.notice} ${styles.saveError}`} role="alert">
          保存失败：{saveError}
        </div>
      ) : null}

      {loading ? <div className={styles.state}>读取文件…</div> : null}

      {!loading && loadError ? (
        <EmptyState
          compact
          icon={<FileIcon size={18} />}
          title="无法打开这个文件"
          description={loadError}
          actions={
            <>
              <Button size="sm" onClick={() => setReloadKey((key) => key + 1)}>
                重新读取
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void openExternal()}>
                在编辑器中打开
              </Button>
            </>
          }
        />
      ) : null}

      {!loading && file ? (
        <div className={styles.body}>
          <div className={styles.gutter} style={gutterStyle} aria-hidden="true">
            <pre ref={gutterRef} className={styles.gutterInner}>
              {gutterText}
            </pre>
          </div>
          <textarea
            ref={textareaRef}
            className={styles.textarea}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              if (saveError) setSaveError(null);
            }}
            onKeyDown={handleKeyDown}
            onScroll={handleScroll}
            readOnly={readOnly}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            wrap="off"
            aria-label={`编辑 ${relative}`}
          />
        </div>
      ) : null}
    </div>
  );
}
