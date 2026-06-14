/**
 * PURPOSE: Provide chat-only text formatting helpers used before Markdown
 * rendering, without changing stored transcript content.
 */
export function decodeHtmlEntities(text: string) {
  if (!text) return text;
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

export function normalizeInlineCodeFences(text: string) {
  if (!text || typeof text !== 'string') return text;
  try {
    return text.replace(/```[ \t]*([^\n\r]+?)[ \t]*```/g, '`$1`');
  } catch {
    return text;
  }
}

export function normalizeAdjacentCodeBlockFences(text: string) {
  /**
   * docstring: Insert missing line boundaries around complete chat Markdown code
   * fences so Chinese prose adjacent to ``` renders as prose plus a code block.
   * This is a display-only repair for assistant/tool text and never mutates the
   * original session transcript.
   */
  if (!text || typeof text !== 'string') return text;

  try {
    const withOpeningBoundaries = text.replace(
      /([^\n\r])```([A-Za-z0-9_+.-]*)[ \t]*(\r?\n)/g,
      (_match, prefix: string, language: string, newline: string) => `${prefix}${newline}\`\`\`${language}${newline}`,
    );
    const lines = withOpeningBoundaries.split('\n');
    const normalizedLines: string[] = [];
    let insideFence = false;

    for (const rawLine of lines) {
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
      const carriageReturn = rawLine.endsWith('\r') ? '\r' : '';

      if (insideFence && isClosingFenceWithAdjacentProse(line)) {
        normalizedLines.push(`\`\`\`${carriageReturn}`);
        normalizedLines.push(`${line.slice(3)}${carriageReturn}`);
        insideFence = false;
        continue;
      }

      normalizedLines.push(rawLine);

      if (/^```[A-Za-z0-9_+.-]*[ \t]*$/.test(line)) {
        insideFence = !insideFence;
      }
    }

    return normalizedLines.join('\n');
  } catch {
    return text;
  }
}

export function normalizeSingleBacktickCodeBlockFences(text: string) {
  /**
   * docstring: Repair persisted chat replies where a model used a single
   * backtick as a multiline code fence, commonly as `bash ... `prose. Standard
   * Markdown treats that as inline code, but users expect a visible code block.
   */
  if (!text || typeof text !== 'string') return text;

  try {
    const lines = text.split('\n');
    const normalizedLines: string[] = [];
    let insideFence: string | null = null;

    const pushOutsideLine = (line: string, carriageReturn: string, lineIndex: number) => {
      const opening = getSingleBacktickCodeBlockOpening(line);
      if (!opening || !hasSingleBacktickCodeBlockClosing(lines, lineIndex + 1)) {
        normalizedLines.push(`${line}${carriageReturn}`);
        return;
      }

      if (opening.prefix) {
        normalizedLines.push(`${opening.prefix}${carriageReturn}`);
      }
      normalizedLines.push(`\`\`\`${opening.language}${carriageReturn}`);
      insideFence = 'single';
    };

    for (let index = 0; index < lines.length; index += 1) {
      const rawLine = lines[index];
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
      const carriageReturn = rawLine.endsWith('\r') ? '\r' : '';

      if (insideFence === 'single') {
        const closing = getSingleBacktickCodeBlockClosing(line);
        if (closing) {
          normalizedLines.push(`\`\`\`${carriageReturn}`);
          insideFence = null;
          if (closing.suffix) {
            pushOutsideLine(closing.suffix, carriageReturn, index);
          }
          continue;
        }

        normalizedLines.push(rawLine);
        continue;
      }

      if (insideFence === 'triple') {
        const singleClosing = getSingleBacktickCodeBlockClosing(line);
        if (singleClosing) {
          normalizedLines.push(`\`\`\`${carriageReturn}`);
          insideFence = null;
          if (singleClosing.suffix) {
            pushOutsideLine(singleClosing.suffix, carriageReturn, index);
          }
          continue;
        }

        normalizedLines.push(rawLine);
        if (/^```[A-Za-z0-9_+.-]*[ \t]*$/.test(line)) {
          insideFence = null;
        }
        continue;
      }

      if (/^```[A-Za-z0-9_+.-]*[ \t]*$/.test(line)) {
        normalizedLines.push(rawLine);
        insideFence = 'triple';
        continue;
      }

      pushOutsideLine(line, carriageReturn, index);
    }

    return normalizedLines.join('\n');
  } catch {
    return text;
  }
}

function getSingleBacktickCodeBlockOpening(line: string): { prefix: string; language: string } | null {
  /**
   * docstring: Detect an end-of-line `language marker without treating normal
   * same-line inline code as a block fence candidate.
   */
  const match = line.match(/^(.*)`([A-Za-z][A-Za-z0-9_+.-]*)[ \t]*$/);
  if (!match) return null;

  const prefix = match[1] || '';
  const language = match[2] || '';
  if (prefix.endsWith('`') || !language) return null;

  return { prefix, language };
}

function getSingleBacktickCodeBlockClosing(line: string): { suffix: string } | null {
  /**
   * docstring: Detect a line-leading single backtick that closes malformed
   * multiline code, optionally followed by prose that should return outside.
   */
  if (!line.startsWith('`') || line.startsWith('``')) return null;

  return { suffix: line.slice(1) };
}

function hasSingleBacktickCodeBlockClosing(lines: string[], startIndex: number): boolean {
  /**
   * docstring: Require a later line-leading single backtick before rewriting an
   * opening marker, which keeps ordinary inline code and unfinished text intact.
   */
  for (let index = startIndex; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (getSingleBacktickCodeBlockClosing(line)) {
      return true;
    }
  }

  return false;
}

function isClosingFenceWithAdjacentProse(line: string): boolean {
  /**
   * docstring: Detect malformed closing fences where prose is glued after ``` while
   * preserving legal code content such as a literal ```md line inside a code block.
   */
  if (!line.startsWith('```') || line.length <= 3) return false;

  const suffix = line.slice(3);
  if (!suffix.trim()) return false;

  return !/^[A-Za-z0-9_+.-]+[ \t]*$/.test(suffix);
}

export function normalizeChatMarkdownFences(text: string) {
  /**
   * docstring: Apply chat Markdown fence repairs in parser-safe order: block
   * fences first, then legacy single-line inline fence normalization.
   */
  return normalizeInlineCodeFences(normalizeSingleBacktickCodeBlockFences(normalizeAdjacentCodeBlockFences(text)));
}

export function unescapeWithMathProtection(text: string) {
  if (!text || typeof text !== 'string') return text;

  const mathBlocks: string[] = [];
  const placeholderPrefix = '__MATH_BLOCK_';
  const placeholderSuffix = '__';

  let processedText = text.replace(/\$\$([\s\S]*?)\$\$|\$([^\$\n]+?)\$/g, (match) => {
    const index = mathBlocks.length;
    mathBlocks.push(match);
    return `${placeholderPrefix}${index}${placeholderSuffix}`;
  });

  processedText = processedText.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r');

  processedText = processedText.replace(
    new RegExp(`${placeholderPrefix}(\\d+)${placeholderSuffix}`, 'g'),
    (match, index) => {
      return mathBlocks[parseInt(index, 10)];
    },
  );

  return processedText;
}

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function formatUsageLimitText(text: string) {
  try {
    if (typeof text !== 'string') return text;
    return text.replace(/Claude AI usage limit reached\|(\d{10,13})/g, (match, ts) => {
      let timestampMs = parseInt(ts, 10);
      if (!Number.isFinite(timestampMs)) return match;
      if (timestampMs < 1e12) timestampMs *= 1000;
      const reset = new Date(timestampMs);

      const timeStr = new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(reset);

      const offsetMinutesLocal = -reset.getTimezoneOffset();
      const sign = offsetMinutesLocal >= 0 ? '+' : '-';
      const abs = Math.abs(offsetMinutesLocal);
      const offH = Math.floor(abs / 60);
      const offM = abs % 60;
      const gmt = `GMT${sign}${offH}${offM ? ':' + String(offM).padStart(2, '0') : ''}`;
      const tzId = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      const cityRaw = tzId.split('/').pop() || '';
      const city = cityRaw
        .replace(/_/g, ' ')
        .toLowerCase()
        .replace(/\b\w/g, (char) => char.toUpperCase());
      const tzHuman = city ? `${gmt} (${city})` : gmt;

      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const dateReadable = `${reset.getDate()} ${months[reset.getMonth()]} ${reset.getFullYear()}`;

      return `Claude usage limit reached. Your limit will reset at **${timeStr} ${tzHuman}** - ${dateReadable}`;
    });
  } catch {
    return text;
  }
}
