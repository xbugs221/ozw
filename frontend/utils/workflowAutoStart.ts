/**
 * PURPOSE: Share manual session creation option types without owning workflow
 * runner startup; oz flow resume/run is the only automatic workflow execution path.
 */
import type { SessionProvider } from '../types/app';

export type NewSessionOptions = {
  initialPrompt?: string;
  promptForLabel?: boolean;
  workflowId?: string;
  sessionSummary?: string;
  workflowTitle?: string;
  workflowChangeName?: string;
  workflowStageKey?: string;
  workflowRepairPass?: number;
  workflowReviewProfile?: string;
  provider?: SessionProvider;
};
