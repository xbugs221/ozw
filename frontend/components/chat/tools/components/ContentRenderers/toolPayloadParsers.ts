/**
 * PURPOSE: Normalize tool payloads into structured view models for chat tool renderers.
 * These helpers keep parsing logic out of React components so tool configs can stay thin.
 */

import { trimOuterBlankLines } from '../../../utils/toolTextNormalization';

export type PlanStepStatus = 'completed' | 'in_progress' | 'pending';

export interface PlanStepViewModel {
  step: string;
  status: PlanStepStatus;
}

export interface PlanPayloadViewModel {
  explanation: string;
  steps: PlanStepViewModel[];
}

export interface BatchExecuteCommandViewModel {
  label: string;
  command: string;
  language: string;
  output: string;
  queryResults: BatchExecuteQueryResultViewModel[];
}

export interface BatchExecuteQueryViewModel {
  query: string;
  output: string;
}

export interface BatchExecuteQueryResultViewModel {
  query: string;
  title: string;
  body: string;
}

export interface BatchExecuteSectionViewModel {
  title: string;
  body: string;
}

export interface BatchExecutePayloadViewModel {
  summary: string;
  commands: BatchExecuteCommandViewModel[];
  queries: BatchExecuteQueryViewModel[];
  sections: BatchExecuteSectionViewModel[];
}

export interface ContextCommandMetadataViewModel {
  label: string;
  value: string;
}

export interface ContextCommandPayloadViewModel {
  intent: string;
  language: string;
  path: string;
  code: string;
  output: string;
  queries: string[];
  metadata: ContextCommandMetadataViewModel[];
  fallback: string;
}

export interface FileChangeViewModel {
  kind: string;
  path: string;
  diffInfo?: {
    old_string?: string;
    new_string?: string;
  };
}

export interface FileChangesPayloadViewModel {
  status: string;
  changes: FileChangeViewModel[];
}

type UnknownRecord = Record<string, unknown>;
type SectionEntry = { section: BatchExecuteSectionViewModel; index: number };

/**
 * Parse stringified JSON when possible and leave plain text untouched.
 */
function parseJsonMaybe<T = unknown>(value: unknown): T | unknown {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }

  if (!['{', '[', '"'].includes(trimmed[0])) {
    return value;
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return value;
  }
}

/**
 * Unwrap common tool result envelopes such as { content, output, text }.
 */
function unwrapToolPayload(value: unknown): unknown {
  const parsed = parseJsonMaybe(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return parsed;
  }

  const record = parsed as UnknownRecord;
  const nested = record.content ?? record.output ?? record.text ?? record.result;
  if (nested !== undefined && nested !== parsed) {
    return parseJsonMaybe(nested);
  }

  return parsed;
}

/**
 * Convert query arrays from context-mode inputs into trimmed display strings.
 */
function normalizeQueryList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const queries = value
    .map((item) => {
      if (typeof item === 'string') {
        return item.trim();
      }
      if (item && typeof item === 'object') {
        const record = item as UnknownRecord;
        const query = record.query ?? record.q ?? record.text;
        return typeof query === 'string' ? query.trim() : '';
      }
      return '';
    })
    .filter((item) => item.length > 0);

  return Array.from(new Set(queries));
}

/**
 * Convert mixed tool result envelopes into displayable plain text.
 */
function normalizeToolText(value: unknown): string {
  const payload = unwrapToolPayload(value);

  if (payload === null || payload === undefined) {
    return '';
  }

  if (typeof payload === 'string') {
    return payload;
  }

  if (Array.isArray(payload)) {
    return payload.map((item) => normalizeToolText(item)).filter(Boolean).join('\n\n');
  }

  if (typeof payload === 'object') {
    const record = payload as UnknownRecord;
    const nested = record.text ?? record.content ?? record.output ?? record.stdout ?? record.stderr ?? record.result;
    if (nested !== undefined && nested !== payload) {
      return normalizeToolText(nested);
    }
    try {
      return JSON.stringify(payload, null, 2);
    } catch {
      return String(payload);
    }
  }

  return String(payload);
}

/**
 * Split markdown-style context-mode output into headed sections.
 */
function parseMarkdownSections(fullText: string): BatchExecuteSectionViewModel[] {
  const sections: BatchExecuteSectionViewModel[] = [];
  let currentSection: BatchExecuteSectionViewModel | null = null;

  for (const line of fullText.split('\n')) {
    if (line.startsWith('## ')) {
      if (currentSection && currentSection.body.trim()) {
        sections.push({
          title: currentSection.title,
          body: currentSection.body.trim(),
        });
      }
      currentSection = {
        title: line.slice(3).trim(),
        body: '',
      };
      continue;
    }

    if (currentSection) {
      currentSection.body += `${currentSection.body ? '\n' : ''}${line}`;
    }
  }

  if (currentSection && currentSection.body.trim()) {
    sections.push({
      title: currentSection.title,
      body: currentSection.body.trim(),
    });
  }

  return sections;
}

/**
 * Split one query result section into source chunks produced from indexed command output.
 */
function parseMarkdownSubsections(fullText: string): BatchExecuteSectionViewModel[] {
  const sections: BatchExecuteSectionViewModel[] = [];
  let currentSection: BatchExecuteSectionViewModel | null = null;

  for (const line of fullText.split('\n')) {
    if (line.startsWith('### ')) {
      if (currentSection && currentSection.body.trim()) {
        sections.push({
          title: currentSection.title,
          body: currentSection.body.trim(),
        });
      }
      currentSection = {
        title: line.slice(4).trim(),
        body: '',
      };
      continue;
    }

    if (currentSection) {
      currentSection.body += `${currentSection.body ? '\n' : ''}${line}`;
    }
  }

  if (currentSection && currentSection.body.trim()) {
    sections.push({
      title: currentSection.title,
      body: currentSection.body.trim(),
    });
  }

  return sections;
}

/**
 * Detect whether a result heading came from one of the query inputs.
 */
function sectionTitleMatchesQuery(title: string, query: string): boolean {
  const normalizedTitle = title.trim().toLowerCase();
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedTitle || !normalizedQuery) {
    return false;
  }

  return normalizedTitle === normalizedQuery ||
    normalizedTitle.includes(normalizedQuery) ||
    normalizedQuery.includes(normalizedTitle);
}

/**
 * Score how strongly one query-result source belongs to a command label.
 */
function scoreCommandSource(command: BatchExecuteCommandViewModel, sourceTitle: string): number {
  const label = command.label.trim().toLowerCase();
  const source = sourceTitle.trim().toLowerCase();
  if (!label || !source) {
    return 0;
  }
  if (source === label) {
    return 100;
  }
  if (source.includes(label) || label.includes(source)) {
    return 80;
  }

  const labelWords = label.split(/\W+/).filter((word) => word.length >= 3);
  const sourceWords = source.split(/\W+/).filter((word) => word.length >= 3);
  return labelWords.reduce((score, labelWord) => {
    const matched = sourceWords.some((sourceWord) => (
      sourceWord === labelWord ||
      sourceWord.includes(labelWord) ||
      labelWord.includes(sourceWord)
    ));
    return matched ? score + 10 : score;
  }, 0);
}

/**
 * Find the command that produced one query-result source chunk.
 */
function findCommandIndexForSource(commands: BatchExecuteCommandViewModel[], sourceTitle: string): number {
  let bestIndex = -1;
  let bestScore = 0;

  commands.forEach((command, index) => {
    const score = scoreCommandSource(command, sourceTitle);
    if (score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  });

  return bestScore > 0 ? bestIndex : -1;
}

/**
 * Match batch result sections back to the command label that produced them.
 * Falls back through multiple strategies: title inclusion, reverse inclusion,
 * shared-word matching, and finally sequential assignment.
 */
function findCommandOutput(command: BatchExecuteCommandViewModel, sectionEntries: SectionEntry[], usedSectionIndexes: Set<number>): string {
  const label = command.label.trim().toLowerCase();
  if (!label) {
    return '';
  }

  // Strategy 1: section title contains command label
  let matched = sectionEntries
    .filter(({ section, index }) => {
      if (usedSectionIndexes.has(index)) {
        return false;
      }
      return section.title.toLowerCase().includes(label);
    });

  // Strategy 2: reverse — command label contains section title
  if (matched.length === 0) {
    matched = sectionEntries
      .filter(({ section, index }) => {
        if (usedSectionIndexes.has(index)) {
          return false;
        }
        return label.includes(section.title.toLowerCase());
      });
  }

  // Strategy 3: shared word match (words >= 3 chars)
  if (matched.length === 0) {
    const labelWords = label.split(/\W+/).filter((w) => w.length >= 3);
    matched = sectionEntries
      .filter(({ section, index }) => {
        if (usedSectionIndexes.has(index)) {
          return false;
        }
        const titleWords = section.title.toLowerCase().split(/\W+/).filter((w) => w.length >= 3);
        return labelWords.some((lw) => titleWords.some((tw) => tw === lw || tw.includes(lw) || lw.includes(tw)));
      });
  }

  for (const { index } of matched) {
    usedSectionIndexes.add(index);
  }

  return matched.map(({ section }) => section.body).join('\n\n');
}

/**
 * Match context-mode query result sections back to their query input.
 */
function findQueryOutput(query: string, sections: BatchExecuteSectionViewModel[], usedSectionIndexes: Set<number>): string {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return '';
  }

  const matched = sections
    .map((section, index) => ({ section, index }))
    .filter(({ section, index }) => {
      if (usedSectionIndexes.has(index)) {
        return false;
      }
      const normalizedTitle = section.title.trim().toLowerCase();
      return normalizedTitle === normalizedQuery ||
        normalizedTitle.includes(normalizedQuery) ||
        normalizedQuery.includes(normalizedTitle);
    });

  for (const { index } of matched) {
    usedSectionIndexes.add(index);
  }

  return matched.map(({ section }) => section.body).join('\n\n');
}

/**
 * Normalize plan status strings from mixed sources.
 */
function normalizePlanStatus(status: unknown): PlanStepStatus {
  if (status === 'completed' || status === 'done' || status === 'success') {
    return 'completed';
  }
  if (status === 'in_progress' || status === 'active' || status === 'running') {
    return 'in_progress';
  }
  return 'pending';
}

/**
 * Convert update_plan input/result payloads into a stable checklist model.
 */
export function parsePlanPayload(value: unknown): PlanPayloadViewModel {
  const payload = unwrapToolPayload(value);
  const record = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as UnknownRecord
    : null;
  const rawSteps = Array.isArray(record?.plan) ? record.plan : [];

  const steps = rawSteps
    .map((item): PlanStepViewModel | null => {
      if (typeof item === 'string') {
        return { step: item, status: 'pending' };
      }
      if (!item || typeof item !== 'object') {
        return null;
      }
      const stepRecord = item as UnknownRecord;
      const step = typeof stepRecord.step === 'string'
        ? stepRecord.step
        : typeof stepRecord.title === 'string'
          ? stepRecord.title
          : '';
      if (!step) {
        return null;
      }
      return {
        step,
        status: normalizePlanStatus(stepRecord.status),
      };
    })
    .filter((item): item is PlanStepViewModel => Boolean(item));

  return {
    explanation: typeof record?.explanation === 'string' ? record.explanation : '',
    steps,
  };
}

/**
 * Flatten context-mode batch execution responses into readable UI sections.
 */
export function parseBatchExecutePayload(inputValue: unknown, resultValue?: unknown): BatchExecutePayloadViewModel {
  const input = unwrapToolPayload(inputValue);
  const result = unwrapToolPayload(resultValue);
  const inputRecord = input && typeof input === 'object' && !Array.isArray(input)
    ? input as UnknownRecord
    : null;

  const commands = Array.isArray(inputRecord?.commands)
    ? inputRecord.commands
      .map((item): BatchExecuteCommandViewModel | null => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        const commandRecord = item as UnknownRecord;
        const command = typeof commandRecord.command === 'string' ? commandRecord.command : '';
        if (!command) {
          return null;
        }
        return {
          label: typeof commandRecord.label === 'string' ? commandRecord.label : command,
          command,
          language: typeof commandRecord.language === 'string' ? commandRecord.language : 'shell',
          output: '',
          queryResults: [],
        };
      })
      .filter((item): item is BatchExecuteCommandViewModel => Boolean(item))
    : [];

  const queryInputs = normalizeQueryList(inputRecord?.queries);

  const fullText = normalizeToolText(result).trim();
  const summary = fullText.split('\n').find((line) => line.trim()) || '';
  const sections = parseMarkdownSections(fullText);
  const querySectionIndexes = new Set<number>();
  sections.forEach((section, index) => {
    if (queryInputs.some((query) => sectionTitleMatchesQuery(section.title, query))) {
      querySectionIndexes.add(index);
    }
  });
  const usedSectionIndexes = new Set<number>();
  const directOutputSections = sections
    .map((section, index) => ({ section, index }))
    .filter(({ section, index }) => (
      !querySectionIndexes.has(index) &&
      section.title.trim().toLowerCase() !== 'indexed sections'
    ));
  const commandsWithOutput = commands.map((command) => ({
    ...command,
    output: findCommandOutput(command, directOutputSections, usedSectionIndexes),
  }));

  // Fallback: assign remaining sections to commands without output in order
  const remainingAfterMatch = sections.filter((section, index) => (
    !usedSectionIndexes.has(index) &&
    !querySectionIndexes.has(index) &&
    section.title.trim().toLowerCase() !== 'indexed sections'
  ));
  const commandsNeedingOutput = commandsWithOutput
    .map((cmd, index) => ({ cmd, index }))
    .filter(({ cmd }) => !cmd.output.trim());

  remainingAfterMatch.forEach((section, i) => {
    if (i < commandsNeedingOutput.length) {
      commandsWithOutput[commandsNeedingOutput[i].index].output = section.body;
      usedSectionIndexes.add(sections.indexOf(section));
    }
  });

  if (commandsWithOutput.length === 1 && !commandsWithOutput[0].output && fullText && querySectionIndexes.size === 0) {
    commandsWithOutput[0].output = fullText;
  }

  const standaloneQueries: BatchExecuteQueryViewModel[] = [];

  queryInputs.forEach((query) => {
    const matchedQuerySections = sections
      .map((section, index) => ({ section, index }))
      .filter(({ section, index }) => querySectionIndexes.has(index) && sectionTitleMatchesQuery(section.title, query));
    let attachedAny = false;

    matchedQuerySections.forEach(({ section, index }) => {
      let sectionAttached = false;
      const sourceSections = parseMarkdownSubsections(section.body);
      if (sourceSections.length === 0) {
        const commandIndex = commandsWithOutput.length === 1
          ? 0
          : findCommandIndexForSource(commandsWithOutput, section.title);
        if (commandIndex >= 0) {
          commandsWithOutput[commandIndex].queryResults.push({
            query,
            title: section.title,
            body: section.body,
          });
          usedSectionIndexes.add(index);
          attachedAny = true;
          sectionAttached = true;
        }
        return;
      }

      sourceSections.forEach((sourceSection) => {
        const commandIndex = findCommandIndexForSource(commandsWithOutput, sourceSection.title);
        if (commandIndex < 0) {
          return;
        }
        commandsWithOutput[commandIndex].queryResults.push({
          query,
          title: sourceSection.title,
          body: sourceSection.body,
        });
        attachedAny = true;
        sectionAttached = true;
      });

      if (sectionAttached) {
        usedSectionIndexes.add(index);
      }
    });

    if (!attachedAny && commandsWithOutput.length === 0) {
      standaloneQueries.push({
        query,
        output: findQueryOutput(query, sections, usedSectionIndexes),
      });
    }
  });

  const remainingSections = sections.filter((_, index) => !usedSectionIndexes.has(index));

  return {
    summary,
    commands: commandsWithOutput,
    queries: standaloneQueries,
    sections: remainingSections,
  };
}

/**
 * Flatten a single context-mode tool input into the fields users need to inspect.
 */
export function parseContextCommandPayload(value: unknown, resultValue?: unknown): ContextCommandPayloadViewModel {
  const payload = unwrapToolPayload(value);
  const record = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as UnknownRecord
    : null;

  const metadata: ContextCommandMetadataViewModel[] = [];
  const addMetadata = (label: string, rawValue: unknown) => {
    if (typeof rawValue !== 'string' && typeof rawValue !== 'number' && typeof rawValue !== 'boolean') {
      return;
    }
    const stringValue = String(rawValue).trim();
    if (!stringValue) {
      return;
    }
    metadata.push({ label, value: stringValue });
  };

  if (record) {
    addMetadata('path', record.path);
    addMetadata('source', record.source);
    addMetadata('url', record.url);
    addMetadata('timeout', record.timeout);
    addMetadata('limit', record.limit);
    addMetadata('background', record.background);
    addMetadata('force', record.force);
  }

  const fallback = (() => {
    if (typeof payload === 'string') {
      return payload;
    }
    try {
      return JSON.stringify(payload ?? value, null, 2);
    } catch {
      return String(payload ?? value ?? '');
    }
  })();

  return {
    intent: typeof record?.intent === 'string' ? record.intent : '',
    language: typeof record?.language === 'string' ? record.language : '',
    path: typeof record?.path === 'string' ? record.path : '',
    code: typeof record?.code === 'string' ? record.code : '',
    output: trimOuterBlankLines(normalizeToolText(resultValue)),
    queries: normalizeQueryList(record?.queries),
    metadata,
    fallback,
  };
}

/**
 * Normalize file change events from either structured JSON or legacy plain text.
 */
export function parseFileChangesPayload(value: unknown, resultValue?: unknown): FileChangesPayloadViewModel {
  const payload = unwrapToolPayload(value);
  const result = unwrapToolPayload(resultValue);
  const record = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as UnknownRecord
    : null;

  const statusFromResult = result && typeof result === 'object' && !Array.isArray(result)
    ? (result as UnknownRecord).status
    : undefined;
  const status = typeof record?.status === 'string'
    ? record.status
    : typeof statusFromResult === 'string'
      ? statusFromResult
      : '';

  if (Array.isArray(record?.changes)) {
    return {
      status,
      changes: record.changes
        .map((item): FileChangeViewModel | null => {
          if (!item || typeof item !== 'object') {
            return null;
          }
          const changeRecord = item as UnknownRecord;
          const path = typeof changeRecord.path === 'string' ? changeRecord.path : '';
          if (!path) {
            return null;
          }
          const oldString = typeof changeRecord.old_string === 'string'
            ? changeRecord.old_string
            : typeof record?.old_string === 'string'
              ? record.old_string
              : undefined;
          const newString = typeof changeRecord.new_string === 'string'
            ? changeRecord.new_string
            : typeof record?.new_string === 'string'
              ? record.new_string
              : undefined;

          return {
            kind: typeof changeRecord.kind === 'string' ? changeRecord.kind : 'changed',
            path,
            ...(
              oldString !== undefined || newString !== undefined
                ? {
                    diffInfo: {
                      ...(oldString !== undefined ? { old_string: oldString } : {}),
                      ...(newString !== undefined ? { new_string: newString } : {}),
                    },
                  }
                : {}
            ),
          };
        })
        .filter((item): item is FileChangeViewModel => Boolean(item)),
    };
  }

  const rawText = typeof payload === 'string'
    ? payload
    : typeof record?.content === 'string'
      ? record.content
      : '';

  return {
    status,
    changes: rawText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const separatorIndex = line.indexOf(':');
        if (separatorIndex === -1) {
          return { kind: 'changed', path: line };
        }
        return {
          kind: line.slice(0, separatorIndex).trim(),
          path: line.slice(separatorIndex + 1).trim(),
        };
      }),
  };
}
