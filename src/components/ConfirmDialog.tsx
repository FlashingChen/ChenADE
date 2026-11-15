import { useEffect } from 'react';
import { useConfirmStore } from '@/lib/confirm';
import { Button } from './Button';
import styles from './ConfirmDialog.module.css';

/**
 * 应用内确认框。挂在 AppShell 里，由 `confirmAction()` 唤起。
 * 键盘：Esc = 取消，Enter = 确认；点遮罩 = 取消。
 */
export function ConfirmDialog() {
  const request = useConfirmStore((state) => state.request);
  const settle = useConfirmStore((state) => state.settle);

  useEffect(() => {
    if (!request) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        settle(false);
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        settle(true);
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [request, settle]);

  if (!request) return null;

  return (
    <div
      className={styles.backdrop}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) settle(false);
      }}
    >
      <div
        className={styles.panel}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
      >
        <h2 className={styles.title} id="confirm-title">
          {request.title}
        </h2>
        <p className={styles.message} id="confirm-message">
          {request.message}
        </p>
        <div className={styles.actions}>
          <Button size="sm" variant="secondary" onClick={() => settle(false)} autoFocus>
            {request.cancelLabel}
          </Button>
          <Button
            size="sm"
            variant={request.danger ? 'danger' : 'primary'}
            onClick={() => settle(true)}
          >
            {request.confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
