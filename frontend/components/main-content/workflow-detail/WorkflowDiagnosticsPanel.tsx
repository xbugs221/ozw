/**
 * PURPOSE: Render workflow diagnostics warnings as a small reusable panel.
 */
import type { ProjectWorkflow } from '../../../types/app';

export function getWorkflowDiagnosticWarnings(workflow: ProjectWorkflow): string[] {
  /** Normalize backend mapping warnings for diagnostics display. */
  const diagnostics = (workflow.runnerDiagnostics || workflow.diagnostics || {}) as Record<string, unknown>;
  return Array.isArray(diagnostics.warnings) ? diagnostics.warnings.map(String).filter(Boolean) : [];
}

export function WorkflowDiagnosticsPanel({ workflow }: { workflow: ProjectWorkflow }) {
  /** Render workflow diagnostics only when the backend has warnings. */
  const warnings = getWorkflowDiagnosticWarnings(workflow);
  if (warnings.length === 0) return null;
  return <section className="space-y-1">{warnings.map((warning) => <div key={warning} className="text-xs text-muted-foreground">{warning}</div>)}</section>;
}
