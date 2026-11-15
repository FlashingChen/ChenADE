/**
 * 终端字体加载与解析。
 *
 * 为什么必须等字体就绪：xterm 在构造/首次 open 时用 canvas 或 DOM 实测字符格尺寸，
 * 字体还没下载完就会按回退字体测量，宽度缓存一旦烧进去，后续只能重建终端才能纠正；
 * 表现出来就是“字距不对 / 换行位置不对 / 列数多一截”。
 */

/** 首选 Sarasa Mono SC：ASCII 0.5 em、CJK 1.0 em，汉字字面宽度正好两个字符格。 */
export const TERMINAL_FONT_FAMILY =
  "'Sarasa Mono SC', 'Maple Mono NF CN', 'JetBrains Mono', Menlo, Monaco, 'Cascadia Code', monospace";

const PRIMARY_FONT = 'Sarasa Mono SC';
const PROBE_TEXT = '中文W中';

let ready: Promise<void> | null = null;

export function ensureTerminalFont(): Promise<void> {
  if (ready) return ready;

  ready = (async () => {
    if (typeof document === 'undefined' || !document.fonts) return;
    try {
      // 显式带上要用的字形，避免只加载 Latin 子集。
      await document.fonts.load(`12px "${PRIMARY_FONT}"`, PROBE_TEXT);
      await document.fonts.ready;
    } catch {
      // 字体缺失/加载失败时继续用回退字体，不阻断终端启动。
    }
  })();

  return ready;
}
