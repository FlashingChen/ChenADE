import type { ReactNode } from 'react';
import styles from './Pill.module.css';

type Tone = 'lime' | 'amber' | 'coral' | 'dim' | 'teal';

interface PillProps {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}

export function Pill({ tone = 'dim', children, className }: PillProps) {
  return (
    <span className={[styles.pill, styles[tone], className].filter(Boolean).join(' ')}>
      {children}
    </span>
  );
}
