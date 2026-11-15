import { describe, expect, it } from 'vitest';
import { computeGrid } from './registry';

/**
 * 守 docs/10-fixes-2026-11-15.md 第 2 节的缺陷：可用宽度必须已经扣掉面板 padding
 * 与滚动条，否则列数会多算 2–3 列，TUI 的输入框右边线被推到面板外。
 */
describe('computeGrid', () => {
  it('按字符格向下取整，不越界', () => {
    // 1210px 内容盒 / 7.2px 字符格 = 168.05 → 168 列（第 169 列会压到边界）
    expect(computeGrid({ width: 1210, height: 690 }, { width: 7.2, height: 15 })).toEqual({
      cols: 168,
      rows: 46,
    });
  });

  it('少算一列也比多算安全：刚好整除时不额外加列', () => {
    expect(computeGrid({ width: 720, height: 600 }, { width: 7.2, height: 15 })).toEqual({
      cols: 100,
      rows: 40,
    });
  });

  it('容器或字符格没有尺寸时返回 null，避免把 0 列写进 PTY', () => {
    expect(computeGrid({ width: 0, height: 600 }, { width: 7.2, height: 15 })).toBeNull();
    expect(computeGrid({ width: 720, height: 0 }, { width: 7.2, height: 15 })).toBeNull();
    expect(computeGrid({ width: 720, height: 600 }, { width: 0, height: 15 })).toBeNull();
  });

  it('极端小容器也保留最小 2×2', () => {
    expect(computeGrid({ width: 5, height: 5 }, { width: 7.2, height: 15 })).toEqual({
      cols: 2,
      rows: 2,
    });
  });
});
