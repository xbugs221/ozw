/**
 * 文件目的：使用部署者配置的 32 字符访问令牌创建 ozw 浏览器会话。
 */
import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
const MessageSquare = ({ className: cls }: { className?: string }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>;
import { useTranslation } from 'react-i18next';

const LoginForm = () => {
  const { t } = useTranslation('auth');
  const [accessToken, setAccessToken] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const { login, error: configurationError } = useAuth() as any;

  const handleSubmit = async (e: React.FormEvent) => {
    /**
     * PURPOSE: Validate the fixed token length locally before requesting an internal session.
     */
    e.preventDefault();
    setError('');

    if (Array.from(accessToken).length !== 32) {
      setError(t('login.errors.invalidLength'));
      return;
    }

    setIsLoading(true);

    const result = await (login as any)(accessToken);

    if (!result.success) {
      setError(result.error);
    }

    setIsLoading(false);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-card rounded-lg shadow-lg border border-border p-8 space-y-6">
          {/* Logo and Title */}
          <div className="text-center">
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 bg-primary rounded-lg flex items-center justify-center shadow-sm">
                <MessageSquare className="w-8 h-8 text-primary-foreground" />
              </div>
            </div>
            <h1 className="text-2xl font-bold text-foreground">{t('login.title')}</h1>
            <p className="text-muted-foreground mt-2">
              {t('login.description')}
            </p>
          </div>

          {/* Login Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="accessToken" className="block text-sm font-medium text-foreground mb-1">
                {t('login.accessToken')}
              </label>
              <input
                type="password"
                id="accessToken"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder={t('login.placeholders.accessToken')}
                autoComplete="current-password"
                required
                disabled={isLoading}
              />
            </div>

            {(error || configurationError) && (
              <div className="p-3 bg-red-100 dark:bg-red-900/20 border border-red-300 dark:border-red-800 rounded-md">
                <p className="text-sm text-red-700 dark:text-red-400">{error || configurationError}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-2 px-4 rounded-md transition-colors duration-200"
            >
              {isLoading ? t('login.loading') : t('login.submit')}
            </button>
          </form>

          <div className="text-center">
            <p className="text-sm text-muted-foreground">
              {t('login.configurationHint')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginForm;
