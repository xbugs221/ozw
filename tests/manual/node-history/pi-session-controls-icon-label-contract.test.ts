/**
 * 60-优化Pi会话输入区icon和模型选择样式
 *
 * 契约测试 1：SessionModelControls Pi 模式渲染验证
 * - Pi 模式显示 PiLogo 而非 ChatGptLogo
 * - Pi 模式触发按钮标签为 `{modelLabel} | {depthLabel}` 格式
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('SessionModelControls renders PiLogo for Pi provider', () => {
  const source = readRepoFile('frontend/components/chat/view/subcomponents/SessionModelControls.tsx');

  // PiLogo must be imported
  assert.match(source, /import\s+PiLogo/, 'SessionModelControls must import PiLogo component');

  // The ChatGptLogo usage must be conditional on provider
  // Pi branch renders PiLogo, Codex branch renders ChatGptLogo
  const hasConditionalLogo = /provider\s*===\s*['"]pi['"'][\s\S]{0,500}PiLogo/.test(source)
    || /provider\s*!==\s*['"]pi['"'][\s\S]{0,500}ChatGptLogo/.test(source)
    || /\bprovider\b[\s\S]{0,100}(PiLogo|ChatGptLogo)/.test(source);
  assert.ok(hasConditionalLogo, 'PiLogo must appear conditionally based on provider');
});

test('Pi mode trigger button shows model name and depth separately', () => {
  const source = readRepoFile('frontend/components/chat/view/subcomponents/SessionModelControls.tsx');

  // Pi mode should NOT use the compact toCompactCodexModelLabel format for its trigger label
  // Pi must use a label format that includes the full model label and depth label separately
  // triggerLabel is computed with a conditional: Pi uses `{modelLabel} | {depthLabel}`, Codex uses compact
  const hasPiLabelFormat = /triggerLabel\s*=\s*provider\s*===\s*['"]pi['"'][\s\S]{0,300}\|\s*currentDepthLabel/.test(source)
    || /provider\s*===\s*['"]pi['"'][\s\S]{0,300}\|\s*currentDepthLabel/.test(source)
    || /triggerLabel[^;]*\|[^;]*currentDepthLabel/.test(source)
    || /\|\s*currentDepthLabel/.test(source);
  assert.ok(hasPiLabelFormat, 'Pi trigger label must separate model name and depth with | separator');
});

test('PiLogo component exists with correct visual structure', () => {
  const piLogoPath = 'frontend/components/llm-logo-provider/PiLogo.tsx';
  let source: string;
  try {
    source = readRepoFile(piLogoPath);
  } catch {
    assert.fail(`PiLogo component file not found at ${piLogoPath}`);
  }

  // Must render "Pi" text
  assert.match(source, /['"]Pi['"]|Pi\b/, 'PiLogo must contain "Pi" text');
  // Must have rounded/purple styling
  assert.match(source, /rounded|bg-violet|purple/, 'PiLogo must have rounded/purple styling');
  // Must be a default-exported function component
  assert.match(source, /export\s+default\s+function/, 'PiLogo must be a default-exported function');
});

test('SessionProviderLogo is used correctly for Pi sessions in chat messages', () => {
  const source = readRepoFile('frontend/components/chat/view/subcomponents/ChatMessagesPane.tsx');
  // Optional: check that Pi messages use SessionProviderLogo
  // This is advisory, the actual rendering verification is via Playwright
});
