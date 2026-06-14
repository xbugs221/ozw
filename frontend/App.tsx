import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import { ThemeProvider } from './contexts/ThemeContext';
import { AuthProvider } from './contexts/AuthContext';
import { WebSocketProvider } from './contexts/WebSocketContext';
import ProtectedRoute from './components/auth/ProtectedRoute';
import AppContent from './components/app/AppContent';
import i18n from './i18n/config';

export default function App() {
  return (
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <AuthProvider>
          <WebSocketProvider>
                <ProtectedRoute>
                  <Router basename={window.__ROUTER_BASENAME__ || ''}>
                    <Routes>
                      <Route path="*" element={<AppContent />} />
                    </Routes>
                  </Router>
                </ProtectedRoute>
          </WebSocketProvider>
        </AuthProvider>
      </ThemeProvider>
    </I18nextProvider>
  );
}
