import type { ReactNode } from 'react';
import styles from './EmptyState.module.css';

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description: string;
  actions?: ReactNode;
  compact?: boolean;
}

export function EmptyState({ icon, title, description, actions, compact = false }: EmptyStateProps) {
  return (
    <div className={[styles.root, compact ? styles.compact : ''].filter(Boolean).join(' ')}>
      <div className={styles.icon}>{icon}</div>
      <h2 className={styles.title}>{title}</h2>
      <p className={styles.description}>{description}</p>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  );
}
