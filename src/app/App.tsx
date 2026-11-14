import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell';
import { GitReviewPage } from './GitReviewPage';
import { ProjectHomePage } from './ProjectHomePage';
import { Workspace } from './Workspace';

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Workspace />} />
          <Route path="projects/:projectId" element={<ProjectHomePage />} />
          <Route path="review/:worktreeId" element={<GitReviewPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
