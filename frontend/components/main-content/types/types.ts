import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { AppTab, Project, ProjectSession, ProjectWorkflow, SessionProvider } from '../../../types/app';
import type { SocketMessageEnvelope } from '../../../contexts/WebSocketContext';
import type { SessionWithProvider } from '../../sidebar/types/types';
import type { NewSessionOptions } from '../../../utils/workflowAutoStart';

export type SessionLifecycleHandler = (sessionId?: string | null) => void;
export type NewSessionResult = { ok: true } | { ok: false; error: string };
export type NewSessionHandler = (
  project: Project,
  provider?: SessionProvider,
  options?: NewSessionOptions,
) => Promise<NewSessionResult | void> | NewSessionResult | void;

export type MainContentProps = {
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  selectedWorkflow?: ProjectWorkflow | null;
  activeTab: AppTab;
  setActiveTab: Dispatch<SetStateAction<AppTab>>;
  ws: WebSocket | null;
  sendMessage: (message: unknown) => void;
  latestMessage: unknown;
  messageHistory: SocketMessageEnvelope[];
  isMobile: boolean;
  isSidebarOpen: boolean;
  onMenuClick: () => void;
  isLoading: boolean;
  onInputFocusChange: (focused: boolean) => void;
  onSessionActive: SessionLifecycleHandler;
  onSessionInactive: SessionLifecycleHandler;
  onReplaceTemporarySession: SessionLifecycleHandler;
  onNavigateToSession: (
    targetSessionId: string,
    options?: {
      provider?: SessionProvider;
      projectName?: string;
      projectPath?: string;
      workflowId?: string;
      workflowStageKey?: string;
      routeSearch?: Record<string, string>;
    },
  ) => void;
  onSelectProjectOverview: (project: Project) => void;
  onSelectSession: (session: ProjectSession) => void;
  onSelectWorkflow: (project: Project, workflow: ProjectWorkflow) => void;
  onNewSession: NewSessionHandler;
  onShowSettings: () => void;
  onRefresh: () => Promise<void> | void;
  onRenderSnapshotRequest?: () => void;
  externalMessageUpdate: number;
  renderSnapshotRequestId?: number;
  headerLeadingContent?: ReactNode;
};

export type DockLayoutControl = {
  rightDockActive: 'files' | null;
  rightDockCollapsed: boolean;
  lowerPanelActive: 'terminal' | null;
  lowerPanelCollapsed: boolean;
  rightDockSplitBottom?: 'terminal' | null;
};

export type MainContentHeaderProps = {
  activeTab: AppTab;
  setActiveTab: Dispatch<SetStateAction<AppTab>>;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  selectedWorkflow?: ProjectWorkflow | null;
  isMobile: boolean;
  isSidebarOpen: boolean;
  onMenuClick: () => void;
  leadingContent?: ReactNode;
  dockLayout?: DockLayoutControl;
  onRefresh?: () => Promise<void> | void;
  isRenderingSnapshot?: boolean;
  readOnlyProviderCollection?: boolean;
};

export type MainContentStateViewProps = {
  mode: 'loading' | 'empty';
  isMobile: boolean;
  isSidebarOpen: boolean;
  onMenuClick: () => void;
};

export type MobileMenuButtonProps = {
  onMenuClick: () => void;
  compact?: boolean;
};

export type ProjectOverviewPanelProps = {
  project: Project;
  selectedSession: ProjectSession | null;
  selectedWorkflow?: ProjectWorkflow | null;
  sessions: SessionWithProvider[];
  displayMode?: 'all' | 'workflows' | 'sessions';
  onNewSession: NewSessionHandler;
  onSelectSession: (session: ProjectSession) => void;
  onOpenSessionTerminal?: (session: ProjectSession) => void;
  onSelectWorkflow: (project: Project, workflow: ProjectWorkflow) => void;
};
