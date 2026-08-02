/**
 * PURPOSE: Compose the lightweight authentication shell and defer the full
 * workspace until an authenticated user actually enters the application.
 */
import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import { ThemeProvider } from './contexts/ThemeContext';
import { AuthProvider } from './contexts/AuthContext';
import { WebSocketProvider } from './contexts/WebSocketContext';
import ProtectedRoute, { LoadingScreen } from './components/auth/ProtectedRoute';
import i18n from './i18n/config';

const AppContent = lazy(() => import('./components/app/AppContent'));

export default function App() {
  return (
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <AuthProvider>
          <WebSocketProvider>
            <ProtectedRoute>
              <Router basename={window.__ROUTER_BASENAME__ || ''}>
                <Routes>
                  <Route path="*" element={(
                    <Suspense fallback={<LoadingScreen />}>
                      <AppContent />
                    </Suspense>
                  )} />
                </Routes>
              </Router>
            </ProtectedRoute>
          </WebSocketProvider>
        </AuthProvider>
      </ThemeProvider>
    </I18nextProvider>
  );
}
