import { useAppStore } from '@/app/store';
import { XIcon } from './icons';
import styles from './Toast.module.css';

export function ToastViewport() {
  const toast = useAppStore((state) => state.toast);
  const dismiss = useAppStore((state) => state.dismissToast);

  if (!toast) return null;

  return (
    <div className={styles.viewport} role="status" aria-live="polite">
      <div className={[styles.toast, styles[toast.tone]].join(' ')}>
        <span className={styles.dot} />
        <span className={styles.message}>{toast.message}</span>
        <button className={styles.close} aria-label="关闭提示" onClick={dismiss}>
          <XIcon size={11} />
        </button>
      </div>
    </div>
  );
}
