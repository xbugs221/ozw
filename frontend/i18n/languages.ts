/**
 * Supported Languages Configuration
 *
 * This file contains the list of supported languages for the application.
 * Each language includes:
 * - value: Language code (e.g., 'en', 'zh-CN')
 * - label: Display name in English
 * - nativeName: Native language name for display
 */

export interface Language {
  value: string;
  label: string;
  nativeName: string;
}

export const languages: Language[] = [
  {
    value: 'en',
    label: 'English',
    nativeName: 'English',
  },
  {
    value: 'zh-CN',
    label: 'Simplified Chinese',
    nativeName: '简体中文',
  },
];

/**
 * Get language object by value
 */
export const getLanguage = (value: string): Language | undefined => {
  return languages.find(lang => lang.value === value);
};

/**
 * Get all language values
 */
export const getLanguageValues = (): string[] => {
  return languages.map(lang => lang.value);
};

/**
 * Check if a language is supported
 */
export const isLanguageSupported = (value: string): boolean => {
  return languages.some(lang => lang.value === value);
};
