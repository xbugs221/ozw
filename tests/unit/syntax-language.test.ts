/**
 * PURPOSE: Preserve common Markdown fence aliases when Prism languages load
 * asynchronously by canonical package name.
 */
import { describe, expect, it } from 'vitest';
import {
  getSyntaxLanguageFromClassName,
  normalizeSyntaxLanguage,
} from '../../frontend/utils/syntaxLanguage';

describe('syntax language normalization', () => {
  it.each([
    ['js', 'javascript'],
    ['ts', 'typescript'],
    ['py', 'python'],
    ['sh', 'bash'],
    ['html', 'markup'],
    ['yml', 'yaml'],
    ['c++', 'cpp'],
  ])('maps %s to the asynchronously loadable %s language', (input, expected) => {
    /** Common Markdown aliases must select a real Prism language chunk. */
    expect(normalizeSyntaxLanguage(input)).toBe(expected);
  });

  it('preserves canonical and unknown language ids', () => {
    /** Supported canonical ids and graceful unknown fallbacks stay stable. */
    expect(normalizeSyntaxLanguage(' Rust ')).toBe('rust');
    expect(normalizeSyntaxLanguage('custom-dsl')).toBe('custom-dsl');
    expect(normalizeSyntaxLanguage('')).toBe('text');
  });

  it('extracts complete punctuation-bearing language ids from Markdown classes', () => {
    /** The rendering entry must not truncate C++ or custom language ids. */
    expect(getSyntaxLanguageFromClassName('language-c++ extra-class')).toBe('cpp');
    expect(getSyntaxLanguageFromClassName('prefix language-custom-dsl')).toBe('custom-dsl');
    expect(getSyntaxLanguageFromClassName(undefined)).toBe('text');
  });
});
