import { describe, expect, it } from 'vitest';
import { TerminalSession } from './session';

/**
 * 这几个用例守的是 docs/09-terminal-artifacts.md 第 3.3 节那个缺陷：
 * 终端还没布局好就用默认 80×24 起 PTY，全屏 TUI 会先按 80 列 flush 一帧，
 * 而 flush 进 scrollback 的内容之后不会再被重画。
 */
describe('TerminalSession 尺寸准备', () => {
  it('默认是 80×24，prepareSize 会覆盖成已布局好的行列', () => {
    const session = new TerminalSession('t-test', '/tmp');
    expect([session.cols, session.rows]).toEqual([80, 24]);

    session.prepareSize(117, 46);

    expect([session.cols, session.rows]).toEqual([117, 46]);
  });

  it('prepareSize 忽略无效尺寸，不会把 0 列写进 session', () => {
    const session = new TerminalSession('t-test', '/tmp');

    session.prepareSize(0, 46);
    session.prepareSize(117, 1);

    expect([session.cols, session.rows]).toEqual([80, 24]);
  });

  it('resize 在未 spawn 时只记录尺寸，不发 IPC', () => {
    const session = new TerminalSession('t-test', '/tmp');

    session.resize(100, 30);

    expect([session.cols, session.rows]).toEqual([100, 30]);
    expect(session.sessionId).toBeNull();
  });
});
