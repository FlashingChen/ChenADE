import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import '@xterm/xterm/css/xterm.css';
import type { Tab } from '@/features/tabs/store';
import { useSettingsStore } from '@/features/settings/store';
import {
  disposeTerminalSession,
  getTerminalSession,
  type TerminalSession,
} from './session';

/**
 * 终端实例常驻注册表。
 *
 * 为什么不让 React 持有 Terminal：PTY 输出流与 xterm 缓冲区是“长生命周期”状态，
 * 而界面是“短生命周期”的（切标签、切工作树都会卸载 pane）。以前每次卸载都 dispose
 * Terminal，再把最近 300 个 chunk 原样重放进新实例——那段尾巴的起点几乎必然落在
 * 某一帧/某个转义序列中间，重放出来的画面是错的，而全屏 TUI 只重画变化的行，
 * 错位字符就永久留在屏幕上（见 docs/09-terminal-artifacts.md 第 3 节）。
 *
 * 现在 Terminal 按 tabId 常驻：卸载只把 xterm 的 DOM 节点摘下来，重新挂载时再放回去，
 * 缓冲区、滚动位置、渲染器全部原地复用，不再有 truncate + replay。
 */

type TerminalTab = Extract<Tab, { kind: 'terminal' }>;

const THEME: ITheme = {
  background: '#0b0c0e',
  foreground: '#d2d2d7',
  cursor: '#b5e655',
  cursorAccent: '#0b0c0e',
  selectionBackground: 'rgba(181, 230, 85, 0.28)',
  black: '#1e1f23',
  red: '#ff8a5c',
  green: '#b5e655',
  yellow: '#f7c548',
  blue: '#5fd0be',
  magenta: '#c792ea',
  cyan: '#5fd0be',
  white: '#e9e9ec',
  brightBlack: '#6e6e76',
  brightRed: '#ffa07a',
  brightGreen: '#c8f07a',
  brightYellow: '#ffd97a',
  brightBlue: '#7ee0d2',
  brightMagenta: '#d6a8ff',
  brightCyan: '#7ee0d2',
  brightWhite: '#ffffff',
};

/**
 * SF Mono（ui-monospace 在 macOS 的解析结果）画 box-drawing 有缝隙；
 * Maple Mono NF CN 的 CJK advance 正好是 ASCII 的 2.0 倍（实测 1200/600），
 * 是这套 TUI（中文 + 制表符）里最不容易错格的等宽字体。
 */
const FONT_FAMILY =
  "'Maple Mono NF CN', 'Maple Mono NF', 'JetBrains Mono', Menlo, Monaco, Hack, 'Cascadia Code', 'Noto Sans Mono', monospace";

export interface TerminalEntry {
  term: Terminal;
  fit: FitAddon;
  search: SearchAddon;
  session: TerminalSession;
}

interface ManagedTerminal extends TerminalEntry {
  opened: boolean;
  disposers: Array<() => void>;
}

const managed = new Map<string, ManagedTerminal>();

function createManaged(tab: TerminalTab): ManagedTerminal {
  const session = getTerminalSession(tab.id, tab.cwd, tab.initialCommand);
  const { terminalFontSize } = useSettingsStore.getState().settings;
  const term = new Terminal({
    cursorBlink: true,
    cursorStyle: 'block',
    fontFamily: FONT_FAMILY,
    fontSize: terminalFontSize,
    // 与字体自然行盒（实测 1.32 em）的差值决定 box-drawing 是否跨行连续；
    // 1 是 DOM renderer 下让竖线跨行闭合的取值（见 04-delivery「终端字形连续性」）。
    lineHeight: 1,
    scrollback: 10000,
    theme: THEME,
    allowProposedApi: true,
    macOptionIsMeta: true,
  });

  const fit = new FitAddon();
  const search = new SearchAddon();
  term.loadAddon(fit);
  term.loadAddon(search);

  // 宽度表：xterm 5.5 内核只带 Unicode 6.3，会把 emoji/新符号按 1 格排版，
  // 而 TUI 侧（string-width / east-asian-width）按 Unicode 9+ 算 2 格，
  // 口径不一致就会“字压字 + 行尾残留”。必须 loadAddon 之后再设 activeVersion，
  // 且必须在任何 write 之前完成，否则错误宽度会烧进缓冲区。
  term.loadAddon(new Unicode11Addon());
  term.unicode.activeVersion = '11';

  // 先订阅再写数据：回放/首帧引起的 resize 必须能落到 session 上。
  const offSessionData = session.onData((chunk) => {
    term.write(chunk);
  });
  const offTermData = term.onData((data) => session.write(data));
  const offTermResize = term.onResize(({ cols, rows }) => session.resize(cols, rows));

  const disposers: Array<() => void> = [
    // 先摘数据订阅，再销毁 Terminal，避免往已销毁实例里写。
    offSessionData,
    () => offTermData.dispose(),
    () => offTermResize.dispose(),
    () => term.dispose(),
  ];

  // 只有在“会话还在、终端实例却是新建”的情况下才会有历史 chunk（例如异常重建）。
  // 先打一个确定的基线（复位 SGR + 清屏 + 归位），再回放，避免继承旧属性/旧画面。
  term.write('\x1b[0m\x1b[2J\x1b[H');
  for (const chunk of session.getBuffer()) term.write(chunk);

  return { term, fit, search, session, opened: false, disposers };
}

/** 把终端挂到给定容器；首次挂载时创建并 open，之后只搬 DOM 节点。 */
export function attachTerminal(tab: TerminalTab, container: HTMLElement): TerminalEntry {
  let entry = managed.get(tab.id);
  if (!entry) {
    entry = createManaged(tab);
    managed.set(tab.id, entry);
  }

  if (!entry.opened) {
    entry.term.open(container);
    entry.opened = true;
  } else if (entry.term.element && entry.term.element.parentElement !== container) {
    container.appendChild(entry.term.element);
  }

  return entry;
}

/** 卸载时只摘掉 DOM 节点，实例与缓冲区保留，PTY 输出继续写入。 */
export function detachTerminal(tabId: string): void {
  const entry = managed.get(tabId);
  if (!entry) return;
  entry.term.element?.remove();
}

export function peekTerminalEntry(tabId: string): TerminalEntry | undefined {
  return managed.get(tabId);
}

/** 容器尺寸变化后重算行列；未挂载/未布局时静默跳过。 */
export function fitTerminal(tabId: string): void {
  const entry = managed.get(tabId);
  if (!entry || !entry.opened) return;
  try {
    entry.fit.fit();
  } catch {
    // 容器尚未完成布局，或 pane 正在被工作树切换销毁。
  }
}

/**
 * 改字号不重建终端：只改选项再重新 fit。
 * 重建会触发 truncate + replay（旧的残影来源），且丢掉滚动位置。
 */
export function setTerminalFontSize(tabId: string, fontSize: number): void {
  const entry = managed.get(tabId);
  if (!entry) return;
  if (entry.term.options.fontSize === fontSize) {
    fitTerminal(tabId);
    return;
  }
  entry.term.options.fontSize = fontSize;
  fitTerminal(tabId);
}

export function setTerminalLineHeight(tabId: string, lineHeight: number): void {
  const entry = managed.get(tabId);
  if (!entry) return;
  entry.term.options.lineHeight = lineHeight;
  fitTerminal(tabId);
}

/** 关标签/关全部时才会走到这里：销毁实例，再销毁 PTY 会话。 */
export function disposeTerminalTab(tabId: string): void {
  const entry = managed.get(tabId);
  if (entry) {
    entry.term.element?.remove();
    for (const dispose of entry.disposers) {
      try {
        dispose();
      } catch {
        // dispose 期间的异常不该阻断关标签流程。
      }
    }
    managed.delete(tabId);
  }
  disposeTerminalSession(tabId);
}
