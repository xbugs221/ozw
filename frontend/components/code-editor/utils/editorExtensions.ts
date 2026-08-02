/**
 * PURPOSE: Build CodeMirror language, minimap, and diff positioning extensions
 * used by the workspace text editor.
 */
import { StreamLanguage } from '@codemirror/language';
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

type LanguageKey = 'css' | 'html' | 'javascript' | 'json' | 'markdown' | 'python' | 'typescript';

const languageExtensionCache = new Map<LanguageKey, Promise<CodeEditorExtension[]>>();

/**
 * PURPOSE: Keep extension typing local to avoid a direct dependency on
 * CodeMirror state internals.
 */
type CodeEditorExtension = any;

/**
 * Resolve a filename to the smallest syntax package needed by that file.
 */
export function getLanguageKey(filename: string): LanguageKey | 'env' | null {
  const lowerName = filename.toLowerCase();
  if (lowerName === '.env' || lowerName.startsWith('.env.')) {
    return 'env';
  }

  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'js':
    case 'jsx':
      return 'javascript';
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'py':
      return 'python';
    case 'html':
    case 'htm':
      return 'html';
    case 'css':
    case 'scss':
    case 'less':
      return 'css';
    case 'json':
      return 'json';
    case 'md':
    case 'markdown':
      return 'markdown';
    case 'env':
      return 'env';
    default:
      return null;
  }
}

/**
 * Load one syntax package on demand and share concurrent requests for it.
 */
function loadLanguageKey(languageKey: LanguageKey): Promise<CodeEditorExtension[]> {
  const cached = languageExtensionCache.get(languageKey);
  if (cached) return cached;

  let loading: Promise<CodeEditorExtension[]>;
  switch (languageKey) {
    case 'javascript':
    case 'typescript':
      loading = import('@codemirror/lang-javascript').then(({ javascript }) => [
        javascript({ jsx: true, typescript: languageKey === 'typescript' }),
      ]);
      break;
    case 'python':
      loading = import('@codemirror/lang-python').then(({ python }) => [python()]);
      break;
    case 'html':
      loading = import('@codemirror/lang-html').then(({ html }) => [html()]);
      break;
    case 'css':
      loading = import('@codemirror/lang-css').then(({ css }) => [css()]);
      break;
    case 'json':
      loading = import('@codemirror/lang-json').then(({ json }) => [json()]);
      break;
    case 'markdown':
      loading = import('@codemirror/lang-markdown').then(({ markdown }) => [markdown()]);
      break;
  }

  languageExtensionCache.set(languageKey, loading);
  loading.catch(() => languageExtensionCache.delete(languageKey));
  return loading;
}

/**
 * Load only the syntax extension selected by the current filename.
 */
export async function loadLanguageExtensions(filename: string): Promise<CodeEditorExtension[]> {
  const languageKey = getLanguageKey(filename);
  if (languageKey === null) return [];
  if (languageKey === 'env') return [envLanguage];
  return loadLanguageKey(languageKey);
}

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
