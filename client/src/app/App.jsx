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
import { InstructorDashboardPage } from '../features/instructor/InstructorDashboardPage.jsx';
import { NewCoursePage } from '../features/instructor/NewCoursePage.jsx';
import { CourseEditorPage } from '../features/instructor/CourseEditorPage.jsx';
import { LessonEditorPage } from '../features/instructor/LessonEditorPage.jsx';
import { InstructorAnalyticsPage } from '../features/instructor/InstructorAnalyticsPage.jsx';

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
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </ApiBinding>
);

export default App;
