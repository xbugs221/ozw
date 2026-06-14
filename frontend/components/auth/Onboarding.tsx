// @ts-nocheck -- Complex state typing and dynamic JSX components.
import React, { useState, useEffect, useRef } from 'react';
const ChevronRight = ({ className: cls }: { className?: string }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>;
const ChevronLeft = ({ className: cls }: { className?: string }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>;
const Check = ({ className: cls }: { className?: string }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>;
const LogIn = ({ className: cls }: { className?: string }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10,17 15,12 10,7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>;
const Loader2 = ({ className: cls }: { className?: string }) => <svg className={cls || "w-4 h-4 animate-spin"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>;
import SessionProviderLogo from '../llm-logo-provider/SessionProviderLogo';
import LoginModal from './LoginModal';
import { authenticatedFetch } from '../../utils/api';
import { IS_PLATFORM } from '../../constants/config';

const Onboarding = ({ onComplete }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [activeLoginProvider, setActiveLoginProvider] = useState(null);
  const [selectedProject] = useState({ name: 'default', fullPath: IS_PLATFORM ? '/workspace' : '' });

  const [codexAuthStatus, setCodexAuthStatus] = useState({
    authenticated: false,
    email: null,
    loading: true,
    error: null
  });

  const prevActiveLoginProviderRef = useRef(undefined);

  useEffect(() => {
    const prevProvider = prevActiveLoginProviderRef.current;
    prevActiveLoginProviderRef.current = activeLoginProvider;

    const isInitialMount = prevProvider === undefined;
    const isModalClosing = prevProvider !== null && activeLoginProvider === null;

    if (isInitialMount || isModalClosing) {
      checkCodexAuthStatus();
    }
  }, [activeLoginProvider]);

  const checkProviderAuthStatus = async (provider, setter) => {
    try {
      const response = await authenticatedFetch(`/api/cli/${provider}/status`);
      if (response.ok) {
        const data = await response.json();
        setter({
          authenticated: data.authenticated,
          email: data.email,
          loading: false,
          error: data.error || null
        });
      } else {
        setter({
          authenticated: false,
          email: null,
          loading: false,
          error: 'Failed to check authentication status'
        });
      }
    } catch (error) {
      console.error(`Error checking ${provider} auth status:`, error);
      setter({
        authenticated: false,
        email: null,
        loading: false,
        error: error.message
      });
    }
  };

  const checkCodexAuthStatus = () => checkProviderAuthStatus('codex', setCodexAuthStatus);

  const handleCodexLogin = () => setActiveLoginProvider('codex');

  const handleLoginComplete = (exitCode) => {
    if (exitCode === 0) {
      if (activeLoginProvider === 'codex') {
        checkCodexAuthStatus();
      }
    }
  };

  const handleNextStep = async () => {
    setError('');

    setCurrentStep(currentStep + 1);
  };

  const handlePrevStep = () => {
    setError('');
    setCurrentStep(currentStep - 1);
  };

  const handleFinish = async () => {
    setIsSubmitting(true);
    setError('');

    try {
      const response = await authenticatedFetch('/api/user/complete-onboarding', {
        method: 'POST'
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to complete onboarding');
      }

      if (onComplete) {
        onComplete();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const steps = [
    {
      title: 'Connect Agents',
      description: 'Connect your AI coding assistants',
      icon: LogIn,
      required: false
    }
  ];

  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        return (
          <div className="space-y-6">
            <div className="text-center mb-6">
              <h2 className="text-2xl font-bold text-foreground mb-2">Connect Your AI Agents</h2>
              <p className="text-muted-foreground">
                Login to one or more AI coding assistants. All are optional.
              </p>
            </div>

            {/* Agent Cards Grid */}
            <div className="space-y-3">
              {/* Codex */}
              <div className={`border rounded-lg p-4 transition-colors ${codexAuthStatus.authenticated
                ? 'bg-gray-100 dark:bg-gray-800/50 border-gray-300 dark:border-gray-600'
                : 'border-border bg-card'
                }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
                      <SessionProviderLogo provider="codex" className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="font-medium text-foreground flex items-center gap-2">
                        OpenAI Codex
                        {codexAuthStatus.authenticated && <Check className="w-4 h-4 text-green-500" />}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {codexAuthStatus.loading ? 'Checking...' :
                          codexAuthStatus.authenticated ? codexAuthStatus.email || 'Connected' : 'Not connected'}
                      </div>
                    </div>
                  </div>
                  {!codexAuthStatus.authenticated && !codexAuthStatus.loading && (
                    <button
                      onClick={handleCodexLogin}
                      className="bg-gray-800 hover:bg-gray-900 dark:bg-gray-700 dark:hover:bg-gray-600 text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors"
                    >
                      Login
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="text-center text-sm text-muted-foreground pt-2">
              <p>You can configure these later in Settings.</p>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  const isStepValid = () => {
    switch (currentStep) {
      case 0:
        return true;
      default:
        return false;
    }
  };

  return (
    <>
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-2xl">
          {/* Progress Steps */}
          <div className="mb-8">
            <div className="flex items-center justify-between">
              {steps.map((step, index) => (
                <React.Fragment key={index}>
                  <div className="flex flex-col items-center flex-1">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center border-2 transition-colors duration-200 ${index < currentStep ? 'bg-green-500 border-green-500 text-white' :
                      index === currentStep ? 'bg-blue-600 border-blue-600 text-white' :
                        'bg-background border-border text-muted-foreground'
                      }`}>
                      {index < currentStep ? (
                        <Check className="w-6 h-6" />
                      ) : typeof step.icon === 'function' ? (
                        <step.icon />
                      ) : (
                        <step.icon className="w-6 h-6" />
                      )}
                    </div>
                    <div className="mt-2 text-center">
                      <p className={`text-sm font-medium ${index === currentStep ? 'text-foreground' : 'text-muted-foreground'
                        }`}>
                        {step.title}
                      </p>
                      {step.required && (
                        <span className="text-xs text-red-500">Required</span>
                      )}
                    </div>
                  </div>
                  {index < steps.length - 1 && (
                    <div className={`flex-1 h-0.5 mx-2 transition-colors duration-200 ${index < currentStep ? 'bg-green-500' : 'bg-border'
                      }`} />
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>

          {/* Main Card */}
          <div className="bg-card rounded-lg shadow-lg border border-border p-8">
            {renderStepContent()}

            {/* Error Message */}
            {error && (
              <div className="mt-6 p-4 bg-red-100 dark:bg-red-900/20 border border-red-300 dark:border-red-800 rounded-lg">
                <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
              </div>
            )}

            {/* Navigation Buttons */}
            <div className="flex items-center justify-between mt-8 pt-6 border-t border-border">
              <button
                onClick={handlePrevStep}
                disabled={currentStep === 0 || isSubmitting}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
              >
                <ChevronLeft className="w-4 h-4" />
                Previous
              </button>

              <div className="flex items-center gap-3">
                {currentStep < steps.length - 1 ? (
                  <button
                    onClick={handleNextStep}
                    disabled={!isStepValid() || isSubmitting}
                    className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors duration-200"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        Next
                        <ChevronRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                ) : (
                  <button
                    onClick={handleFinish}
                    disabled={isSubmitting}
                    className="flex items-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-green-400 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors duration-200"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Completing...
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4" />
                        Complete Setup
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {activeLoginProvider && (
        <LoginModal
          isOpen={!!activeLoginProvider}
          onClose={() => setActiveLoginProvider(null)}
          provider={activeLoginProvider}
          project={selectedProject}
          onComplete={handleLoginComplete}
          isOnboarding={true}
        />
      )}
    </>
  );
};

export default Onboarding;
