// @ts-nocheck -- Migration baseline: JS-to-TS rename complete. Types will be tightened incrementally.
import React, { useState, useEffect, useRef, useCallback } from 'react';
const ChevronLeft = ({ className: cls }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>;
const ChevronRight = ({ className: cls }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>;
const Maximize2 = ({ className: cls }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><polyline points="15,3 21,3 21,9"/><polyline points="9,21 3,21 3,15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>;
const Eye = ({ className: cls }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>;
const Settings2 = ({ className: cls }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>;
const Moon = ({ className: cls }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>;
const Sun = ({ className: cls }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>;
const ArrowDown = ({ className: cls }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19,12 12,19 5,12"/></svg>;
const Mic = ({ className: cls }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>;
const Brain = ({ className: cls }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M12 4.5a2.5 2.5 0 0 0-4.96-.46A2.5 2.5 0 0 0 4.5 7.04 2.5 2.5 0 0 0 5 12a2.5 2.5 0 0 0 .5 4.96A2.5 2.5 0 0 0 7.04 21.5 2.5 2.5 0 0 0 12 19.5M12 4.5a2.5 2.5 0 0 1 4.96-.46A2.5 2.5 0 0 1 19.5 7.04 2.5 2.5 0 0 1 19 12a2.5 2.5 0 0 1-.5 4.96A2.5 2.5 0 0 1 16.96 21.5 2.5 2.5 0 0 1 12 19.5"/><path d="M12 4.5v15"/></svg>;
const Sparkles = ({ className: cls }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/></svg>;
const FileText = ({ className: cls }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10,9 9,9 8,9"/></svg>;
const GripVertical = ({ className: cls }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="9" cy="5" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="19" r="1"/></svg>;
import { useTranslation } from 'react-i18next';
import DarkModeToggle from '../controls/DarkModeToggle';

import { useUiPreferences } from '../../../../hooks/useUiPreferences';
import { useTheme } from '../../../../contexts/ThemeContext';
import LanguageSelector from '../controls/LanguageSelector';

import { useDeviceSettings } from '../../../../hooks/useDeviceSettings';


const QuickSettingsPanel = () => {
  const { t } = useTranslation('settings');
  const [isOpen, setIsOpen] = useState(false);
  const [whisperMode, setWhisperMode] = useState(() => {
    return localStorage.getItem('whisperMode') || 'default';
  });
  const { isDarkMode } = useTheme();

  const { isMobile } = useDeviceSettings({ trackPWA: false });

  const { preferences, setPreference } = useUiPreferences();
  const { autoExpandTools, showRawParameters, showThinking, autoScrollToBottom } = preferences;

  // Draggable handle state
  const [handlePosition, setHandlePosition] = useState(() => {
    const saved = localStorage.getItem('quickSettingsHandlePosition');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return parsed.y ?? 50;
      } catch {
        // Remove corrupted data
        localStorage.removeItem('quickSettingsHandlePosition');
        return 50;
      }
    }
    return 50; // Default to 50% (middle of screen)
  });

  const [isDragging, setIsDragging] = useState(false);
  const [dragStartY, setDragStartY] = useState(0);
  const [dragStartPosition, setDragStartPosition] = useState(0);
  const [hasMoved, setHasMoved] = useState(false); // Track if user has moved during drag
  const handleRef = useRef(null);
  const constraintsRef = useRef({ min: 10, max: 90 }); // Percentage constraints
  const dragThreshold = 5; // Pixels to move before it's considered a drag

  // Save handle position to localStorage when it changes
  useEffect(() => {
    localStorage.setItem('quickSettingsHandlePosition', JSON.stringify({ y: handlePosition }));
  }, [handlePosition]);

  // Calculate position from percentage
  const getPositionStyle = useCallback(() => {
    if (isMobile) {
      // On mobile, convert percentage to pixels from bottom
      const bottomPixels = (window.innerHeight * handlePosition) / 100;
      return { bottom: `${bottomPixels}px` };
    } else {
      // On desktop, use top with percentage
      return { top: `${handlePosition}%`, transform: 'translateY(-50%)' };
    }
  }, [handlePosition, isMobile]);

  // Handle mouse/touch start
  const handleDragStart = useCallback((e) => {
    // Don't prevent default yet - we want to allow click if no drag happens
    e.stopPropagation();

    const clientY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;
    setDragStartY(clientY);
    setDragStartPosition(handlePosition);
    setHasMoved(false);
    setIsDragging(false); // Don't set dragging until threshold is passed
  }, [handlePosition]);

  // Handle mouse/touch move
  const handleDragMove = useCallback((e) => {
    if (dragStartY === 0) return; // Not in a potential drag

    const clientY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;
    const deltaY = Math.abs(clientY - dragStartY);

    // Check if we've moved past threshold
    if (!isDragging && deltaY > dragThreshold) {
      setIsDragging(true);
      setHasMoved(true);
      document.body.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';

      // Prevent body scroll on mobile during drag
      if (e.type.includes('touch')) {
        document.body.style.overflow = 'hidden';
        document.body.style.position = 'fixed';
        document.body.style.width = '100%';
      }
    }

    if (!isDragging) return;

    // Prevent scrolling on touch move
    if (e.type.includes('touch')) {
      e.preventDefault();
    }

    const actualDeltaY = clientY - dragStartY;

    // For top-based positioning (desktop), moving down increases top percentage
    // For bottom-based positioning (mobile), we need to invert
    let percentageDelta;
    if (isMobile) {
      // On mobile, moving down should decrease bottom position (increase percentage from top)
      percentageDelta = -(actualDeltaY / window.innerHeight) * 100;
    } else {
      // On desktop, moving down should increase top position
      percentageDelta = (actualDeltaY / window.innerHeight) * 100;
    }

    let newPosition = dragStartPosition + percentageDelta;

    // Apply constraints
    newPosition = Math.max(constraintsRef.current.min, Math.min(constraintsRef.current.max, newPosition));

    setHandlePosition(newPosition);
  }, [isDragging, dragStartY, dragStartPosition, isMobile, dragThreshold]);

  // Handle mouse/touch end
  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
    setDragStartY(0);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';

    // Restore body scroll on mobile
    document.body.style.overflow = '';
    document.body.style.position = '';
    document.body.style.width = '';
  }, []);

  // Cleanup body styles on unmount in case component unmounts while dragging
  useEffect(() => {
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
    };
  }, []);

  // Set up global event listeners for drag
  useEffect(() => {
    if (dragStartY !== 0) {
      // Mouse events
      const handleMouseMove = (e) => handleDragMove(e);
      const handleMouseUp = () => handleDragEnd();

      // Touch events
      const handleTouchMove = (e) => handleDragMove(e);
      const handleTouchEnd = () => handleDragEnd();

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.addEventListener('touchmove', handleTouchMove, { passive: false });
      document.addEventListener('touchend', handleTouchEnd);

      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.removeEventListener('touchmove', handleTouchMove);
        document.removeEventListener('touchend', handleTouchEnd);
      };
    }
  }, [dragStartY, handleDragMove, handleDragEnd]);

  const handleToggle = (e) => {
    // Don't toggle if user was dragging
    if (hasMoved) {
      e.preventDefault();
      setHasMoved(false);
      return;
    }

    setIsOpen((previous) => !previous);
  };

  return (
    <>
      {/* Pull Tab - Combined drag handle and toggle button */}
      <button
        ref={handleRef}
        onClick={handleToggle}
        onMouseDown={(e) => {
          // Start drag on mousedown
          handleDragStart(e);
        }}
        onTouchStart={(e) => {
          // Start drag on touchstart
          handleDragStart(e);
        }}
        className={`fixed ${
          isOpen ? 'right-64' : 'right-0'
        } z-50 ${isDragging ? '' : 'transition-all duration-150 ease-out'} bg-white dark:bg-gray-800 border ${
          isDragging ? 'border-blue-500 dark:border-blue-400' : 'border-gray-200 dark:border-gray-700'
        } rounded-l-md p-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors shadow-lg ${
          isDragging ? 'cursor-grabbing' : 'cursor-pointer'
        } touch-none`}
        style={{ ...getPositionStyle(), touchAction: 'none', WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
        aria-label={isDragging ? t('quickSettings.dragHandle.dragging') : isOpen ? t('quickSettings.dragHandle.closePanel') : t('quickSettings.dragHandle.openPanel')}
        title={isDragging ? t('quickSettings.dragHandle.draggingStatus') : t('quickSettings.dragHandle.toggleAndMove')}
      >
        {isDragging ? (
          <GripVertical className="h-5 w-5 text-blue-500 dark:text-blue-400" />
        ) : isOpen ? (
          <ChevronRight className="h-5 w-5 text-gray-600 dark:text-gray-400" />
        ) : (
          <ChevronLeft className="h-5 w-5 text-gray-600 dark:text-gray-400" />
        )}
      </button>

      {/* Panel */}
      <div
        className={`fixed top-0 right-0 h-full w-64 bg-background border-l border-border shadow-xl transform transition-transform duration-150 ease-out z-40 ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        } ${isMobile ? 'h-screen' : ''}`}
      >
        <div className="h-full flex flex-col">
          {/* Header */}
          <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Settings2 className="h-5 w-5 text-gray-600 dark:text-gray-400" />
              {t('quickSettings.title')}
            </h3>
          </div>

          {/* Settings Content */}
          <div className={`flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-6 bg-background ${isMobile ? 'pb-mobile-nav' : ''}`}>
            {/* Appearance Settings */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">{t('quickSettings.sections.appearance')}</h4>

              <div className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors border border-transparent hover:border-gray-300 dark:hover:border-gray-600">
                <span className="flex items-center gap-2 text-sm text-gray-900 dark:text-white">
                  {isDarkMode ? <Moon className="h-4 w-4 text-gray-600 dark:text-gray-400" /> : <Sun className="h-4 w-4 text-gray-600 dark:text-gray-400" />}
                  {t('quickSettings.darkMode')}
                </span>
                <DarkModeToggle />
              </div>

              {/* Language Selector */}
              <div>
                <LanguageSelector compact={true} />
              </div>
            </div>

            {/* Tool Display Settings */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">{t('quickSettings.sections.toolDisplay')}</h4>

              <label className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer transition-colors border border-transparent hover:border-gray-300 dark:hover:border-gray-600">
                <span className="flex items-center gap-2 text-sm text-gray-900 dark:text-white">
                  <Maximize2 className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                  {t('quickSettings.autoExpandTools')}
                </span>
                <input
                  type="checkbox"
                  checked={autoExpandTools}
                  onChange={(e) => setPreference('autoExpandTools', e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 dark:text-blue-500 focus:ring-blue-500 focus:ring-2 dark:focus:ring-blue-400 bg-gray-100 dark:bg-gray-800 checked:bg-blue-600 dark:checked:bg-blue-600"
                />
              </label>

              <label className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer transition-colors border border-transparent hover:border-gray-300 dark:hover:border-gray-600">
                <span className="flex items-center gap-2 text-sm text-gray-900 dark:text-white">
                  <Eye className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                  {t('quickSettings.showRawParameters')}
                </span>
                <input
                  type="checkbox"
                  checked={showRawParameters}
                  onChange={(e) => setPreference('showRawParameters', e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 dark:text-blue-500 focus:ring-blue-500 focus:ring-2 dark:focus:ring-blue-400 bg-gray-100 dark:bg-gray-800 checked:bg-blue-600 dark:checked:bg-blue-600"
                />
              </label>

              <label className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer transition-colors border border-transparent hover:border-gray-300 dark:hover:border-gray-600">
                <span className="flex items-center gap-2 text-sm text-gray-900 dark:text-white">
                  <Brain className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                  {t('quickSettings.showThinking')}
                </span>
                <input
                  type="checkbox"
                  checked={showThinking}
                  onChange={(e) => setPreference('showThinking', e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 dark:text-blue-500 focus:ring-blue-500 focus:ring-2 dark:focus:ring-blue-400 bg-gray-100 dark:bg-gray-800 checked:bg-blue-600 dark:checked:bg-blue-600"
                />
              </label>
            </div>
            {/* View Options */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">{t('quickSettings.sections.viewOptions')}</h4>

              <label className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer transition-colors border border-transparent hover:border-gray-300 dark:hover:border-gray-600">
                <span className="flex items-center gap-2 text-sm text-gray-900 dark:text-white">
                  <ArrowDown className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                  {t('quickSettings.autoScrollToBottom')}
                </span>
                <input
                  type="checkbox"
                  checked={autoScrollToBottom}
                  onChange={(e) => setPreference('autoScrollToBottom', e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 dark:text-blue-500 focus:ring-blue-500 focus:ring-2 dark:focus:ring-blue-400 bg-gray-100 dark:bg-gray-800 checked:bg-blue-600 dark:checked:bg-blue-600"
                />
              </label>
            </div>

            {/* Whisper Dictation Settings - HIDDEN */}
            <div className="space-y-2" style={{ display: 'none' }}>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">{t('quickSettings.sections.whisperDictation')}</h4>

              <div className="space-y-2">
                <label className="flex items-start p-3 rounded-lg bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer transition-colors border border-transparent hover:border-gray-300 dark:hover:border-gray-600">
                  <input
                    type="radio"
                    name="whisperMode"
                    value="default"
                    checked={whisperMode === 'default'}
                    onChange={() => {
                      setWhisperMode('default');
                      localStorage.setItem('whisperMode', 'default');
                      window.dispatchEvent(new Event('whisperModeChanged'));
                    }}
                    className="mt-0.5 h-4 w-4 border-gray-300 dark:border-gray-600 text-blue-600 dark:text-blue-500 focus:ring-blue-500 dark:focus:ring-blue-400 dark:bg-gray-800 dark:checked:bg-blue-600"
                  />
                  <div className="ml-3 flex-1">
                    <span className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white">
                      <Mic className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                      {t('quickSettings.whisper.modes.default')}
                    </span>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {t('quickSettings.whisper.modes.defaultDescription')}
                    </p>
                  </div>
                </label>

                <label className="flex items-start p-3 rounded-lg bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer transition-colors border border-transparent hover:border-gray-300 dark:hover:border-gray-600">
                  <input
                    type="radio"
                    name="whisperMode"
                    value="prompt"
                    checked={whisperMode === 'prompt'}
                    onChange={() => {
                      setWhisperMode('prompt');
                      localStorage.setItem('whisperMode', 'prompt');
                      window.dispatchEvent(new Event('whisperModeChanged'));
                    }}
                    className="mt-0.5 h-4 w-4 border-gray-300 dark:border-gray-600 text-blue-600 dark:text-blue-500 focus:ring-blue-500 dark:focus:ring-blue-400 dark:bg-gray-800 dark:checked:bg-blue-600"
                  />
                  <div className="ml-3 flex-1">
                    <span className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white">
                      <Sparkles className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                      {t('quickSettings.whisper.modes.prompt')}
                    </span>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {t('quickSettings.whisper.modes.promptDescription')}
                    </p>
                  </div>
                </label>

                <label className="flex items-start p-3 rounded-lg bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer transition-colors border border-transparent hover:border-gray-300 dark:hover:border-gray-600">
                  <input
                    type="radio"
                    name="whisperMode"
                    value="vibe"
                    checked={whisperMode === 'vibe' || whisperMode === 'instructions' || whisperMode === 'architect'}
                    onChange={() => {
                      setWhisperMode('vibe');
                      localStorage.setItem('whisperMode', 'vibe');
                      window.dispatchEvent(new Event('whisperModeChanged'));
                    }}
                    className="mt-0.5 h-4 w-4 border-gray-300 dark:border-gray-600 text-blue-600 dark:text-blue-500 focus:ring-blue-500 dark:focus:ring-blue-400 dark:bg-gray-800 dark:checked:bg-blue-600"
                  />
                  <div className="ml-3 flex-1">
                    <span className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white">
                      <FileText className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                      {t('quickSettings.whisper.modes.vibe')}
                    </span>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {t('quickSettings.whisper.modes.vibeDescription')}
                    </p>
                  </div>
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-background/80 backdrop-blur-sm z-30 transition-opacity duration-150 ease-out"
          onClick={handleToggle}
        />
      )}
    </>
  );
};

export default QuickSettingsPanel;
