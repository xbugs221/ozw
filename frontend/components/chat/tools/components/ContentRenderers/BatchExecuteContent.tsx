/**
 * PURPOSE: Render context-mode batch execution payloads as intent/input/output cards.
 */
import React from 'react';
import { ContextCodeCard } from './ContextCommandContent';
import type { BatchExecutePayloadViewModel } from './toolPayloadParsers';

interface BatchExecuteContentProps {
  payload: BatchExecutePayloadViewModel;
}

/**
 * Group the noisy batch-execute JSON into cards that keep each intent beside its input and output.
 */
export const BatchExecuteContent: React.FC<BatchExecuteContentProps> = ({ payload }) => {
  const hasCommands = payload.commands.length > 0;
  const hasQueries = payload.queries.length > 0;
  const hasSections = payload.sections.length > 0;

  if (!payload.summary && !hasCommands && !hasQueries && !hasSections) {
    return null;
  }

  return (
    <div data-testid="tool-batch-execute-content" className="space-y-3">
      {payload.summary && !hasCommands && (
        <div className="text-xs text-gray-700 dark:text-gray-200 leading-5">
          {payload.summary}
        </div>
      )}

      {hasCommands && (
        <div className="space-y-3">
          {payload.commands.map((item, index) => {
            const hasMeaningfulLabel = item.label && item.label !== item.command;
            return (
              <div key={`${item.label}-${index}`} data-testid="tool-batch-command-card" className="space-y-1">
                {hasMeaningfulLabel && (
                  <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400">
                    {item.label}
                  </div>
                )}
                <ContextCodeCard
                  title=""
                  language={item.language || 'shell'}
                  code={item.command}
                  output={item.output}
                  showLanguage={false}
                  singleLineUntilWrap
                />
                {item.queryResults.length > 0 && (
                  <div className="space-y-1.5 pl-2">
                    {item.queryResults.map((result, resultIndex) => (
                      <details
                        key={`${result.query}-${result.title}-${resultIndex}`}
                        data-testid="tool-batch-query-result"
                        className="rounded border border-gray-200/70 px-2.5 py-2 dark:border-gray-700/60"
                      >
                        <summary className="cursor-pointer text-[11px] font-medium text-gray-600 dark:text-gray-300">
                          {result.query}
                        </summary>
                        <pre className="mt-2 text-[11px] font-mono whitespace-pre-wrap break-words text-gray-600 dark:text-gray-300">
                          {result.body}
                        </pre>
                      </details>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {hasQueries && (
        <div className="space-y-3">
          {payload.queries.map((item, index) => (
            <ContextCodeCard
              key={`${item.query}-${index}`}
              title="Search"
              language="text"
              code={item.query}
              output={item.output}
              showLanguage={false}
              singleLineUntilWrap
            />
          ))}
        </div>
      )}

      {hasSections && (
        <section className="space-y-1.5">
          <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400">结果</div>
          {payload.sections.map((section, index) => (
            <details
              key={`${section.title}-${index}`}
              className="rounded border border-gray-200/70 dark:border-gray-700/60 px-2.5 py-2"
            >
              <summary className="cursor-pointer text-xs font-medium text-gray-800 dark:text-gray-100">
                {section.title}
              </summary>
              <pre className="mt-2 text-[11px] font-mono whitespace-pre-wrap break-words text-gray-600 dark:text-gray-300">
                {section.body}
              </pre>
            </details>
          ))}
        </section>
      )}
    </div>
  );
};
