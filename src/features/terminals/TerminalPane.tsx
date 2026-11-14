import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { SearchAddon } from '@xterm/addon-search';
import { Button } from '@/components/Button';
import { SearchIcon, XIcon } from '@/components/icons';
import { useSettingsStore } from '@/features/settings/store';
import type { Tab } from '@/features/tabs/store';
import {
  attachTerminal,
  detachTerminal,
  fitTerminal,
  setTerminalFontSize,
} from './registry';
import type { TerminalSession, TerminalState } from './session';
import styles from './TerminalPane.module.css';

export function TerminalPane({ tab }: { tab: Extract<Tab, { kind: 'terminal' }> }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<TerminalSession | null>(null);
  const [state, setState] = useState<TerminalState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<SearchAddon | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const fontSize = useSettingsStore((state) => state.settings.terminalFontSize);

  // 挂载：接上常驻的终端实例（首次挂载才会创建），卸载只摘 DOM。
  // fontSize 故意不在依赖里：改字号走下面那个 effect，不能重建终端。
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const entry = attachTerminal(tab, container);
    sessionRef.current = entry.session;
    termRef.current = entry.term;
    searchRef.current = entry.search;
    setState(entry.session.state);
    setError(entry.session.error);
    // 对齐当前设置的字体（实例可能在设置变更之前就已经创建）
    setTerminalFontSize(tab.id, useSettingsStore.getState().settings.terminalFontSize);

    const offState = entry.session.onState(() => {
      setState(entry.session.state);
      setError(entry.session.error);
    });

    fitTerminal(tab.id);
    const frame = requestAnimationFrame(() => {
      // 等到布局完成再 fit：容器此刻才有确定尺寸。
      fitTerminal(tab.id);
      entry.term.focus();
      if (tab.autoStart && entry.session.state === 'idle') {
        // 用已经布局好的行列起进程：默认的 80×24 会让全屏 TUI 先按 80 列 flush
        // 一帧，而 flush 进 scrollback 的内容之后不会再重画（docs/09 第 3.3 节）。
        entry.session.prepareSize(entry.term.cols, entry.term.rows);
        void entry.session.start().then(() => fitTerminal(tab.id));
      }
    });

    const resizeObserver = new ResizeObserver(() => fitTerminal(tab.id));
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      offState();
      // 只把 xterm 的 DOM 节点摘下来：实例、缓冲区、PTY 全部保留，
      // 切回来时原地复用，不再走「截断重放」。
      detachTerminal(tab.id);
      sessionRef.current = null;
      termRef.current = null;
      searchRef.current = null;
    };
  }, [tab.id, tab.cwd, tab.autoStart]);

  // 改字号：只改选项 + 重新 fit，不销毁/重建（重建会 replay，且丢滚动位置）。
  useEffect(() => {
    setTerminalFontSize(tab.id, fontSize);
  }, [fontSize, tab.id]);

  const restart = () => {
    const session = sessionRef.current;
    const term = termRef.current;
    if (!session || !term) return;
    // 先把当前布局的行列同步给 session，再起进程（同首次挂载的理由）。
    fitTerminal(tab.id);
    session.prepareSize(term.cols, term.rows);
    void session.start();
  };

  const find = (direction: 1 | -1) => {
    const value = query.trim();
    if (!value) return;
    if (direction === 1) searchRef.current?.findNext(value);
    else searchRef.current?.findPrevious(value);
  };

  const handleKeyDownCapture = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      event.stopPropagation();
      setSearchOpen(true);
      requestAnimationFrame(() => searchInputRef.current?.focus());
    }
  };

  return (
    <div className={styles.wrap} onKeyDownCapture={handleKeyDownCapture}>
      <div className={styles.terminal} ref={containerRef} />

      {searchOpen ? (
        <div className={styles.searchBar}>
          <SearchIcon size={12} />
          <input
            ref={searchInputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              if (event.target.value) searchRef.current?.findNext(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                find(event.shiftKey ? -1 : 1);
              }
              if (event.key === 'Escape') {
                setSearchOpen(false);
                termRef.current?.focus();
              }
            }}
            placeholder="搜索终端输出"
            aria-label="搜索终端输出"
          />
          <button className={styles.searchButton} aria-label="上一个" onClick={() => find(-1)}>
            ↑
          </button>
          <button className={styles.searchButton} aria-label="下一个" onClick={() => find(1)}>
            ↓
          </button>
          <button
            className={styles.searchButton}
            aria-label="关闭搜索"
            onClick={() => {
              setSearchOpen(false);
              termRef.current?.focus();
            }}
          >
            <XIcon size={10} />
          </button>
        </div>
      ) : null}

      {state === 'starting' ? (
        <div className={styles.overlay}>
          <span className={styles.spinner} />
          正在启动终端…
        </div>
      ) : null}

      {state === 'idle' ? (
        <div className={styles.overlay}>
          <div className={styles.overlayTitle}>终端已恢复</div>
          <p className={styles.overlayText}>
            上次退出应用时这个终端已结束。重新启动会从当前工作树目录打开一个新的 shell。
          </p>
          <Button variant="primary" size="sm" onClick={restart}>
            启动终端
          </Button>
        </div>
      ) : null}

      {state === 'exited' ? (
        <div className={styles.overlay}>
          <div className={styles.overlayTitle}>终端已退出</div>
          <p className={styles.overlayText}>
            {sessionRef.current?.exitCode !== null &&
            sessionRef.current?.exitCode !== undefined
              ? `进程退出码 ${sessionRef.current.exitCode}`
              : 'shell 进程已结束'}
          </p>
          <Button variant="primary" size="sm" onClick={restart}>
            重新启动
          </Button>
        </div>
      ) : null}

      {state === 'error' ? (
        <div className={styles.overlay}>
          <div className={styles.overlayTitle}>终端启动失败</div>
          <p className={styles.overlayText}>{error ?? '未知错误'}</p>
          <Button variant="primary" size="sm" onClick={restart}>
            重试
          </Button>
        </div>
      ) : null}
    </div>
  );
}
