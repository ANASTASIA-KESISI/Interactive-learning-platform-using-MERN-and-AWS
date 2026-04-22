import { Routes, Route, Navigate } from 'react-router-dom';

import { ApiBinding } from './ApiBinding.jsx';
import { RequireAuth } from '../components/RequireAuth.jsx';
import { AppShell } from './AppShell.jsx';
import { LoginPage } from '../features/auth/LoginPage.jsx';
import { SignupPage } from '../features/auth/SignupPage.jsx';
import { DashboardPage } from '../features/dashboard/DashboardPage.jsx';

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
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </ApiBinding>
);

export default App;
