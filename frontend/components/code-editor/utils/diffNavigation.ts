/**
 * PURPOSE: Resolve CodeMirror diff navigation targets from merge chunks or
 * old/new text snapshots so tool-opened edits land on the changed region.
 */
import { getChunks } from '@codemirror/merge';
import { EditorView } from '@codemirror/view';
import type { CodeEditorFile } from '../types/types';

/**
 * Return whether an editor file has comparable old/new text snapshots.
 */
export const hasComparableDiffText = (file: CodeEditorFile): boolean => (
  typeof file.diffInfo?.old_string === 'string'
  && typeof file.diffInfo?.new_string === 'string'
  && file.diffInfo.old_string !== file.diffInfo.new_string
);

/**
 * Find the first one-based line where two text snapshots differ.
 */
export const getFirstChangedLineNumber = (oldText: string, newText: string): number => {
  const oldLines = oldText.split(/\r\n|\r|\n/);
  const newLines = newText.split(/\r\n|\r|\n/);
  const lineCount = Math.max(oldLines.length, newLines.length);

  for (let index = 0; index < lineCount; index += 1) {
    if ((oldLines[index] ?? '') !== (newLines[index] ?? '')) {
      return index + 1;
    }
  }

  return 1;
};

/**
 * Resolve the first diff position from CodeMirror chunks, falling back to the
 * comparable text snapshots when chunk decorations are not available yet.
 */
export const getDiffPosition = (view: EditorView, file: CodeEditorFile, chunkIndex = 0): number | null => {
  const chunks = getChunks(view.state)?.chunks || [];
  const chunk = chunks[chunkIndex] || chunks[0];

  if (chunk) {
    return chunk.fromB;
  }

  if (!hasComparableDiffText(file)) {
    return null;
  }

  const oldText = file.diffInfo?.old_string as string;
  const newText = file.diffInfo?.new_string as string;
  const targetLineNumber = getFirstChangedLineNumber(oldText, newText);
  const safeLineNumber = Math.max(1, Math.min(targetLineNumber, view.state.doc.lines));

  return view.state.doc.line(safeLineNumber).from;
};

/**
 * Scroll to a diff position and put the cursor there so the target is visible.
 */
export const focusDiffPosition = (view: EditorView, position: number) => {
  view.dispatch({
    selection: { anchor: position },
    effects: EditorView.scrollIntoView(position, { y: 'center' }),
  });
  view.focus();
};
