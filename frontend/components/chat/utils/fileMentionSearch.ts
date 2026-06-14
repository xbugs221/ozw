/**
 * PURPOSE: Rank project files for chat composer mention search without depending on React or browser APIs.
 */
import Fuse from 'fuse.js';

export interface MentionableFile {
  name: string;
  path: string;
  relativePath?: string;
}

const MAX_FILE_MENTION_RESULTS = 80;

/**
 * Normalize text for case-insensitive path and filename matching.
 */
function normalizeSearchText(value: string): string {
  return value.toLowerCase();
}

/**
 * Split a user query into meaningful tokens so searches like "set pol" can match SettlementPolicy.
 */
function getSearchTokens(query: string): string[] {
  return normalizeSearchText(query)
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter(Boolean);
}

/**
 * Check fuzzy abbreviation matches while preserving the user's character order.
 */
function isSubsequence(needle: string, haystack: string): boolean {
  if (!needle) {
    return true;
  }

  let needleIndex = 0;
  for (const character of haystack) {
    if (character === needle[needleIndex]) {
      needleIndex += 1;
      if (needleIndex === needle.length) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Score direct business-style matches before asking Fuse for broader fuzzy fallback candidates.
 */
function scoreMentionableFile(file: MentionableFile, query: string, tokens: string[]): number | null {
  const fileName = normalizeSearchText(file.name);
  const filePath = normalizeSearchText(file.path);
  const relativePath = normalizeSearchText(file.relativePath || '');
  const searchableText = [fileName, filePath, relativePath].join(' ');
  const compactSearchableText = searchableText.replace(/[^a-z0-9]/g, '');
  const compactQuery = normalizeSearchText(query).replace(/[^a-z0-9]/g, '');
  let score = 0;

  if (searchableText.includes(query)) {
    score += 100;
  }
  if (fileName.includes(query)) {
    score += 50;
  }
  if (filePath.includes(query)) {
    score += 25;
  }

  for (const token of tokens) {
    if (searchableText.includes(token)) {
      score += 20;
      continue;
    }
    if (isSubsequence(token, compactSearchableText)) {
      score += 6;
      continue;
    }
    return null;
  }

  if (compactQuery && isSubsequence(compactQuery, compactSearchableText)) {
    score += 10;
  }

  return score - file.path.length * 0.001;
}

/**
 * Rank project files using exact substring matches first, then fuzzy path/name matches.
 */
export function filterMentionableFiles(
  files: MentionableFile[],
  query: string,
  limit = MAX_FILE_MENTION_RESULTS,
): MentionableFile[] {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return files.slice(0, limit);
  }

  const normalizedQuery = trimmedQuery.toLowerCase();
  const rankedFiles: MentionableFile[] = [];
  const seenPaths = new Set<string>();
  const addFile = (file: MentionableFile) => {
    if (seenPaths.has(file.path)) {
      return;
    }
    seenPaths.add(file.path);
    rankedFiles.push(file);
  };
  const queryTokens = getSearchTokens(trimmedQuery);

  files
    .map((file) => ({
      file,
      score: scoreMentionableFile(file, normalizedQuery, queryTokens),
    }))
    .filter((result): result is { file: MentionableFile; score: number } => result.score !== null)
    .sort((left, right) => right.score - left.score)
    .forEach((result) => addFile(result.file));

  const fuse = new Fuse(files, {
    keys: [
      { name: 'name', weight: 2 },
      { name: 'path', weight: 1.5 },
      { name: 'relativePath', weight: 1 },
    ],
    threshold: 0.42,
    ignoreLocation: true,
    includeScore: true,
    minMatchCharLength: 1,
  });

  fuse.search(trimmedQuery).forEach((result) => addFile(result.item));
  return rankedFiles.slice(0, limit);
}
