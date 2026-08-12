import { Routes, Route, Navigate } from 'react-router-dom';

import { ApiBinding } from './ApiBinding.jsx';
import { RequireAuth } from '../components/RequireAuth.jsx';
import { AppShell } from './AppShell.jsx';
import { LoginPage } from '../features/auth/LoginPage.jsx';
import { SignupPage } from '../features/auth/SignupPage.jsx';
import { DashboardPage } from '../features/dashboard/DashboardPage.jsx';
import { CoursesListPage } from '../features/courses/CoursesListPage.jsx';
import { CourseDetailPage } from '../features/courses/CourseDetailPage.jsx';
import { LessonPage } from '../features/lesson/LessonPage.jsx';
import { LessonCompletePage } from '../features/lesson/LessonCompletePage.jsx';
import { InstructorDashboardPage } from '../features/instructor/InstructorDashboardPage.jsx';
import { NewCoursePage } from '../features/instructor/NewCoursePage.jsx';
import { CourseEditorPage } from '../features/instructor/CourseEditorPage.jsx';
import { LessonEditorPage } from '../features/instructor/LessonEditorPage.jsx';
import { InstructorAnalyticsPage } from '../features/instructor/InstructorAnalyticsPage.jsx';
import { AdminLayout } from '../features/admin/AdminLayout.jsx';
import { AdminOverviewPage } from '../features/admin/AdminOverviewPage.jsx';
import { AdminUsersPage } from '../features/admin/AdminUsersPage.jsx';
import { AdminCoursesPage } from '../features/admin/AdminCoursesPage.jsx';

const App = () => (
  <ApiBinding>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />

      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="courses" element={<CoursesListPage />} />
        <Route path="courses/:id" element={<CourseDetailPage />} />
        <Route path="lessons/:id" element={<LessonPage />} />
        <Route path="lessons/:id/complete" element={<LessonCompletePage />} />

        <Route
          path="instructor"
          element={
            <RequireAuth roles={['instructor', 'admin']}>
              <InstructorDashboardPage />
            </RequireAuth>
          }
        />
        <Route
          path="instructor/courses/new"
          element={
            <RequireAuth roles={['instructor', 'admin']}>
              <NewCoursePage />
            </RequireAuth>
          }
        />
        <Route
          path="instructor/courses/:id"
          element={
            <RequireAuth roles={['instructor', 'admin']}>
              <CourseEditorPage />
            </RequireAuth>
          }
        />
        <Route
          path="instructor/courses/:id/analytics"
          element={
            <RequireAuth roles={['instructor', 'admin']}>
              <InstructorAnalyticsPage />
            </RequireAuth>
          }
        />
        <Route
          path="instructor/lessons/:id"
          element={
            <RequireAuth roles={['instructor', 'admin']}>
              <LessonEditorPage />
            </RequireAuth>
          }
        />

        {/* Client-side guarding is UX only — every /api/admin route re-checks
            the role server-side against the Cognito group claim. */}
        <Route
          path="admin"
          element={
            <RequireAuth roles={['admin']}>
              <AdminLayout />
            </RequireAuth>
          }
        >
          <Route index element={<AdminOverviewPage />} />
          <Route path="users" element={<AdminUsersPage />} />
          <Route path="courses" element={<AdminCoursesPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </ApiBinding>
);

export default App;
