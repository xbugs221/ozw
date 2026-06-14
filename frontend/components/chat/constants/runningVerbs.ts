/**
 * PURPOSE: Provide the local action-verb pool used by the active turn status line.
 */

export const RUNNING_VERB_INTERVAL_MS = 5000;

export const RUNNING_STATUS_VERBS = [
  'Analyze',
  'Audit',
  'Balance',
  'Build',
  'Calculate',
  'Catalog',
  'Check',
  'Clarify',
  'Classify',
  'Collect',
  'Compare',
  'Compile',
  'Connect',
  'Convert',
  'Correlate',
  'Crosscheck',
  'Debug',
  'Decode',
  'Deduce',
  'Design',
  'Detect',
  'Diagnose',
  'Differentiate',
  'Draft',
  'Evaluate',
  'Examine',
  'Expand',
  'Extract',
  'Filter',
  'Find',
  'Format',
  'Generate',
  'Group',
  'Harmonize',
  'Identify',
  'Infer',
  'Inspect',
  'Integrate',
  'Interpret',
  'Isolate',
  'Link',
  'Map',
  'Measure',
  'Merge',
  'Model',
  'Normalize',
  'Organize',
  'Outline',
  'Patch',
  'Plan',
  'Probe',
  'Process',
  'Profile',
  'Rank',
  'Reason',
  'Reconcile',
  'Refactor',
  'Refine',
  'Render',
  'Repair',
  'Resolve',
  'Review',
  'Route',
  'Scan',
  'Search',
  'Select',
  'Sequence',
  'Shape',
  'Simulate',
  'Sketch',
  'Sort',
  'Stabilize',
  'Summarize',
  'Synthesize',
  'Test',
  'Trace',
  'Transform',
  'Validate',
  'Verify',
  'Weigh',
] as const;

/**
 * Pick a visible status verb while avoiding an immediate repeat when possible.
 */
export function pickRandomRunningVerb(previous?: string): string {
  const verbCount: number = RUNNING_STATUS_VERBS.length;

  if (verbCount === 1) {
    return RUNNING_STATUS_VERBS[0];
  }

  let next = RUNNING_STATUS_VERBS[Math.floor(Math.random() * verbCount)];
  if (previous && next === previous) {
    const currentIndex = RUNNING_STATUS_VERBS.indexOf(next);
    next = RUNNING_STATUS_VERBS[(currentIndex + 1) % verbCount];
  }

  return next;
}
