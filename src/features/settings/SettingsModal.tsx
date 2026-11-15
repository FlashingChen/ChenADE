import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/app/store';
import { Button } from '@/components/Button';
import { IconButton } from '@/components/IconButton';
import { XIcon } from '@/components/icons';
import { ensureTerminalBackend } from '@/features/terminals/backend';
import type { Settings, TmuxStatus } from '@/lib/types';
import { DEFAULT_SETTINGS, useSettingsStore } from './store';
import styles from './SettingsModal.module.css';

const FONT_SIZE_MIN = 8;
const FONT_SIZE_MAX = 32;

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const load = useSettingsStore((state) => state.load);
  const save = useSettingsStore((state) => state.save);
  const clearError = useSettingsStore((state) => state.clearError);
  const loading = useSettingsStore((state) => state.loading);
  const saving = useSettingsStore((state) => state.saving);
  const error = useSettingsStore((state) => state.error);
  const notify = useAppStore((state) => state.notify);
  const info = useAppStore((state) => state.info);

  const [draft, setDraft] = useState<Settings>({ ...DEFAULT_SETTINGS });
  const [fontSizeText, setFontSizeText] = useState(
    String(DEFAULT_SETTINGS.terminalFontSize),
  );
  const shellRef = useRef<HTMLInputElement>(null);
  const [backend, setBackend] = useState<TmuxStatus | null>(null);

  useEffect(() => {
    if (!open) return;
    void ensureTerminalBackend().then(setBackend);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const snapshot = useSettingsStore.getState().settings;
    setDraft(snapshot);
    setFontSizeText(String(snapshot.terminalFontSize));
    clearError();

    let cancelled = false;
    void load().then(() => {
      if (cancelled) return;
      const loaded = useSettingsStore.getState().settings;
      setDraft(loaded);
      setFontSizeText(String(loaded.terminalFontSize));
    });

    const frame = requestAnimationFrame(() => {
      shellRef.current?.focus();
      shellRef.current?.select();
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [open, load, clearError]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, saving, onClose]);

  if (!open) return null;

  const fontValue = Number(fontSizeText);
  const fontSizeValid =
    fontSizeText.trim().length > 0 &&
    Number.isInteger(fontValue) &&
    fontValue >= FONT_SIZE_MIN &&
    fontValue <= FONT_SIZE_MAX;

  const patch = (partial: Partial<Settings>) => {
    setDraft((current) => ({ ...current, ...partial }));
  };

  const commitFontSize = () => {
    const parsed = Number(fontSizeText);
    const next = Number.isFinite(parsed)
      ? Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(parsed)))
      : DEFAULT_SETTINGS.terminalFontSize;
    setDraft((current) => ({ ...current, terminalFontSize: next }));
    setFontSizeText(String(next));
  };

  const submit = async () => {
    if (saving) return;
    const next: Settings = {
      ...draft,
      terminalFontSize: fontSizeValid
        ? fontValue
        : DEFAULT_SETTINGS.terminalFontSize,
    };
    const ok = await save(next);
    if (!ok) return;
    notify('设置已保存', 'success');
    onClose();
  };

  return (
    <div
      className={styles.backdrop}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <form
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onSubmit={(event) => {
          event.preventDefault();
          if (!saving) void submit();
        }}
      >
        <div className={styles.header}>
          <div>
            <h2 id="settings-title">设置</h2>
            <p>终端、编辑器与界面偏好。设置保存在本地，切换工作树后保持不变。</p>
          </div>
          <IconButton label="关闭" onClick={onClose} disabled={saving}>
            <XIcon size={14} />
          </IconButton>
        </div>

        <div className={styles.body}>
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>终端</h3>

            <label className={styles.field}>
              <span className={styles.label}>默认 Shell</span>
              <input
                ref={shellRef}
                value={draft.terminalShell ?? ''}
                onChange={(event) => patch({ terminalShell: event.target.value || null })}
                placeholder="自动探测（$SHELL）"
                spellCheck={false}
                autoComplete="off"
              />
              <span className={styles.hint}>留空时按平台自动探测，例如 /bin/zsh</span>
            </label>

            <label className={styles.field}>
              <span className={styles.label}>字号</span>
              <div className={styles.fontRow}>
                <input
                  type="number"
                  min={FONT_SIZE_MIN}
                  max={FONT_SIZE_MAX}
                  step={1}
                  value={fontSizeText}
                  onChange={(event) => setFontSizeText(event.target.value)}
                  onBlur={commitFontSize}
                  aria-invalid={!fontSizeValid}
                />
                <span className={styles.hint}>
                  {FONT_SIZE_MIN}–{FONT_SIZE_MAX} px，仅影响新开终端
                </span>
              </div>
            </label>

            <div className={styles.field}>
              <span className={styles.label}>会话持久化</span>
              <span className={styles.hint}>
                {backend?.available
                  ? `${backend.version ?? 'tmux'} · 随包内置，关闭应用后终端仍在运行，重开自动重连（当前 ${backend.sessions} 个会话）`
                  : '未找到内置 tmux，回退普通 shell：关闭应用后终端进程不保留'}
              </span>
            </div>
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>编辑器</h3>

            <label className={styles.field}>
              <span className={styles.label}>默认编辑器命令</span>
              <input
                value={draft.defaultEditor ?? ''}
                onChange={(event) => patch({ defaultEditor: event.target.value || null })}
                placeholder="系统默认"
                spellCheck={false}
                autoComplete="off"
              />
              <span className={styles.hint}>
                例如 code、cursor；留空时使用系统默认程序打开文件
              </span>
            </label>
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>外观</h3>

            <label className={styles.field}>
              <span className={styles.label}>主题</span>
              <select
                value={draft.theme}
                onChange={(event) =>
                  patch({ theme: event.target.value === 'light' ? 'light' : 'dark' })
                }
              >
                <option value="dark">深色</option>
                <option value="light" disabled>
                  浅色（即将支持）
                </option>
              </select>
            </label>
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>行为</h3>

            <label className={styles.checkRow}>
              <input
                type="checkbox"
                checked={draft.confirmCloseTerminal}
                onChange={(event) =>
                  patch({ confirmCloseTerminal: event.target.checked })
                }
              />
              <span>
                关闭终端前确认
                <small>有进程运行时先弹确认，避免误关会话</small>
              </span>
            </label>

            <label className={styles.checkRow}>
              <input
                type="checkbox"
                checked={draft.loadShellProfile}
                onChange={(event) =>
                  patch({ loadShellProfile: event.target.checked })
                }
              />
              <span>
                加载个人 shell 配置
                <small>默认开启；关闭后使用干净终端，不加载 .zshrc 的别名/环境变量/自定义提示符</small>
              </span>
            </label>
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>关于</h3>
            <div className={styles.about}>
              <div className={styles.aboutRow}>
                <span>ChenADE</span>
                <span className={styles.aboutValue}>{info?.version ?? '—'}</span>
              </div>
              <div className={styles.aboutRow}>
                <span>运行环境</span>
                <span className={styles.aboutValue}>
                  {info ? `${info.platform} · ${info.arch}` : '—'}
                </span>
              </div>
            </div>
          </section>

          {error ? (
            <div className={styles.error}>
              {error.hint ? `${error.message} · ${error.hint}` : error.message}
            </div>
          ) : null}
        </div>

        <div className={styles.footer}>
          <span className={styles.footerHint}>
            {loading ? '读取设置中…' : '设置即时生效，无需重启'}
          </span>
          <div className={styles.footerActions}>
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              disabled={saving || loading || !fontSizeValid}
            >
              {saving ? (
                <>
                  <span className={styles.spinner} aria-hidden="true" />
                  保存中…
                </>
              ) : (
                '保存'
              )}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
