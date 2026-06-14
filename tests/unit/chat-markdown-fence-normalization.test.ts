/**
 * PURPOSE: Lock chat Markdown fence normalization behavior for persisted
 * assistant replies before React rendering turns them into user-visible text.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { normalizeChatMarkdownFences } from '../../frontend/components/chat/utils/chatFormatting';

describe('chat markdown fence normalization', () => {
  it('repairs multiline single-backtick bash blocks glued to Chinese prose', () => {
    /**
     * docstring: Covers the MatX c1 transcript shape where `bash and `prose
     * were produced instead of fenced code block markers.
     */
    const raw = [
      '如果要测试真实 HPC 上的 `mob4dspaw run`，启动时加：`bash',
      'MATX_LIVE_MOB4DSPAW_REAL=1',
      'MATX_GATEWAY_URL=http://127.0.0.1:18789',
      '`2. 在 Kestra 配好 secrets：`.text`',
    ].join('\n');

    const normalized = normalizeChatMarkdownFences(raw);

    assert.equal(
      normalized,
      [
        '如果要测试真实 HPC 上的 `mob4dspaw run`，启动时加：',
        '```bash',
        'MATX_LIVE_MOB4DSPAW_REAL=1',
        'MATX_GATEWAY_URL=http://127.0.0.1:18789',
        '```',
        '2. 在 Kestra 配好 secrets：`.text`',
      ].join('\n'),
    );
  });

  it('closes a triple-backtick block when a malformed single backtick starts the following prose', () => {
    /**
     * docstring: Covers transcripts where an initial ```bash opened correctly
     * but the model used a single backtick before the next Chinese paragraph.
     */
    const raw = [
      '1. 启动 MatX Gateway:',
      '```bash',
      'pnpm matx gateway run \\',
      '  --allow-unconfigured',
      '`如果要测试真实 HPC 上的 `mob4dspaw run`，启动时加：`bash',
      'MATX_LIVE_MOB4DSPAW_REAL=1',
      '`2. 在 Kestra 配好 secrets：`.text`',
    ].join('\n');

    const normalized = normalizeChatMarkdownFences(raw);

    assert.equal(
      normalized,
      [
        '1. 启动 MatX Gateway:',
        '```bash',
        'pnpm matx gateway run \\',
        '  --allow-unconfigured',
        '```',
        '如果要测试真实 HPC 上的 `mob4dspaw run`，启动时加：',
        '```bash',
        'MATX_LIVE_MOB4DSPAW_REAL=1',
        '```',
        '2. 在 Kestra 配好 secrets：`.text`',
      ].join('\n'),
    );
  });

  it('keeps ordinary same-line inline code unchanged', () => {
    /**
     * docstring: Prevents the multiline repair from touching normal inline code.
     */
    const raw = '运行 `pnpm test` 后查看 `test-results`。';

    assert.equal(normalizeChatMarkdownFences(raw), raw);
  });

  it('does not collapse a fenced block just because it contains one code line', () => {
    /**
     * docstring: Protects repaired and valid one-line code blocks from the
     * legacy triple-backtick inline-code cleanup.
     */
    const raw = ['```bash', 'MATX_GATEWAY_URL=http://127.0.0.1:18789', '```'].join('\n');

    assert.equal(normalizeChatMarkdownFences(raw), raw);
  });
});
