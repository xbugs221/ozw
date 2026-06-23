/**
 * PURPOSE: Shared chat view contracts used by session adapters, message
 * transforms, and transcript rendering components.
 */
import type { Project, ProjectSession, SessionProvider } from '../../../types/app';
import type { NewSessionOptions } from '../../../utils/workflowAutoStart';

type SocketMessageEnvelope = { sequence: number; message: any };

export type Provider = SessionProvider;

export type PermissionMode = 'bypassPermissions';

export interface ChatAttachment {
  absolutePath?: string;
  kind?: 'file' | 'directory';
  mimeType?: string;
  name: string;
  relativePath?: string;
  size?: number;
}

export interface ToolResult {
  content?: unknown;
  isError?: boolean;
  timestamp?: string | number | Date;
  toolUseResult?: unknown;
  [key: string]: unknown;
}

export interface SubagentChildTool {
  toolId: string;
  toolName: string;
  toolInput: unknown;
  toolResult?: ToolResult | null;
  timestamp: Date;
}

export interface ChatMessage {
  type: string;
  content?: string;
  timestamp: string | number | Date;
  deliveryStatus?: 'pending' | 'sent' | 'persisted' | 'failed';
  phase?: string;
  messageKey?: string;
  clientRequestId?: string;
  requestId?: string;
  submittedContent?: string;
  attachments?: ChatAttachment[];
  images?: ChatAttachment[];
  reasoning?: string;
  isThinking?: boolean;
  isTaskNotification?: boolean;
  taskKind?: string;
  taskStatus?: string;
  completedAt?: string | number | Date;
  durationMs?: number;
  timeToFirstTokenMs?: number;
  isStreaming?: boolean;
  isInteractivePrompt?: boolean;
  isToolUse?: boolean;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: ToolResult | null;
  toolId?: string;
  toolCallId?: string;
  isSubagentContainer?: boolean;
  subagentState?: {
    childTools: SubagentChildTool[];
    currentToolIndex: number;
    isComplete: boolean;
  };
  [key: string]: unknown;
}

export interface PendingPermissionRequest {
  requestId: string;
  toolName: string;
  input?: unknown;
  context?: unknown;
  sessionId?: string | null;
  receivedAt?: Date;
}

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface Question {
  question: string;
  header?: string;
  options: QuestionOption[];
  multiSelect?: boolean;
}

export interface ChatInterfaceProps {
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  ws: WebSocket | null;
  sendMessage: (message: unknown) => void;
  latestMessage: any;
  messageHistory: SocketMessageEnvelope[];
  onFileOpen?: (filePath: string, diffInfo?: any) => void;
  onInputFocusChange?: (focused: boolean) => void;
  onSessionActive?: (sessionId?: string | null) => void;
  onSessionInactive?: (sessionId?: string | null) => void;
  onReplaceTemporarySession?: (sessionId?: string | null) => void;
  onNavigateToSession?: (
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
  onNewSession?: (project: Project, provider?: SessionProvider, options?: NewSessionOptions) => void;
  onShowSettings?: () => void;
  autoExpandTools?: boolean;
  showRawParameters?: boolean;
  showThinking?: boolean;
  autoScrollToBottom?: boolean;
  externalMessageUpdate?: number;
  onTaskClick?: (...args: unknown[]) => void;
}
