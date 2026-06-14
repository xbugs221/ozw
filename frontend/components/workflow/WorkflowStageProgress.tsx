/**
 * PURPOSE: Render a horizontal icon sequence showing workflow stage progress.
 * Repeated review and repair rounds are collapsed into one stable icon with a
 * count so workflow cards stay readable across multiple review loops.
 */
const Archive = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg>;
const CheckSquare = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth={sw || 2} fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="m9 12 2 2 4-4"/></svg>;
const Circle = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>;
const Eye = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>;
const FileText = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10,9 9,9 8,9"/></svg>;
const Play = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><polygon points="6,3 20,12 6,21" fill="currentColor" stroke="none"/></svg>;
const ShieldCheck = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth={sw || 2} fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>;
const Wrench = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>;
import { cn } from '../../lib/utils';
import type { WorkflowStageStatus } from '../../types/app';

const STAGE_ICON_MAP: Record<string, React.ComponentType<any>> = {
  planning: FileText,
  acceptance: CheckSquare,
  execution: Play,
  review: Eye,
  repair: Wrench,
  qa: ShieldCheck,
  archive: Archive,
};

type DisplayStage = {
  key: string;
  label: string;
  status: string;
  count: number;
};

/**
 * Map workflow stage execution state to the progress icon color.
 */
function getStageTone(status: string): string {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'completed') {
    return 'text-green-500';
  }
  if (normalized === 'active' || normalized === 'running' || normalized === 'blocked' || normalized === 'failed') {
    return 'text-blue-500';
  }
  return 'text-muted-foreground/40';
}

/**
 * Classify repeated oz flow review/fix stages into the single visual slot that
 * represents the role in compact project and sidebar cards.
 */
function getDisplayStageKey(stageKey: string): string {
  if (/^review_\d+$/.test(stageKey)) {
    return 'review';
  }
  if (/^(repair|fix)_\d+$/.test(stageKey)) {
    return 'repair';
  }
  if (/^qa_\d+$/.test(stageKey)) {
    return 'qa';
  }
  return stageKey;
}

/**
 * Merge repeated stages while preserving the original ordering of the workflow
 * and giving active or failed rounds priority in the visible status color.
 */
function buildDisplayStages(stageStatuses: WorkflowStageStatus[]): DisplayStage[] {
  const stages = new Map<string, DisplayStage>();
  for (const stage of stageStatuses) {
    const key = getDisplayStageKey(stage.key);
    const previous = stages.get(key);
    if (!previous) {
      stages.set(key, {
        key,
        label: key === 'review' ? '审核' : key === 'repair' ? '修复' : stage.label,
        status: stage.status,
        count: 1,
      });
      continue;
    }

    previous.count += 1;
    const normalized = String(stage.status || '').toLowerCase();
    const currentStatus = String(previous.status || '').toLowerCase();
    if (normalized === 'active' || normalized === 'running' || normalized === 'blocked' || normalized === 'failed') {
      previous.status = stage.status;
    } else if (currentStatus !== 'active' && currentStatus !== 'running' && currentStatus !== 'blocked' && currentStatus !== 'failed') {
      previous.status = stage.status;
    }
  }
  return [...stages.values()];
}

interface WorkflowStageProgressProps {
  stageStatuses: WorkflowStageStatus[];
  size?: 'sm' | 'md';
}

export default function WorkflowStageProgress({ stageStatuses, size = 'md' }: WorkflowStageProgressProps) {
  const iconSize = size === 'sm' ? 'h-3 w-3' : 'h-4 w-4';
  const textSize = size === 'sm' ? 'text-[10px]' : 'text-xs';

  if (!stageStatuses || stageStatuses.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-0.5" aria-label="工作流阶段进度">
      {buildDisplayStages(stageStatuses).map((stage) => {
        const Icon = STAGE_ICON_MAP[stage.key] || Circle;
        return (
          <span
            key={stage.key}
            className="inline-flex items-center gap-0.5"
            data-testid={`workflow-stage-progress-${stage.key}`}
            title={`${stage.label}: ${stage.status}`}
            aria-label={`${stage.label}: ${stage.status}${stage.count > 1 || stage.key === 'review' || stage.key === 'repair' ? ` x${stage.count}` : ''}`}
          >
            <Icon className={cn(iconSize, getStageTone(stage.status))} aria-hidden="true" />
            {(stage.key === 'review' || stage.key === 'repair') ? (
              <span className={cn('font-medium tabular-nums text-muted-foreground', textSize)}>
                x{stage.count}
              </span>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}
