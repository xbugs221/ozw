/**
 * PURPOSE: Build CodeMirror language, minimap, and diff positioning extensions
 * used by the workspace text editor.
 */
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { StreamLanguage } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { getChunks } from '@codemirror/merge';
import { EditorView, ViewPlugin } from '@codemirror/view';
import { showMinimap } from '@replit/codemirror-minimap';
import type { CodeEditorFile } from '../types/types';
import { focusDiffPosition, getDiffPosition } from './diffNavigation';

// Lightweight lexer for `.env` files (including `.env.*` variants).
const envLanguage = StreamLanguage.define({
  token(stream) {
    if (stream.match(/^#.*/)) return 'comment';
    if (stream.sol() && stream.match(/^[A-Za-z_][A-Za-z0-9_.]*(?==)/)) return 'variableName.definition';
    if (stream.match(/^=/)) return 'operator';
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return 'string';
    if (stream.match(/^'(?:[^'\\]|\\.)*'?/)) return 'string';
    if (stream.match(/^\$\{[^}]*\}?/)) return 'variableName.special';
    if (stream.match(/^\$[A-Za-z_][A-Za-z0-9_]*/)) return 'variableName.special';
    if (stream.match(/^\d+/)) return 'number';

    stream.next();
    return null;
  },
});

export const getLanguageExtensions = (filename: string) => {
  const lowerName = filename.toLowerCase();
  if (lowerName === '.env' || lowerName.startsWith('.env.')) {
    return [envLanguage];
  }

  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'js':
    case 'jsx':
    case 'ts':
    case 'tsx':
      return [javascript({ jsx: true, typescript: ext.includes('ts') })];
    case 'py':
      return [python()];
    case 'html':
    case 'htm':
      return [html()];
    case 'css':
    case 'scss':
    case 'less':
      return [css()];
    case 'json':
      return [json()];
    case 'md':
    case 'markdown':
      return [markdown()];
    case 'env':
      return [envLanguage];
    default:
      return [];
  }
};

export const createMinimapExtension = ({
  file,
  showDiff,
  minimapEnabled,
  isDarkMode,
}: {
  file: CodeEditorFile;
  showDiff: boolean;
  minimapEnabled: boolean;
  isDarkMode: boolean;
}) => {
  if (!file.diffInfo || !showDiff || !minimapEnabled) {
    return [];
  }

  const gutters: Record<number, string> = {};

  return [
    showMinimap.compute(['doc'], (state) => {
      const chunksData = getChunks(state);
      const chunks = chunksData?.chunks || [];

      Object.keys(gutters).forEach((key) => {
        delete gutters[Number(key)];
      });

      chunks.forEach((chunk) => {
        const fromLine = state.doc.lineAt(chunk.fromB).number;
        const toLine = state.doc.lineAt(Math.min(chunk.toB, state.doc.length)).number;

        for (let lineNumber = fromLine; lineNumber <= toLine; lineNumber += 1) {
          gutters[lineNumber] = isDarkMode ? 'rgba(34, 197, 94, 0.8)' : 'rgba(34, 197, 94, 1)';
        }
      });

      return {
        create: () => ({ dom: document.createElement('div') }),
        displayText: 'blocks',
        showOverlay: 'always',
        gutters: [gutters],
      };
    }),
  ];
};

export const createScrollToFirstChunkExtension = ({
  file,
  showDiff,
}: {
  file: CodeEditorFile;
  showDiff: boolean;
}) => {
  if (!file.diffInfo || !showDiff) {
    return [];
  }

  return [
    ViewPlugin.fromClass(class {
      private disposed = false;

      private didFocus = false;

      constructor(view: EditorView) {
        this.focusFirstDiff(view);
      }

      /**
       * Focus the first changed region once CodeMirror has mounted and drawn.
       */
      private focusFirstDiff(view: EditorView) {
        window.setTimeout(() => {
          if (this.disposed || this.didFocus) {
            return;
          }

          const position = getDiffPosition(view, file);

          if (position === null) {
            return;
          }

          this.didFocus = true;
          focusDiffPosition(view, position);
        }, 100);
      }

      update() {}

      destroy() {
        this.disposed = true;
      }
    }),
  ];
};
