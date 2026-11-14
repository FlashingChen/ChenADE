export type Provider = 'github' | 'gitlab' | 'other' | null;

export interface Project {
  id: string;
  name: string;
  path: string;
  defaultBranch: string;
  remoteName: string | null;
  remoteUrl: string | null;
  provider: Provider;
  sortOrder: number;
  addedAt: string;
  lastOpenedAt: string | null;
  worktreeCount: number;
}

export interface RepoInfo {
  path: string;
  name: string;
  defaultBranch: string;
  remoteName: string | null;
  remoteUrl: string | null;
  provider: Provider;
  worktreeCount: number;
}

export interface Worktree {
  id: string;
  projectId: string;
  path: string;
  branch: string | null;
  head: string;
  headSubject: string;
  isMain: boolean;
  base: string | null;
  dirty: number;
  ahead: number;
  behind: number;
  upstream: string | null;
  locked: boolean;
  prunable: boolean;
  createdAt: string | null;
}

export interface FileStatus {
  path: string;
  index: string;
  worktree: string;
  origPath: string | null;
}

export interface GitStatus {
  branch: string | null;
  detached: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  mergeInProgress: boolean;
  rebaseInProgress: boolean;
  files: FileStatus[];
}

export interface AppInfo {
  version: string;
  gitVersion: string;
  platform: string;
  arch: string;
}

export interface AppErrorShape {
  code: string;
  message: string;
  detail?: string;
  hint?: string;
}

export type ToastTone = 'info' | 'success' | 'error';

export interface ToastMessage {
  id: number;
  message: string;
  tone: ToastTone;
}

export interface PtySpawnResult {
  sessionId: string;
  shell: string;
  pid: number;
}

export type PtyEvent =
  | { type: 'data'; data: string }
  | { type: 'exit'; code: number | null; signal: string | null }
  | { type: 'error'; message: string };

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  isSymlink: boolean;
  size: number;
  modified: string | null;
}

export interface FileContent {
  path: string;
  content: string;
  language: string;
  encoding: string;
  size: number;
  truncated: boolean;
}

export interface Branch {
  name: string;
  hash: string;
  updatedAt: string | null;
  isCurrent: boolean;
}

export interface Commit {
  hash: string;
  shortHash: string;
  parents: string[];
  author: string;
  email: string;
  date: string;
  subject: string;
  refs: string[];
}

export interface DiffRow {
  kind: 'context' | 'add' | 'del' | 'meta';
  oldNo?: number;
  newNo?: number;
  text: string;
}

export interface Hunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  rows: DiffRow[];
}

export interface DiffFile {
  path: string;
  oldPath: string | null;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked';
  additions: number;
  deletions: number;
  binary: boolean;
  hunks: Hunk[];
}

export interface GitIdentity {
  name: string;
  email: string;
}

export interface CommitResult {
  hash: string;
  shortHash: string;
  subject: string;
}

export interface PushResult {
  remote: string;
  branch: string;
  summary: string;
}

export type ThemeMode = 'dark' | 'light';

export interface Settings {
  terminalShell: string | null;
  terminalFontSize: number;
  defaultEditor: string | null;
  theme: ThemeMode;
  confirmCloseTerminal: boolean;
  loadShellProfile: boolean;
}

export interface Activity {
  id: number;
  projectId: string;
  worktreePath: string | null;
  kind: string;
  title: string;
  detail: string | null;
  createdAt: string;
}

export interface SearchHit {
  path: string;
  line: number | null;
  preview: string | null;
  kind: 'file' | 'content';
}

export interface WriteResult {
  path: string;
  size: number;
  modified: string | null;
}
