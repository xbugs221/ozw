// @ts-nocheck -- Complex type dependencies; needs dedicated pass.
/**
 * 文件目的：管理浏览器内部会话、访问令牌登录、退出与首次引导状态。
 */
import React, { createContext, useContext, useEffect, useState } from 'react';
import { api, getAuthToken } from '../utils/api';

const AuthContext = createContext({
  user: null,
  token: null,
  login: () => {},
  logout: () => {},
  isLoading: true,
  hasCompletedOnboarding: true,
  refreshOnboardingStatus: () => {},
  error: null
});

export const useAuth = () => {
  /** Expose the single authentication state shared by protected application views. */
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  /** Coordinate persisted JWT restoration and access-token login without account setup. */
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => getAuthToken());
  const [isLoading, setIsLoading] = useState(true);
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkOnboardingStatus = async () => {
    try {
      const response = await api.user.onboardingStatus();
      if (response.ok) {
        const data = await response.json();
        setHasCompletedOnboarding(data.hasCompletedOnboarding);
      }
    } catch (error) {
      // Transient network failure during startup (e.g. Vite HMR reload, page
      // navigation) — not a real error; onboarding defaults to completed.
      console.warn('Non-critical: onboarding status check failed, defaulting to completed:', error);
      setHasCompletedOnboarding(true);
    }
  };

  const refreshOnboardingStatus = async () => {
    await checkOnboardingStatus();
  };

  const checkAuthStatus = async () => {
    try {
      setIsLoading(true);
      setError(null);

      if (token) {
        try {
          const userResponse = await api.auth.user();

          if (userResponse.ok) {
            const userData = await userResponse.json();
            setUser(userData.user);
            await checkOnboardingStatus();
            return;
          }
        } catch (error) {
          console.warn('Token verification was interrupted:', error);
        }

        // Token 无效或已过期时，回退到公开状态接口检查部署配置。
        localStorage.removeItem('auth-token');
        setToken(null);
        setUser(null);
      }

      const statusResponse = await api.auth.status();
      const statusData = await statusResponse.json();
      setUser(null);
      if (!statusData.accessTokenConfigured) {
        setError(statusData.error || 'OZW_ACCESS_TOKEN is not configured');
      }
    } catch (error) {
      console.warn('[AuthContext] Auth status check failed:', error);
      setError('Failed to check authentication status');
    } finally {
      setIsLoading(false);
    }
  };

  const login = async (accessToken) => {
    try {
      setError(null);
      const response = await api.auth.login(accessToken);

      const data = await response.json();

      if (response.ok) {
        setToken(data.token);
        setUser(data.user);
        localStorage.setItem('auth-token', data.token);
        return { success: true };
      } else {
        setError(data.error || 'Login failed');
        return { success: false, error: data.error || 'Login failed' };
      }
    } catch (error) {
      console.error('Login error:', error);
      const errorMessage = 'Network error. Please try again.';
      setError(errorMessage);
      return { success: false, error: errorMessage };
    }
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('auth-token');

    // Optional: Call logout endpoint for logging
    if (token) {
      api.auth.logout().catch(error => {
        console.error('Logout endpoint error:', error);
      });
    }
  };

  const value = {
    user,
    token,
    login,
    logout,
    isLoading,
    hasCompletedOnboarding,
    refreshOnboardingStatus,
    error
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
