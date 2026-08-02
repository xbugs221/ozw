/**
 * PURPOSE: Verify that the code editor selects one syntax package per file
 * while leaving ordinary text files free of language downloads.
 */
import { describe, expect, it } from 'vitest';
import {
  getLanguageKey,
  loadLanguageExtensions,
} from '../../frontend/components/code-editor/utils/editorExtensions';

describe('editor language loading', () => {
  it('maps supported filenames to one language family', () => {
    /** Preserve aliases without broadening the set of downloaded packages. */
    expect(getLanguageKey('component.tsx')).toBe('typescript');
    expect(getLanguageKey('component.jsx')).toBe('javascript');
    expect(getLanguageKey('styles.scss')).toBe('css');
    expect(getLanguageKey('README.markdown')).toBe('markdown');
    expect(getLanguageKey('.env.local')).toBe('env');
  });

  it('keeps unsupported text files syntax-free', async () => {
    /** Plain text should render immediately without importing a language. */
    expect(getLanguageKey('notes.txt')).toBeNull();
    await expect(loadLanguageExtensions('notes.txt')).resolves.toEqual([]);
  });

  it('shares repeated loads without mixing JavaScript and TypeScript modes', async () => {
    /** Concurrent opens should reuse immutable extensions for the same mode. */
    const firstJavaScript = loadLanguageExtensions('one.js');
    const secondJavaScript = loadLanguageExtensions('two.jsx');
    const typeScript = loadLanguageExtensions('three.ts');

    await expect(secondJavaScript).resolves.toBe(await firstJavaScript);
    await expect(typeScript).resolves.not.toBe(await firstJavaScript);
  });
});
