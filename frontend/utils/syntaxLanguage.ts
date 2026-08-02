/**
 * PURPOSE: Normalize common Markdown fence aliases to Prism's asynchronously
 * loadable canonical language names.
 */

const SYNTAX_LANGUAGE_ALIASES: Record<string, string> = {
  'c++': 'cpp',
  cs: 'csharp',
  html: 'markup',
  js: 'javascript',
  md: 'markdown',
  plain: 'text',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  sh: 'bash',
  shell: 'bash',
  ts: 'typescript',
  txt: 'text',
  xml: 'markup',
  yml: 'yaml',
  zsh: 'bash',
};

/**
 * Return a canonical Prism id while leaving already canonical ids untouched.
 */
export function normalizeSyntaxLanguage(language: string): string {
  const normalized = language.trim().toLowerCase();
  if (!normalized) return 'text';
  return SYNTAX_LANGUAGE_ALIASES[normalized] || normalized;
}

/**
 * Extract the complete Markdown language class up to whitespace, then return
 * the canonical Prism id used by the asynchronous language loader.
 */
export function getSyntaxLanguageFromClassName(className?: string): string {
  const language = /(?:^|\s)language-([^\s]+)/.exec(className || '')?.[1] || 'text';
  return normalizeSyntaxLanguage(language);
}
