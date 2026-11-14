import { Fragment } from 'react';
import { DiffIcon } from '@/components/icons';
import { highlightLine } from '@/lib/highlight';
import type { DiffFile, DiffRow } from '@/lib/types';
import { languageForPath } from './language';
import styles from './DiffView.module.css';

interface DiffViewProps {
  files: DiffFile[];
  loading?: boolean;
  error?: string | null;
  emptyText?: string;
  compact?: boolean;
}

const STATUS_LABEL: Record<DiffFile['status'], string> = {
  added: '新增',
  modified: '修改',
  deleted: '删除',
  renamed: '重命名',
  untracked: '未跟踪',
};

export function DiffView({
  files,
  loading = false,
  error = null,
  emptyText = '工作区干净，没有可显示的差异。',
  compact = false,
}: DiffViewProps) {
  if (loading) {
    return <div className={styles.state}>读取差异…</div>;
  }

  if (error) {
    return <div className={styles.state}>{error}</div>;
  }

  if (files.length === 0) {
    return <div className={styles.state}>{emptyText}</div>;
  }

  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);

  return (
    <div className={[styles.root, compact ? styles.compact : ''].filter(Boolean).join(' ')}>
      <div className={styles.summary}>
        <span>{files.length} 个文件</span>
        <span className={styles.addCount}>+{additions}</span>
        <span className={styles.delCount}>−{deletions}</span>
      </div>

      {files.map((file) => {
        const language = languageForPath(file.path);
        return (
          <section className={styles.file} key={`${file.oldPath ?? ''}-${file.path}`}>
            <div className={styles.fileHead}>
              <DiffIcon size={12} className={styles.fileIcon} />
              <span className={styles.filePath}>{file.path}</span>
              {file.oldPath ? (
                <span className={styles.oldPath}>← {file.oldPath}</span>
              ) : null}
              <span className={styles.status}>{STATUS_LABEL[file.status] ?? file.status}</span>
              <span className={styles.fileStat}>
                <span className={styles.addCount}>+{file.additions}</span>
                <span className={styles.delCount}>−{file.deletions}</span>
              </span>
            </div>

            {file.binary ? (
              <div className={styles.binary}>二进制文件，无法显示逐行差异。</div>
            ) : (
              file.hunks.map((hunk, hunkIndex) => (
                <Fragment key={`${file.path}-hunk-${hunkIndex}`}>
                  <div className={styles.hunk}>{hunk.header}</div>
                  {hunk.rows.map((row, rowIndex) => (
                    <DiffLine
                      key={`${file.path}-${hunkIndex}-${rowIndex}`}
                      row={row}
                      language={language}
                    />
                  ))}
                </Fragment>
              ))
            )}
          </section>
        );
      })}
    </div>
  );
}

function DiffLine({ row, language }: { row: DiffRow; language: string }) {
  if (row.kind === 'meta') {
    return <div className={styles.meta}>{row.text}</div>;
  }

  const sign = row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : '';
  const tokens = highlightLine(row.text, language);

  return (
    <div
      className={[
        styles.row,
        row.kind === 'add' ? styles.add : '',
        row.kind === 'del' ? styles.del : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <span className={styles.oldNo}>{row.oldNo || ''}</span>
      <span className={styles.newNo}>{row.newNo || ''}</span>
      <span
        className={[
          styles.sign,
          row.kind === 'add' ? styles.signAdd : '',
          row.kind === 'del' ? styles.signDel : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {sign}
      </span>
      <span className={styles.code}>
        {tokens.map((token, index) => (
          <span key={index} className={styles[token.kind]}>
            {token.text}
          </span>
        ))}
      </span>
    </div>
  );
}
