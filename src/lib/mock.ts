/**
 * Browser-only preview adapter.
 *
 * The real app always talks to Tauri. This adapter exists so the shell can be
 * reviewed in a normal browser during development without a native build.
 */
import type {
  AppInfo,
  Branch,
  Commit,
  CommitResult,
  DiffFile,
  FileContent,
  FileEntry,
  GitIdentity,
  PushResult,
  Settings,
  Activity,
  SearchHit,
  WriteResult,
  FileStatus,
  GitStatus,
  Project,
  RepoInfo,
  Worktree,
} from './types';


const MOCK_ENTRIES: { rel: string; isDir: boolean; size?: number }[] = [
  { rel: 'src', isDir: true },
  { rel: 'src/features', isDir: true },
  { rel: 'src/features/worktrees', isDir: true },
  { rel: 'src/features/worktrees/WorktreeTabs.tsx', isDir: false, size: 742 },
  { rel: 'src/features/worktrees/WorktreeList.tsx', isDir: false, size: 512 },
  { rel: 'src/features/worktrees/NewWorktreeSheet.tsx', isDir: false, size: 980 },
  { rel: 'src/features/TerminalDock.tsx', isDir: false, size: 640 },
  { rel: 'src/lib', isDir: true },
  { rel: 'src/lib/git.ts', isDir: false, size: 860 },
  { rel: 'src/lib/worktree.ts', isDir: false, size: 430 },
  { rel: 'tests', isDir: true },
  { rel: 'tests/worktree.test.ts', isDir: false, size: 380 },
  { rel: 'README.md', isDir: false, size: 420 },
  { rel: 'package.json', isDir: false, size: 220 },
];

const MOCK_CONTENT: Record<string, { language: string; content: string }> = {
  'README.md': {
    language: 'Markdown',
    content:
      '# ChenADE\n\n以 git worktree 为中心的开发环境：一个仓库，多个并行工作树。\n\n## 工作树\n\n左侧列出仓库与工作树。点选一个工作树，右侧切换到它的标签页、文件树与 Git 记录。\n',
  },
  'src/lib/git.ts': {
    language: 'TypeScript',
    content:
      "import { execFile } from 'node:child_process';\nimport { promisify } from 'node:util';\n\nconst run = promisify(execFile);\n\nexport type Worktree = {\n  path: string;\n  branch: string;\n  head: string;\n  changes: number;\n};\n\n// 直接解析 porcelain 输出：目录名可以改，HEAD 不会说谎\nexport async function listWorktrees(repo: string) {\n  const { stdout } = await run('git', ['worktree', 'list', '--porcelain'], {\n    cwd: repo,\n  });\n\n  return stdout\n    .split('\\n\\n')\n    .filter(Boolean)\n    .map(parseWorktree);\n}\n",
  },
  'src/features/worktrees/WorktreeTabs.tsx': {
    language: 'TypeScript React',
    content:
      "import { useMemo } from 'react';\nimport { useWorktrees } from '@/hooks/useWorktrees';\nimport { WorktreeList } from './WorktreeList';\nimport { TerminalDock } from '@/features/TerminalDock';\n\n// 一个工作树 = 一条标签组 + 一组终端，切换时保留各自的滚动位置\nexport function WorktreeTabs({ repo }: { repo: Repo }) {\n  const { worktrees, active, select } = useWorktrees(repo);\n\n  const dirty = useMemo(\n    () => worktrees.filter((w) => w.changes > 0).length,\n    [worktrees],\n  );\n\n  return (\n    <section className=\"tabs\" data-dirty={dirty}>\n      <WorktreeList items={worktrees} active={active} onSelect={select} />\n      <TerminalDock worktree={active} />\n    </section>\n  );\n}\n",
  },
  'package.json': {
    language: 'JSON',
    content:
      '{\n  "name": "chenade",\n  "version": "0.4.0",\n  "private": true,\n  "type": "module",\n  "scripts": {\n    "dev": "vite",\n    "test": "vitest run"\n  },\n  "dependencies": {\n    "react": "^19.1.0",\n    "zustand": "^5.0.2"\n  }\n}\n',
  },
};

function relativeTo(root: string, path: string): string {
  return path.startsWith(root) ? path.slice(root.length).replace(/^[/\\]/, '') : path;
}

function parentOf(rel: string): string {
  const index = rel.lastIndexOf('/');
  return index < 0 ? '' : rel.slice(0, index);
}


const MOCK_COMMITS: Commit[] = [
  {
    hash: 'b71e9de123456789',
    shortHash: 'b71e9de',
    parents: ['4c8a112abcdef'],
    author: '陈',
    email: 'chen@example.com',
    date: new Date(Date.now() - 12 * 60000).toISOString(),
    subject: 'feat(worktree): 标签页随工作树切换',
    refs: ['feat/worktree-tabs'],
  },
  {
    hash: '4c8a112abcdef123',
    shortHash: '4c8a112',
    parents: ['8de0f31abcdef'],
    author: '陈',
    email: 'chen@example.com',
    date: new Date(Date.now() - 26 * 3600000).toISOString(),
    subject: 'fix(terminal): 关闭最后一个终端保持焦点',
    refs: [],
  },
  {
    hash: '8de0f31abcdef123',
    shortHash: '8de0f31',
    parents: ['3a77c04abcdef'],
    author: 'Lin',
    email: 'lin@example.com',
    date: new Date(Date.now() - 30 * 3600000).toISOString(),
    subject: 'feat(git): 解析 worktree porcelain 输出',
    refs: [],
  },
  {
    hash: '3a77c04abcdef123',
    shortHash: '3a77c04',
    parents: ['0f3c1a2abcdef', '21abcdef123456'],
    author: '陈',
    email: 'chen@example.com',
    date: new Date(Date.now() - 2 * 86400000).toISOString(),
    subject: 'merge: 工作树解析进入主干',
    refs: [],
  },
  {
    hash: '0f3c1a2abcdef123',
    shortHash: '0f3c1a2',
    parents: [],
    author: '陈',
    email: 'chen@example.com',
    date: new Date(Date.now() - 3 * 86400000).toISOString(),
    subject: 'chore: 初始化工作树目录与脚本',
    refs: ['main', 'origin/main'],
  },
];

const MOCK_DIFF: DiffFile[] = [
  {
    path: 'src/features/worktrees/WorktreeTabs.tsx',
    oldPath: null,
    status: 'modified',
    additions: 18,
    deletions: 4,
    binary: false,
    hunks: [
      {
        header: '@@ -9,7 +9,12 @@ export function WorktreeTabs({ repo }: { repo: Repo }) {',
        oldStart: 9,
        oldLines: 7,
        newStart: 9,
        newLines: 12,
        rows: [
          { kind: 'context', oldNo: 9, newNo: 9, text: '  const dirty = useMemo(' },
          { kind: 'add', newNo: 10, text: '    () => worktrees.filter((w) => w.changes > 0).length,' },
          { kind: 'context', oldNo: 10, newNo: 11, text: '    [worktrees],' },
          { kind: 'context', oldNo: 11, newNo: 12, text: '  );' },
          { kind: 'add', newNo: 13, text: '  const focus = useWorktreeFocus(repo);' },
          { kind: 'context', oldNo: 12, newNo: 14, text: '' },
          { kind: 'del', oldNo: 13, text: '  return <WorktreeList items={worktrees} />;' },
          { kind: 'add', newNo: 16, text: '  return (' },
          { kind: 'add', newNo: 17, text: '    <WorktreeList items={worktrees} onSelect={select} />' },
          { kind: 'add', newNo: 18, text: '  );' },
        ],
      },
    ],
  },
  {
    path: 'src/lib/git.ts',
    oldPath: null,
    status: 'modified',
    additions: 22,
    deletions: 2,
    binary: false,
    hunks: [
      {
        header: '@@ -13,8 +13,12 @@ export async function listWorktrees(repo: string) {',
        oldStart: 13,
        oldLines: 8,
        newStart: 13,
        newLines: 12,
        rows: [
          { kind: 'del', oldNo: 14, text: 'export function listWorktrees(repo: string) {' },
          { kind: 'add', newNo: 15, text: 'export async function listWorktrees(repo: string) {' },
          { kind: 'add', newNo: 16, text: "  const { stdout } = await run('git', ['worktree', 'list'], {" },
          { kind: 'add', newNo: 17, text: '    cwd: repo,' },
          { kind: 'add', newNo: 18, text: '  });' },
          { kind: 'context', oldNo: 15, newNo: 19, text: '' },
          { kind: 'context', oldNo: 16, newNo: 20, text: '  return stdout' },
          { kind: 'del', oldNo: 17, text: "    .split('\\n')" },
          { kind: 'add', newNo: 22, text: "    .split('\\n\\n')" },
        ],
      },
    ],
  },
];

const now = new Date().toISOString();

const projects: Project[] = [
  {
    id: 'p-chen',
    name: 'chenade',
    path: '/Users/demo/Code/chenade',
    defaultBranch: 'main',
    remoteName: 'origin',
    remoteUrl: 'git@github.com:demo/chenade.git',
    provider: 'github',
    sortOrder: 0,
    addedAt: now,
    lastOpenedAt: now,
    worktreeCount: 3,
  },
  {
    id: 'p-dog',
    name: 'lumen',
    path: '/Users/demo/Code/lumen',
    defaultBranch: 'main',
    remoteName: 'origin',
    remoteUrl: 'git@github.com:demo/lumen.git',
    provider: 'github',
    sortOrder: 1,
    addedAt: now,
    lastOpenedAt: null,
    worktreeCount: 1,
  },
  {
    id: 'p-atlas',
    name: 'drift',
    path: '/Users/demo/Code/drift',
    defaultBranch: 'main',
    remoteName: 'origin',
    remoteUrl: 'git@github.com:demo/drift.git',
    provider: 'github',
    sortOrder: 2,
    addedAt: now,
    lastOpenedAt: null,
    worktreeCount: 1,
  },
];

const settings: Settings = {
  terminalShell: null,
  terminalFontSize: 12,
  defaultEditor: null,
  theme: 'dark',
  confirmCloseTerminal: true,
  loadShellProfile: true,
};

const activities: Activity[] = [
  {
    id: 3,
    projectId: 'p-chen',
    worktreePath: '/Users/demo/Code/chenade/.worktrees/worktree-tabs',
    kind: 'commit',
    title: '提交 b71e9de feat(worktree): 标签页随工作树切换',
    detail: '2 个文件 +40 −6',
    createdAt: new Date(Date.now() - 12 * 60000).toISOString(),
  },
  {
    id: 2,
    projectId: 'p-chen',
    worktreePath: '/Users/demo/Code/chenade/.worktrees/terminal-focus',
    kind: 'worktree',
    title: '新建工作树 fix/terminal-focus',
    detail: null,
    createdAt: new Date(Date.now() - 26 * 3600000).toISOString(),
  },
  {
    id: 1,
    projectId: 'p-chen',
    worktreePath: null,
    kind: 'project',
    title: '添加项目 chenade',
    detail: '/Users/demo/Code/chenade',
    createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
  },
];

const worktrees: Worktree[] = [
  {
    id: 'w-tabs',
    projectId: 'p-chen',
    path: '/Users/demo/Code/chenade/.worktrees/worktree-tabs',
    branch: 'feat/worktree-tabs',
    head: 'b71e9de',
    headSubject: 'feat(worktree): 标签页随工作树切换',
    isMain: false,
    base: 'main',
    dirty: 2,
    ahead: 2,
    behind: 0,
    upstream: 'origin/feat/worktree-tabs',
    locked: false,
    prunable: false,
    createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
  },
  {
    id: 'w-focus',
    projectId: 'p-chen',
    path: '/Users/demo/Code/chenade/.worktrees/terminal-focus',
    branch: 'fix/terminal-focus',
    head: '4c8a112',
    headSubject: 'fix(terminal): 关闭最后一个终端保持焦点',
    isMain: false,
    base: 'main',
    dirty: 0,
    ahead: 0,
    behind: 0,
    upstream: 'origin/fix/terminal-focus',
    locked: false,
    prunable: false,
    createdAt: new Date(Date.now() - 2 * 86400000).toISOString(),
  },
  {
    id: 'w-main',
    projectId: 'p-chen',
    path: '/Users/demo/Code/chenade',
    branch: 'main',
    head: '0f3c1a2',
    headSubject: 'chore: 初始化工作树目录与脚本',
    isMain: true,
    base: null,
    dirty: 0,
    ahead: 0,
    behind: 0,
    upstream: 'origin/main',
    locked: true,
    prunable: false,
    createdAt: new Date(Date.now() - 4 * 86400000).toISOString(),
  },
  {
    id: 'w-dog',
    projectId: 'p-dog',
    path: '/Users/demo/Code/lumen/.worktrees/design-tokens',
    branch: 'feat/design-tokens',
    head: '9c02d44',
    headSubject: 'feat: 编辑器设计 token',
    isMain: false,
    base: 'main',
    dirty: 1,
    ahead: 0,
    behind: 0,
    upstream: null,
    locked: false,
    prunable: false,
    createdAt: new Date(Date.now() - 6 * 86400000).toISOString(),
  },
  {
    id: 'w-atlas',
    projectId: 'p-atlas',
    path: '/Users/demo/Code/drift/.worktrees/a11y',
    branch: 'fix/a11y-focus-ring',
    head: '3a77c04',
    headSubject: 'fix(a11y): 焦点环对比度',
    isMain: false,
    base: 'main',
    dirty: 3,
    ahead: 1,
    behind: 0,
    upstream: null,
    locked: false,
    prunable: false,
    createdAt: new Date(Date.now() - 5 * 3600000).toISOString(),
  },
];

const MOCK_FILES: Record<string, FileStatus[]> = {
  'w-tabs': [
    { path: 'src/features/worktrees/WorktreeTabs.tsx', index: ' ', worktree: 'M', origPath: null },
    { path: 'src/lib/git.ts', index: ' ', worktree: 'M', origPath: null },
  ],
  'w-dog': [
    { path: 'Sources/LumenApp/EditorDesignTokens.swift', index: ' ', worktree: 'M', origPath: null },
  ],
  'w-atlas': [
    { path: 'apps/web/app.tsx', index: ' ', worktree: 'M', origPath: null },
    { path: 'apps/web/styles.css', index: ' ', worktree: 'M', origPath: null },
    { path: 'packages/ui/Button.tsx', index: ' ', worktree: 'M', origPath: null },
  ],
};

function statusFor(worktree: Worktree): GitStatus {
  const files = MOCK_FILES[worktree.id] ?? [];
  return {
    branch: worktree.branch,
    detached: false,
    upstream: worktree.upstream,
    ahead: worktree.ahead,
    behind: worktree.behind,
    mergeInProgress: false,
    rebaseInProgress: false,
    files,
  };
}

function repoInfoFor(path: string): RepoInfo {
  const name = path.split('/').filter(Boolean).pop() ?? 'repo';
  return {
    path,
    name,
    defaultBranch: 'main',
    remoteName: 'origin',
    remoteUrl: `git@github.com:demo/${name}.git`,
    provider: 'github',
    worktreeCount: 1,
  };
}

function delay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 120));
}

export async function mockInvoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  await delay();

  switch (command) {
    case 'app_info':
      return {
        version: '0.1.0',
        gitVersion: 'git version 2.45.0 (preview)',
        platform: 'macos',
        arch: 'arm64',
      } satisfies AppInfo as T;

    case 'projects_list':
      return [...projects] as T;

    case 'project_validate': {
      const path = String(args?.path ?? '');
      return repoInfoFor(path) as T;
    }

    case 'project_add': {
      const path = String(args?.path ?? '');
      const info = repoInfoFor(path);
      const existing = projects.find((project) => project.path === info.path);
      if (existing) return existing as T;
      const project: Project = {
        id: `p-${Date.now()}`,
        name: info.name,
        path: info.path,
        defaultBranch: info.defaultBranch,
        remoteName: info.remoteName,
        remoteUrl: info.remoteUrl,
        provider: info.provider,
        sortOrder: projects.length,
        addedAt: new Date().toISOString(),
        lastOpenedAt: null,
        worktreeCount: 1,
      };
      projects.push(project);
      return project as T;
    }

    case 'project_remove': {
      const id = String(args?.id ?? '');
      const index = projects.findIndex((project) => project.id === id);
      if (index >= 0) projects.splice(index, 1);
      return undefined as T;
    }

    case 'project_reorder': {
      const ids = (args?.ids as string[] | undefined) ?? [];
      const ordered = ids
        .map((id) => projects.find((project) => project.id === id))
        .filter((project): project is Project => !!project);
      for (const project of projects) {
        if (!ordered.includes(project)) ordered.push(project);
      }
      projects.splice(0, projects.length, ...ordered);
      projects.forEach((project, index) => {
        project.sortOrder = index;
      });
      return undefined as T;
    }

    case 'project_touch': {
      const id = String(args?.id ?? '');
      const project = projects.find((item) => item.id === id);
      if (project) project.lastOpenedAt = new Date().toISOString();
      return undefined as T;
    }

    case 'project_reveal':
      return undefined as T;

    case 'worktrees_list': {
      const projectId = String(args?.projectId ?? '');
      return worktrees.filter((worktree) => worktree.projectId === projectId) as T;
    }

    case 'worktree_status': {
      const path = String(args?.path ?? '');
      const worktree = worktrees.find((item) => item.path === path);
      if (!worktree) throw { code: 'WORKTREE_NOT_FOUND', message: '找不到这个工作树' };
      return statusFor(worktree) as T;
    }

    case 'files_list_dir': {
      const root = String(args?.root ?? '');
      const path = String(args?.path ?? '');
      const rel = relativeTo(root, path).replace(/\\/g, '/');
      const entries: FileEntry[] = MOCK_ENTRIES.filter(
        (entry) => parentOf(entry.rel) === rel,
      ).map((entry) => ({
        name: entry.rel.split('/').pop() ?? entry.rel,
        path: `${root}/${entry.rel}`,
        isDir: entry.isDir,
        isSymlink: false,
        size: entry.size ?? 0,
        modified: null,
      }));
      return entries as T;
    }

    case 'files_read': {
      const root = String(args?.root ?? '');
      const path = String(args?.path ?? '');
      const rel = relativeTo(root, path).replace(/\\/g, '/');
      const doc = MOCK_CONTENT[rel];
      if (!doc) throw { code: 'FILE_NOT_FOUND', message: '预览数据里没有这个文件' };
      return {
        path,
        content: doc.content,
        language: doc.language,
        encoding: 'UTF-8',
        size: doc.content.length,
        truncated: false,
      } satisfies FileContent as T;
    }

    case 'git_branches':
      return [
        { name: 'main', hash: '0f3c1a2', updatedAt: new Date().toISOString(), isCurrent: false },
        { name: 'feat/worktree-tabs', hash: 'b71e9de', updatedAt: new Date().toISOString(), isCurrent: true },
        { name: 'fix/terminal-focus', hash: '4c8a112', updatedAt: new Date().toISOString(), isCurrent: false },
      ] satisfies Branch[] as T;

    case 'worktree_create': {
      const input = (args?.input ?? {}) as {
        projectId?: string;
        branch?: string;
        base?: string;
        path?: string | null;
      };
      const project = projects.find((item) => item.id === input.projectId);
      if (!project) throw { code: 'REPO_NOT_FOUND', message: '找不到项目' };
      const branch = input.branch ?? 'feat/new';
      const slug = branch.split('/').pop() ?? 'worktree';
      const path = input.path || `${project.path}/.worktrees/${slug}`;
      if (worktrees.some((item) => item.path === path)) {
        throw { code: 'WORKTREE_EXISTS', message: '目录已经存在' };
      }
      const created: Worktree = {
        id: `w-${Date.now()}`,
        projectId: project.id,
        path,
        branch,
        head: '0f3c1a2',
        headSubject: `chore: 从 ${input.base ?? project.defaultBranch} 创建工作树`,
        isMain: false,
        base: input.base ?? project.defaultBranch,
        dirty: 0,
        ahead: 0,
        behind: 0,
        upstream: null,
        locked: false,
        prunable: false,
        createdAt: new Date().toISOString(),
      };
      worktrees.push(created);
      project.worktreeCount += 1;
      return created as T;
    }

    case 'git_log': {
      const limit = Number(args?.limit ?? MOCK_COMMITS.length);
      return MOCK_COMMITS.slice(0, limit) as T;
    }

    case 'git_diff_worktree':
    case 'git_diff_commit':
      return MOCK_DIFF as T;

    case 'git_identity':
      return { name: '陈', email: 'chen@example.com' } satisfies GitIdentity as T;

    case 'git_commit': {
      const message = String(args?.message ?? 'update');
      return {
        hash: 'c0ffee123456789',
        shortHash: 'c0ffee1',
        subject: message.split('\n')[0],
      } satisfies CommitResult as T;
    }

    case 'git_push':
      return {
        remote: 'origin',
        branch: 'feat/worktree-tabs',
        summary: '已推送 feat/worktree-tabs',
      } satisfies PushResult as T;

    case 'git_compare_url':
      return 'https://github.com/chen/ade/compare/main...feat/worktree-tabs?expand=1' as T;

    case 'open_external_url':
    case 'git_reveal_path':
    case 'settings_get':
      return { ...settings } as T;

    case 'settings_set': {
      Object.assign(settings, (args?.settings ?? {}) as Partial<Settings>);
      return { ...settings } as T;
    }

    case 'activity_list': {
      const projectId = (args?.projectId as string | undefined) ?? undefined;
      const limit = Number(args?.limit ?? 50);
      return activities
        .filter((activity) => !projectId || activity.projectId === projectId)
        .slice(0, limit) as T;
    }

    case 'activity_add': {
      const activity: Activity = {
        id: Date.now(),
        projectId: String(args?.projectId ?? ''),
        worktreePath: (args?.worktreePath as string | null | undefined) ?? null,
        kind: String(args?.kind ?? 'info'),
        title: String(args?.title ?? ''),
        detail: (args?.detail as string | null | undefined) ?? null,
        createdAt: new Date().toISOString(),
      };
      activities.unshift(activity);
      return activity as T;
    }

    case 'search_files': {
      const root = String(args?.root ?? '');
      const query = String(args?.query ?? '').toLowerCase();
      const limit = Number(args?.limit ?? 24);
      if (query.length < 2) return [] as T;
      const hits: SearchHit[] = [];
      for (const entry of MOCK_ENTRIES) {
        if (!query) break;
        if (entry.isDir) continue;
        if (entry.rel.toLowerCase().includes(query)) {
          hits.push({
            path: `${root}/${entry.rel}`,
            line: null,
            preview: entry.rel,
            kind: 'file',
          });
        }
        const content = MOCK_CONTENT[entry.rel]?.content ?? '';
        if (content) {
          const lines = content.split('\n');
          for (let index = 0; index < lines.length; index += 1) {
            if (lines[index].toLowerCase().includes(query)) {
              hits.push({
                path: `${root}/${entry.rel}`,
                line: index + 1,
                preview: lines[index].trim().slice(0, 200),
                kind: 'content',
              });
              break;
            }
          }
        }
        if (hits.length >= limit) break;
      }
      return hits.slice(0, limit) as T;
    }

    case 'files_write': {
      const path = String(args?.path ?? '');
      const content = String(args?.content ?? '');
      return {
        path,
        size: content.length,
        modified: new Date().toISOString(),
      } satisfies WriteResult as T;
    }

    case 'worktree_remove': {
      const path = String(args?.path ?? '');
      const index = worktrees.findIndex((item) => item.path === path);
      if (index >= 0) {
        const [removed] = worktrees.splice(index, 1);
        const project = projects.find((item) => item.id === removed.projectId);
        if (project) project.worktreeCount = Math.max(0, project.worktreeCount - 1);
      }
      return undefined as T;
    }

    case 'worktree_prune':
      return undefined as T;

    case 'files_reveal':
    case 'files_open_external':
      return undefined as T;

    default:
      throw { code: 'UNKNOWN', message: `未实现的预览命令：${command}` };
  }
}
