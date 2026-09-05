import { Routes, Route, Navigate } from 'react-router-dom';

import { ApiBinding } from './ApiBinding.jsx';
import { RequireAuth } from '../components/RequireAuth.jsx';
import { AppShell } from './AppShell.jsx';
import { LoginPage } from '../features/auth/LoginPage.jsx';
import { SignupPage } from '../features/auth/SignupPage.jsx';
import { InstructorSignupPage } from '../features/auth/InstructorSignupPage.jsx';
import { DashboardPage } from '../features/dashboard/DashboardPage.jsx';
import { CoursesListPage } from '../features/courses/CoursesListPage.jsx';
import { CourseDetailPage } from '../features/courses/CourseDetailPage.jsx';
import { LessonPage } from '../features/lesson/LessonPage.jsx';
import { NotesPage } from '../features/notes/NotesPage.jsx';
import { ProfilePage } from '../features/profile/ProfilePage.jsx';
import { MessagesPage } from '../features/messages/MessagesPage.jsx';
import { InstructorDashboardPage } from '../features/instructor/InstructorDashboardPage.jsx';
import { NewCoursePage } from '../features/instructor/NewCoursePage.jsx';
import { CourseEditorPage } from '../features/instructor/CourseEditorPage.jsx';
import { LessonEditorPage } from '../features/instructor/LessonEditorPage.jsx';
import { InstructorAnalyticsPage } from '../features/instructor/InstructorAnalyticsPage.jsx';
import { AdminLayout } from '../features/admin/AdminLayout.jsx';
import { AdminOverviewPage } from '../features/admin/AdminOverviewPage.jsx';
import { AdminUsersPage } from '../features/admin/AdminUsersPage.jsx';
import { AdminCoursesPage } from '../features/admin/AdminCoursesPage.jsx';
import { AdminUniversitiesPage } from '../features/admin/AdminUniversitiesPage.jsx';

const App = () => (
  <ApiBinding>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/signup/instructor" element={<InstructorSignupPage />} />

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
        <Route path="notes" element={<NotesPage />} />
        <Route path="profile" element={<ProfilePage />} />

        {/* One inbox for every role — the server returns the same thread shape
            to a learner and to course staff. `/instructor/messages` is kept so
            existing links and bookmarks still resolve. */}
        <Route path="messages" element={<MessagesPage />} />
        <Route
          path="instructor/messages"
          element={
            <RequireAuth roles={['instructor', 'admin']}>
              <MessagesPage />
            </RequireAuth>
          }
        />
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
          <Route path="universities" element={<AdminUniversitiesPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </ApiBinding>
);

export default App;
