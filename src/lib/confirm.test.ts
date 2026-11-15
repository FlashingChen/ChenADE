import { describe, expect, it } from 'vitest';
import { confirmAction, useConfirmStore } from './confirm';

describe('confirmAction', () => {
  it('确认后 resolve true，取消后 resolve false', async () => {
    const first = confirmAction('删除？');
    expect(useConfirmStore.getState().request?.message).toBe('删除？');
    useConfirmStore.getState().settle(true);
    await expect(first).resolves.toBe(true);

    const second = confirmAction('再删一次？');
    useConfirmStore.getState().settle(false);
    await expect(second).resolves.toBe(false);
    expect(useConfirmStore.getState().request).toBeNull();
  });

  it('新确认会把未决的旧确认按取消收尾，避免 promise 悬空', async () => {
    const stale = confirmAction('旧确认');
    const fresh = confirmAction('新确认');
    await expect(stale).resolves.toBe(false);
    expect(useConfirmStore.getState().request?.message).toBe('新确认');
    useConfirmStore.getState().settle(true);
    await expect(fresh).resolves.toBe(true);
  });

  it('默认按钮文案与危险色', () => {
    void confirmAction('危险操作');
    const request = useConfirmStore.getState().request;
    expect(request?.confirmLabel).toBe('继续');
    expect(request?.cancelLabel).toBe('取消');
    expect(request?.danger).toBe(true);
    useConfirmStore.getState().settle(false);
  });
});
