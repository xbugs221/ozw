import React, { useEffect } from 'react';
const Plus = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>;
const Trash2 = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>;
import ChatInterface from '../../chat/view/ChatInterface';
import FileTree from '../../file-tree/view/FileTree';
import { FileTreeDockViewModeControls } from '../../file-tree/view/FileTreeViewModeControls';
import StandaloneShell from '../../standalone-shell/view/StandaloneShell';
import ErrorBoundary from '../../ui/ErrorBoundary';

import MainContentHeader from './subcomponents/MainContentHeader';
import MainContentStateView from './subcomponents/MainContentStateView';
import ProjectOverviewPanel from './subcomponents/ProjectOverviewPanel';
import WorkspaceDockLayout from './subcomponents/WorkspaceDockLayout';
import type { MainContentProps } from '../types/types';
import { useWorkspaceLayoutState } from '../hooks/useWorkspaceLayoutState';

import { useUiPreferences } from '../../../hooks/useUiPreferences';
import { useEditorSidebar } from '../../code-editor/hooks/useEditorSidebar';
import EditorSidebar from '../../code-editor/view/EditorSidebar';
import type { AppTab, Project } from '../../../types/app';
import WorkflowDetailView from './subcomponents/WorkflowDetailView';
import { getAllSessions } from '../../sidebar/utils/utils';

type TerminalInstance = {
  id: string;
  title: string;
};

const createTerminalInstance = (index: number): TerminalInstance => {
  /**
   * Create a local terminal tab descriptor. The shell connection lifecycle is
   * owned by the mounted StandaloneShell for this id.
   */
  return {
    id: `terminal-${Date.now()}-${index}`,
    title: `终端 ${index}`,
  };
};

function MainContent({
  selectedProject,
  selectedSession,
  selectedWorkflow,
  activeTab,
  setActiveTab,
  ws,
  sendMessage,
  latestMessage,
  messageHistory,
  isMobile,
  isSidebarOpen,
  onMenuClick,
  isLoading,
  onInputFocusChange,
  onSessionActive,
  onSessionInactive,
  onReplaceTemporarySession,
  onNavigateToSession,
  onSelectProjectOverview,
  onSelectSession,
  onSelectWorkflow,
  onNewSession,
  onShowSettings,
  onRefresh,
  externalMessageUpdate,
  renderSnapshotRequestId,
  onRenderSnapshotRequest,
  headerLeadingContent,
}: MainContentProps) {
  const { preferences } = useUiPreferences();
  const { autoExpandTools, showRawParameters, showThinking, autoScrollToBottom } = preferences;
  const terminalLaunchCommand = React.useMemo(() => {
    /**
     * 会话入口通过 URL 传入一次性启动命令，终端本身仍保持普通 shell。
     */
    if (typeof window === 'undefined') {
      return null;
    }
    return new URLSearchParams(window.location.search).get('terminalLaunchCommand');
  }, [activeTab, selectedProject?.name, selectedSession?.id]);

  const projectSessions = selectedProject ? getAllSessions(selectedProject, {}, true) : [];
  const [revealDirectoryRequest, setRevealDirectoryRequest] = React.useState<{ path: string; requestId: number } | null>(null);
  const terminalCounterRef = React.useRef(1);
  const terminalTerminateHandlersRef = React.useRef(new Map<string, () => boolean>());
  const [terminalInstances, setTerminalInstances] = React.useState<TerminalInstance[]>(() => [createTerminalInstance(1)]);
  const [activeTerminalId, setActiveTerminalId] = React.useState<string>(() => terminalInstances[0]?.id || '');
  const workflowSessionWorkflow = React.useMemo(() => {
    if (selectedWorkflow) {
      return selectedWorkflow;
    }
    if (!selectedProject || !selectedSession?.workflowId) {
      return null;
    }
    return (selectedProject.workflows || []).find((workflow) => workflow.id === selectedSession.workflowId) || null;
  }, [selectedProject, selectedSession?.workflowId, selectedWorkflow]);

  const {
    editingFile,
    editorWidth,
    editorExpanded,
    hasManualWidth,
    resizeHandleRef,
    handleFileOpen,
    handleCloseEditor,
    handleToggleEditorExpand,
    handleResizeStart,
  } = useEditorSidebar({
    selectedProject,
    isMobile,
  });

  // Workspace layout state for dock-based layout
  const {
    layout,
    setRightDock,
    setLowerPanel,
    toggleRightDockCollapse,
    toggleLowerPanelCollapse,
    setRightDockWidth,
    setLowerPanelHeight,
    toggleRightDockFullscreen,
    toggleLowerPanelFullscreen,
    moveTerminalToRightSplit,
    moveTerminalToLower,
    setRightDockSplitRatio,
  } = useWorkspaceLayoutState(isMobile);

  useEffect(() => {
    /**
     * Terminal instances are scoped to the selected project.
     */
    terminalCounterRef.current = 1;
    const initialTerminal = createTerminalInstance(1);
    setTerminalInstances([initialTerminal]);
    setActiveTerminalId(initialTerminal.id);
  }, [selectedProject?.fullPath, selectedProject?.path, selectedProject?.name]);

  const handleCreateTerminal = React.useCallback(() => {
    /**
     * Add an independent terminal for the current project and make it active.
     */
    terminalCounterRef.current += 1;
    const nextTerminal = createTerminalInstance(terminalCounterRef.current);
    setTerminalInstances((prev) => [...prev, nextTerminal]);
    setActiveTerminalId(nextTerminal.id);
    setLowerPanel({ activePanel: 'terminal', collapsed: false });
  }, [setLowerPanel]);

  const handleDeleteActiveTerminal = React.useCallback(() => {
    /**
     * 删除终端是显式终止动作，先通知后端结束对应 tmux session，再卸载本地视图。
     */
    terminalTerminateHandlersRef.current.get(activeTerminalId)?.();
    terminalTerminateHandlersRef.current.delete(activeTerminalId);
    setTerminalInstances((prev) => {
      const activeIndex = prev.findIndex((terminal) => terminal.id === activeTerminalId);
      if (activeIndex === -1) {
        return prev;
      }

      const next = prev.filter((terminal) => terminal.id !== activeTerminalId);
      const nextActive = next[Math.max(0, activeIndex - 1)] || next[0] || null;
      setActiveTerminalId(nextActive?.id || '');
      if (next.length === 0) {
        setLowerPanel({ collapsed: true, fullscreen: false });
        setRightDock({ split: null });
      }
      return next;
    });
  }, [activeTerminalId, setLowerPanel, setRightDock]);

  const terminalDockActions = (
    <>
      <button
        type="button"
        className="inline-flex items-center justify-center rounded-md p-1 text-xs text-muted-foreground hover:bg-muted/70 hover:text-foreground"
        onClick={handleCreateTerminal}
        aria-label="新建终端"
        title="新建"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="inline-flex items-center justify-center rounded-md p-1 text-xs text-muted-foreground hover:bg-muted/70 hover:text-foreground disabled:opacity-40"
        onClick={handleDeleteActiveTerminal}
        disabled={!activeTerminalId}
        aria-label="删除终端"
        title="删除"
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </>
  );
  const fileDockTitleActions = layout.rightDock.activePanel === 'files'
    ? <FileTreeDockViewModeControls />
    : undefined;

  const renderTerminalDockContent = () => {
    /**
     * Keep inactive terminals mounted so switching does not drop their shell
     * connection; deleting unmounts only the selected instance.
     */
    if (terminalInstances.length === 0) {
      return (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground" data-testid="terminal-empty-state">
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted/70"
            onClick={handleCreateTerminal}
          >
            新建终端
          </button>
        </div>
      );
    }

    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex flex-shrink-0 items-center gap-1 border-b border-border/60 px-2 py-1" data-testid="terminal-instance-tabs">
          {terminalInstances.map((terminal) => (
            <button
              key={terminal.id}
              type="button"
              className={`rounded-md px-2 py-1 text-xs ${
                terminal.id === activeTerminalId
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
              }`}
              onClick={() => setActiveTerminalId(terminal.id)}
              aria-pressed={terminal.id === activeTerminalId}
            >
              {terminal.title}
            </button>
          ))}
        </div>
        <div className="relative min-h-0 flex-1">
          {terminalInstances.map((terminal) => (
            <div
              key={terminal.id}
              className={`absolute inset-0 ${terminal.id === activeTerminalId ? 'block' : 'hidden'}`}
              data-testid="terminal-instance"
              data-terminal-active={terminal.id === activeTerminalId ? 'true' : 'false'}
            >
              <StandaloneShell
                project={selectedProject}
                command={null}
                isPlainShell
                showHeader={false}
                minimal
                onTerminalTerminateReady={(terminate) => {
                  if (terminate) {
                    terminalTerminateHandlersRef.current.set(terminal.id, terminate);
                    return;
                  }

                  terminalTerminateHandlersRef.current.delete(terminal.id);
                }}
              />
            </div>
          ))}
        </div>
      </div>
    );
  };

  // Wrap setActiveTab to handle dock toggle on user clicks without useEffect loops
  const handleSetActiveTab = React.useCallback(
    (value: React.SetStateAction<AppTab>) => {
      const nextTab = typeof value === 'function' ? value(activeTab) : value;

      if (nextTab === 'overview') {
        if (selectedProject && (selectedSession || selectedWorkflow)) {
          onSelectProjectOverview(selectedProject);
        } else {
          setActiveTab('overview');
        }
        return;
      }

      if (nextTab === 'chat' && selectedProject && !selectedSession && !selectedWorkflow) {
        const targetSession = projectSessions[0] || null;
        if (targetSession) {
          onSelectSession(targetSession);
        } else {
          setActiveTab('chat');
        }
        return;
      }

      if (nextTab === 'chat' && selectedSession) {
        setActiveTab('chat');
        onRenderSnapshotRequest?.();
        return;
      }

      if (isMobile) {
        setActiveTab(nextTab);
        return;
      }

      if (nextTab === 'files') {
        if (layout.rightDock.activePanel === 'files' && !layout.rightDock.collapsed) {
          setRightDock({ collapsed: true, fullscreen: false });
        } else {
          setRightDock({ activePanel: 'files', collapsed: false, fullscreen: false });
        }
        setActiveTab('chat');
        return;
      } else if (nextTab === 'shell') {
        setActiveTab('shell');
        return;
      }

      setActiveTab(nextTab);
    },
    [activeTab, isMobile, layout.rightDock.activePanel, layout.rightDock.collapsed, layout.lowerPanel.activePanel, layout.lowerPanel.collapsed, onRenderSnapshotRequest, onSelectProjectOverview, onSelectSession, projectSessions, selectedProject, selectedSession, selectedWorkflow, setRightDock, setLowerPanel, setActiveTab],
  );

  const openFilesDock = React.useCallback((directoryPath?: string) => {
    /**
     * Open the file browser from artifact links without changing desktop main
     * content away from chat/workflow. Mobile keeps the single-view files tab.
     */
    if (isMobile) {
      setActiveTab('files');
    } else {
      setRightDock({ activePanel: 'files', collapsed: false, fullscreen: false });
      setActiveTab('chat');
    }

    if (directoryPath) {
      setRevealDirectoryRequest({ path: directoryPath, requestId: Date.now() });
    }
  }, [isMobile, setActiveTab, setRightDock]);

  const renderHeader = (headerActiveTab: AppTab = activeTab) => (
    <MainContentHeader
      activeTab={headerActiveTab}
      setActiveTab={handleSetActiveTab}
      selectedProject={selectedProject}
      selectedSession={selectedSession}
      selectedWorkflow={selectedWorkflow}
      isMobile={isMobile}
      isSidebarOpen={isSidebarOpen}
      onMenuClick={onMenuClick}
      leadingContent={headerLeadingContent}
      onRefresh={onRefresh}
      dockLayout={isMobile ? undefined : {
        rightDockActive: layout.rightDock.activePanel,
        rightDockCollapsed: layout.rightDock.collapsed,
        lowerPanelActive: layout.lowerPanel.activePanel,
        lowerPanelCollapsed: layout.lowerPanel.collapsed,
        rightDockSplitBottom: layout.rightDock.split?.bottomPanel ?? null,
      }}
    />
  );

  const renderMobileEditor = () => (
    <EditorSidebar
      editingFile={editingFile}
      isMobile={isMobile}
      editorExpanded={editorExpanded}
      editorWidth={editorWidth}
      hasManualWidth={hasManualWidth}
      resizeHandleRef={resizeHandleRef}
      onResizeStart={handleResizeStart}
      onCloseEditor={handleCloseEditor}
      onToggleEditorExpand={handleToggleEditorExpand}
      projectPath={selectedProject?.fullPath || selectedProject?.path}
    />
  );

  const renderMobileWorkspace = (chatContent: React.ReactNode) => {
    /**
     * Render the mobile workspace as one full-screen task view selected by activeTab.
     */
    if (!selectedProject) {
      return chatContent;
    }

    if (activeTab === 'files') {
      return editingFile ? renderMobileEditor() : (
        <FileTree
          selectedProject={selectedProject}
          onFileOpen={handleFileOpen}
          revealDirectoryRequest={revealDirectoryRequest}
          showHeaderTitle
        />
      );
    }

    if (activeTab === 'shell') {
      return (
        <StandaloneShell
          key={`shell-${selectedProject.fullPath || selectedProject.path || selectedProject.name}`}
          project={selectedProject}
          command={null}
          isPlainShell
          showHeader={false}
        />
      );
    }

    return chatContent;
  };

  const renderMobileShell = (chatContent: React.ReactNode) => (
    <div className="flex h-full max-h-[100dvh] min-h-0 flex-col overflow-hidden">
      {renderHeader()}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid={`mobile-workspace-${activeTab}`}>
        {renderMobileWorkspace(chatContent)}
      </div>
    </div>
  );

  const renderTerminalMainView = () => {
    /**
     * 桌面终端是主工作区平行视图，不再依赖下方停靠面板。
     */
    if (!selectedProject) {
      return null;
    }
    return (
      <StandaloneShell
        key={`terminalMainView-${selectedProject.fullPath || selectedProject.path || selectedProject.name}-${terminalLaunchCommand || 'plain'}`}
        project={selectedProject}
        command={terminalLaunchCommand}
        isPlainShell
        showHeader={false}
        minimal
      />
    );
  };

  if (isLoading) {
    return <MainContentStateView mode="loading" isMobile={isMobile} isSidebarOpen={isSidebarOpen} onMenuClick={onMenuClick} />;
  }

  if (!selectedProject) {
    if (activeTab !== 'chat') {
      return <MainContentStateView mode="empty" isMobile={isMobile} isSidebarOpen={isSidebarOpen} onMenuClick={onMenuClick} />;
    }

    return (
      <div className="h-full flex flex-col">
        <MainContentHeader
          activeTab={activeTab}
          setActiveTab={handleSetActiveTab}
          selectedProject={selectedProject}
          selectedSession={selectedSession}
          selectedWorkflow={selectedWorkflow}
          isMobile={isMobile}
          isSidebarOpen={isSidebarOpen}
          onMenuClick={onMenuClick}
          leadingContent={headerLeadingContent}
          onRefresh={onRefresh}
          dockLayout={{
            rightDockActive: layout.rightDock.activePanel,
            rightDockCollapsed: layout.rightDock.collapsed,
            lowerPanelActive: layout.lowerPanel.activePanel,
            lowerPanelCollapsed: layout.lowerPanel.collapsed,
            rightDockSplitBottom: layout.rightDock.split?.bottomPanel ?? null,
          }}
        />

        <div className="flex-1 min-h-0 overflow-hidden">
          <ErrorBoundary showDetails>
            <ChatInterface
              selectedProject={selectedProject}
              selectedSession={selectedSession}
              ws={ws}
              sendMessage={sendMessage}
              latestMessage={latestMessage}
              messageHistory={messageHistory}
              onFileOpen={handleFileOpen}
              onInputFocusChange={onInputFocusChange}
              onSessionActive={onSessionActive}
              onSessionInactive={onSessionInactive}
              onReplaceTemporarySession={onReplaceTemporarySession}
              onNavigateToSession={onNavigateToSession}
              onNewSession={onNewSession}
              onShowSettings={onShowSettings}
              autoExpandTools={autoExpandTools}
              showRawParameters={showRawParameters}
              showThinking={showThinking}
              autoScrollToBottom={autoScrollToBottom}
              externalMessageUpdate={externalMessageUpdate}
              renderSnapshotRequestId={renderSnapshotRequestId}
            />
          </ErrorBoundary>
        </div>
      </div>
    );
  }

  if (selectedWorkflow && !selectedSession) {
    // Workflow detail page with dock layout
    const workflowCenterContent = activeTab === 'shell' ? renderTerminalMainView() : (
      <>
        <div className={`flex flex-col min-h-0 min-w-0 overflow-hidden flex-1 ${editorExpanded ? 'hidden' : ''}`}>
          <WorkflowDetailView
            project={selectedProject}
            workflow={selectedWorkflow}
            onNavigateToSession={onNavigateToSession}
            onOpenArtifactFile={handleFileOpen}
            onOpenArtifactDirectory={openFilesDock}
          />
        </div>
        <EditorSidebar
          editingFile={editingFile}
          isMobile={isMobile}
          editorExpanded={editorExpanded}
          editorWidth={editorWidth}
          hasManualWidth={hasManualWidth}
          resizeHandleRef={resizeHandleRef}
          onResizeStart={handleResizeStart}
          onCloseEditor={handleCloseEditor}
          onToggleEditorExpand={handleToggleEditorExpand}
          projectPath={selectedProject.fullPath || selectedProject.path}
        />
      </>
    );

    if (isMobile) {
      return renderMobileShell(workflowCenterContent);
    }

    const workflowRightDockContent = layout.rightDock.activePanel === 'files' ? (
      <FileTree
        selectedProject={selectedProject}
        onFileOpen={handleFileOpen}
        revealDirectoryRequest={revealDirectoryRequest}
        showViewControls={false}
      />
    ) : null;

    const workflowLowerPanelContent = layout.lowerPanel.activePanel === 'terminal' || layout.rightDock.split?.bottomPanel === 'terminal' ? (
      renderTerminalDockContent()
    ) : null;

    return (
      <div className="h-full flex flex-col">
        <MainContentHeader
          activeTab={activeTab}
          setActiveTab={handleSetActiveTab}
          selectedProject={selectedProject}
          selectedSession={selectedSession}
          selectedWorkflow={selectedWorkflow}
          isMobile={isMobile}
          isSidebarOpen={isSidebarOpen}
          onMenuClick={onMenuClick}
          leadingContent={headerLeadingContent}
          onRefresh={onRefresh}
          dockLayout={{
            rightDockActive: layout.rightDock.activePanel,
            rightDockCollapsed: layout.rightDock.collapsed,
            lowerPanelActive: layout.lowerPanel.activePanel,
            lowerPanelCollapsed: layout.lowerPanel.collapsed,
            rightDockSplitBottom: layout.rightDock.split?.bottomPanel ?? null,
          }}
        />
        <div className="relative flex-1 flex min-h-0 overflow-hidden">
          <WorkspaceDockLayout
            layout={layout}
            isMobile={isMobile}
            centerContent={workflowCenterContent}
            rightDockContent={workflowRightDockContent}
            lowerPanelContent={workflowLowerPanelContent}
            onRightDockWidthChange={setRightDockWidth}
            onLowerPanelHeightChange={setLowerPanelHeight}
            onRightDockCollapseToggle={toggleRightDockCollapse}
            onLowerPanelCollapseToggle={toggleLowerPanelCollapse}
            onRightDockFullscreenToggle={toggleRightDockFullscreen}
            onLowerPanelFullscreenToggle={toggleLowerPanelFullscreen}
            onMoveTerminalToRightSplit={moveTerminalToRightSplit}
            onMoveTerminalToLower={moveTerminalToLower}
            onRightDockSplitRatioChange={setRightDockSplitRatio}
            rightDockTitleActions={fileDockTitleActions}
            lowerPanelActions={terminalDockActions}
          />
        </div>
      </div>
    );
  }

  if (
    selectedProject
    && !selectedSession
    && !selectedWorkflow
    && activeTab !== 'chat'
  ) {
    // Project overview page with dock layout for files/shell access
    const overviewCenterContent = activeTab === 'shell' ? renderTerminalMainView() : (
      <>
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <ProjectOverviewPanel
            project={selectedProject}
            selectedSession={selectedSession}
            selectedWorkflow={selectedWorkflow}
            sessions={getAllSessions(selectedProject, {}, true)}
            onNewSession={onNewSession}
            onSelectSession={onSelectSession}
            onSelectWorkflow={onSelectWorkflow}
          />
        </div>
        <EditorSidebar
          editingFile={editingFile}
          isMobile={isMobile}
          editorExpanded={editorExpanded}
          editorWidth={editorWidth}
          hasManualWidth={hasManualWidth}
          resizeHandleRef={resizeHandleRef}
          onResizeStart={handleResizeStart}
          onCloseEditor={handleCloseEditor}
          onToggleEditorExpand={handleToggleEditorExpand}
          projectPath={selectedProject.path}
          fillSpace={layout.rightDock.activePanel === 'files'}
        />
      </>
    );

    if (isMobile) {
      return renderMobileShell(overviewCenterContent);
    }

    const overviewRightDockContent = layout.rightDock.activePanel === 'files' ? (
      <FileTree
        selectedProject={selectedProject}
        onFileOpen={handleFileOpen}
        revealDirectoryRequest={revealDirectoryRequest}
        showViewControls={false}
      />
    ) : null;

    const overviewLowerPanelContent = layout.lowerPanel.activePanel === 'terminal' || layout.rightDock.split?.bottomPanel === 'terminal' ? (
      renderTerminalDockContent()
    ) : null;

    return (
      <div className="h-full flex flex-col">
        <MainContentHeader
          activeTab={activeTab}
          setActiveTab={handleSetActiveTab}
          selectedProject={selectedProject}
          selectedSession={selectedSession}
          selectedWorkflow={selectedWorkflow}
          isMobile={isMobile}
          isSidebarOpen={isSidebarOpen}
          onMenuClick={onMenuClick}
          leadingContent={headerLeadingContent}
          onRefresh={onRefresh}
          dockLayout={{
            rightDockActive: layout.rightDock.activePanel,
            rightDockCollapsed: layout.rightDock.collapsed,
            lowerPanelActive: layout.lowerPanel.activePanel,
            lowerPanelCollapsed: layout.lowerPanel.collapsed,
            rightDockSplitBottom: layout.rightDock.split?.bottomPanel ?? null,
          }}
        />
        <div className="relative flex-1 flex min-h-0 overflow-hidden">
          <WorkspaceDockLayout
            layout={layout}
            isMobile={isMobile}
            centerContent={overviewCenterContent}
            rightDockContent={overviewRightDockContent}
            lowerPanelContent={overviewLowerPanelContent}
            onRightDockWidthChange={setRightDockWidth}
            onLowerPanelHeightChange={setLowerPanelHeight}
            onRightDockCollapseToggle={toggleRightDockCollapse}
            onLowerPanelCollapseToggle={toggleLowerPanelCollapse}
            onRightDockFullscreenToggle={toggleRightDockFullscreen}
            onLowerPanelFullscreenToggle={toggleLowerPanelFullscreen}
            onMoveTerminalToRightSplit={moveTerminalToRightSplit}
            onMoveTerminalToLower={moveTerminalToLower}
            onRightDockSplitRatioChange={setRightDockSplitRatio}
            rightDockTitleActions={fileDockTitleActions}
            lowerPanelActions={terminalDockActions}
          />

        </div>
      </div>
    );
  }

  // Main workspace with dock layout
  const centerContent = (
    <>
      <div className={`flex flex-col min-h-0 min-w-0 overflow-hidden ${editorExpanded ? 'hidden' : ''} flex-1`}>
        {activeTab === 'shell' ? (
          renderTerminalMainView()
        ) : (
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            <ErrorBoundary showDetails>
              <ChatInterface
                selectedProject={selectedProject}
                selectedSession={selectedSession}
                ws={ws}
                sendMessage={sendMessage}
                latestMessage={latestMessage}
                messageHistory={messageHistory}
                onFileOpen={handleFileOpen}
                onInputFocusChange={onInputFocusChange}
                onSessionActive={onSessionActive}
                onSessionInactive={onSessionInactive}
                onReplaceTemporarySession={onReplaceTemporarySession}
                onNavigateToSession={onNavigateToSession}
                onNewSession={onNewSession}
                onShowSettings={onShowSettings}
                autoExpandTools={autoExpandTools}
                showRawParameters={showRawParameters}
                showThinking={showThinking}
                autoScrollToBottom={autoScrollToBottom}
                externalMessageUpdate={externalMessageUpdate}
                renderSnapshotRequestId={renderSnapshotRequestId}
              />
            </ErrorBoundary>
          </div>
        )}

        <div className={`h-full overflow-hidden ${activeTab === 'preview' ? 'block' : 'hidden'}`} />
      </div>

      <EditorSidebar
        editingFile={editingFile}
        isMobile={isMobile}
        editorExpanded={editorExpanded}
        editorWidth={editorWidth}
        hasManualWidth={hasManualWidth}
        resizeHandleRef={resizeHandleRef}
        onResizeStart={handleResizeStart}
        onCloseEditor={handleCloseEditor}
        onToggleEditorExpand={handleToggleEditorExpand}
        projectPath={selectedProject.path}
        fillSpace={layout.rightDock.activePanel === 'files'}
      />
    </>
  );

  const rightDockContent = layout.rightDock.activePanel === 'files' ? (
    <FileTree
      selectedProject={selectedProject}
      onFileOpen={handleFileOpen}
      revealDirectoryRequest={revealDirectoryRequest}
      showViewControls={false}
    />
  ) : null;

  const lowerPanelContent = layout.lowerPanel.activePanel === 'terminal' ? (
    renderTerminalDockContent()
  ) : layout.rightDock.split?.bottomPanel === 'terminal' ? (
    renderTerminalDockContent()
  ) : null;

  if (isMobile) {
    return renderMobileShell(centerContent);
  }

  return (
    <div className="h-full flex flex-col">
      <MainContentHeader
        activeTab={activeTab}
        setActiveTab={handleSetActiveTab}
        selectedProject={selectedProject}
        selectedSession={selectedSession}
        selectedWorkflow={selectedWorkflow}
        isMobile={isMobile}
        isSidebarOpen={isSidebarOpen}
        onMenuClick={onMenuClick}
        leadingContent={headerLeadingContent}
        onRefresh={onRefresh}
        dockLayout={{
          rightDockActive: layout.rightDock.activePanel,
          rightDockCollapsed: layout.rightDock.collapsed,
          lowerPanelActive: layout.lowerPanel.activePanel,
          lowerPanelCollapsed: layout.lowerPanel.collapsed,
          rightDockSplitBottom: layout.rightDock.split?.bottomPanel ?? null,
        }}
      />

      <div className="relative flex-1 flex min-h-0 overflow-hidden">
        <WorkspaceDockLayout
          layout={layout}
          isMobile={isMobile}
          centerContent={centerContent}
          rightDockContent={rightDockContent}
          lowerPanelContent={lowerPanelContent}
          onRightDockWidthChange={setRightDockWidth}
          onLowerPanelHeightChange={setLowerPanelHeight}
          onRightDockCollapseToggle={toggleRightDockCollapse}
          onLowerPanelCollapseToggle={toggleLowerPanelCollapse}
          onRightDockFullscreenToggle={toggleRightDockFullscreen}
          onLowerPanelFullscreenToggle={toggleLowerPanelFullscreen}
          onMoveTerminalToRightSplit={moveTerminalToRightSplit}
          onMoveTerminalToLower={moveTerminalToLower}
          onRightDockSplitRatioChange={setRightDockSplitRatio}
          rightDockTitleActions={fileDockTitleActions}
          lowerPanelActions={terminalDockActions}
        />

      </div>
    </div>
  );
}

export default React.memo(MainContent);
