/**
 * PURPOSE: Render update_plan payloads as a readable checklist instead of raw JSON.
 */
import React from 'react';
import type { PlanPayloadViewModel } from './toolPayloadParsers';

interface PlanContentProps {
  plan: PlanPayloadViewModel;
}

const statusUi = {
  completed: {
    dot: 'bg-green-500 dark:bg-green-400',
    text: '已完成',
    textClass: 'text-green-700 dark:text-green-300',
  },
  in_progress: {
    dot: 'bg-blue-500 dark:bg-blue-400',
    text: '进行中',
    textClass: 'text-blue-700 dark:text-blue-300',
  },
  pending: {
    dot: 'bg-gray-300 dark:bg-gray-600',
    text: '待处理',
    textClass: 'text-gray-500 dark:text-gray-400',
  },
} as const;

/**
 * Keep the view dense while still surfacing explanation and per-step status clearly.
 */
export const PlanContent: React.FC<PlanContentProps> = ({ plan }) => {
  if (!plan.explanation && plan.steps.length === 0) {
    return null;
  }

  return (
    <div data-testid="tool-plan-content" className="space-y-2">
      {plan.explanation && (
        <p className="text-xs text-gray-600 dark:text-gray-300 leading-5 whitespace-pre-wrap">
          {plan.explanation}
        </p>
      )}

      <div className="space-y-1.5">
        {plan.steps.map((item, index) => {
          const ui = statusUi[item.status];
          return (
            <div
              key={`${item.step}-${index}`}
              data-testid={`tool-plan-step-${index}`}
              className="flex items-start gap-2 rounded border border-gray-200/70 dark:border-gray-700/60 px-2.5 py-2"
            >
              <span className={`mt-1 h-2 w-2 rounded-full flex-shrink-0 ${ui.dot}`} />
              <div className="min-w-0 flex-1">
                <div className="text-xs text-gray-800 dark:text-gray-100 leading-5 whitespace-pre-wrap">
                  {item.step}
                </div>
              </div>
              <span className={`text-[10px] font-medium flex-shrink-0 ${ui.textClass}`}>
                {ui.text}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
