/**
 * PURPOSE: Verify ozw manual Codex/Pi chat is wired to Codex app-server and
 * the Pi native SDK instead of the co file protocol.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = process.cwd();

/**
 * Read a repository file as UTF-8 text.
 * @param relativePath Repository-relative file path.
 * @returns File contents.
 */
async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(path.join(REPO_ROOT, relativePath), 'utf8');
}

/**
 * Parse a semver-like dependency range into numeric major/minor/patch values.
 * @param range Dependency range such as "^0.134.0" or "0.134.0".
 * @returns Parsed version tuple.
 */
function parseVersionRange(range: string): [number, number, number] {
  const match = range.match(/(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, `Expected semver range, got: ${range}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Compare two semver tuples.
 * @param actual Actual version tuple.
 * @param minimum Required minimum version tuple.
 * @returns True when actual is greater than or equal to minimum.
 */
function isAtLeast(actual: [number, number, number], minimum: [number, number, number]): boolean {
  for (let index = 0; index < minimum.length; index += 1) {
    if (actual[index] > minimum[index]) return true;
    if (actual[index] < minimum[index]) return false;
  }
  return true;
}

/**
 * Assert source text does not match a pattern without dumping the whole file.
 * @param text Source text under test.
 * @param pattern Forbidden pattern.
 * @param message Failure message.
 */
function assertDoesNotContain(text: string, pattern: RegExp, message: string): void {
  assert.equal(pattern.test(text), false, message);
}

/**
 * Assert source text matches a pattern without dumping the whole file.
 * @param text Source text under test.
 * @param pattern Required pattern.
 * @param message Failure message.
 */
function assertContains(text: string, pattern: RegExp, message: string): void {
  assert.equal(pattern.test(text), true, message);
}

test('package dependencies keep only the native SDK still used by manual chat', async () => {
  const packageJson = JSON.parse(await readRepoFile('package.json')) as {
    dependencies?: Record<string, string>;
  };
  const dependencies = packageJson.dependencies ?? {};

  assert.equal(
    dependencies['@openai/codex-sdk'],
    undefined,
    'Codex manual chat must not keep the unused SDK dependency after app-server migration',
  );

  assert.ok(
    dependencies['@earendil-works/pi-coding-agent'],
    'Pi manual chat must depend on @earendil-works/pi-coding-agent',
  );
  assert.ok(
    isAtLeast(parseVersionRange(dependencies['@earendil-works/pi-coding-agent']), [0, 75, 5]),
    `@earendil-works/pi-coding-agent must be at least 0.75.5, got ${dependencies['@earendil-works/pi-coding-agent']}`,
  );
});

test('server manual chat path does not route Codex/Pi through co', async () => {
  const serverIndex = await readRepoFile('backend/index.ts');

  assertDoesNotContain(
    serverIndex,
    /from ['"]\.\/co-client\.js['"]/,
    'backend/index.ts must not import co-client for manual Codex/Pi chat',
  );
  assertDoesNotContain(
    serverIndex,
    /from ['"]\.\/co-read-model\.js['"]/,
    'backend/index.ts must not import co-read-model for manual Codex/Pi chat',
  );
  assertDoesNotContain(
    serverIndex,
    /ensureCoAvailable\(['"](codex|pi)['"]\)/,
    'codex-command/pi-command must not require co availability',
  );
  assertDoesNotContain(
    serverIndex,
    /\bbuildCoRequest\b|\bwriteCoRequest\b|\bobserveCoConversationTurns\b/,
    'manual provider messages must not build/write/observe co requests',
  );

  const nativeRuntime = await readRepoFile('backend/native-agent-runtime.ts');
  assertDoesNotContain(
    nativeRuntime,
    /@openai\/codex-sdk/,
    'native runtime must not import the unused Codex SDK',
  );
  assertContains(
    nativeRuntime,
    /sendCodexAppServerMessage/,
    'native runtime must route Codex manual chat through Codex app-server',
  );
  assertContains(
    nativeRuntime,
    /@earendil-works\/pi-coding-agent/,
    'native runtime must import the Pi coding agent SDK',
  );
});

test('frontend does not send a universal co activePolicy steer for running messages', async () => {
  const composer = await readRepoFile('frontend/components/chat/hooks/useChatComposerState.ts');

  assertDoesNotContain(
    composer,
    /const\s+activePolicy\s*=\s*shouldSendAsSteer\s*\?\s*['"]steer['"]\s*:\s*['"]queue['"]/,
    'running input policy must be provider-capability based, not universal co steer',
  );
  assertDoesNotContain(
    composer,
    /targetTurnId/,
    'frontend must not depend on co targetTurnId for native provider chat',
  );
  assertContains(
    composer,
    /providerCapabilities|nativeCapabilities|runningInput/,
    'frontend should select running-input behavior from provider native capabilities',
  );
});

test('settings copy no longer describes Pi or Codex as co file protocol clients', async () => {
  const englishSettings = await readRepoFile('frontend/i18n/locales/en/settings.json');
  const chineseSettings = await readRepoFile('frontend/i18n/locales/zh-CN/settings.json');

  assertDoesNotContain(
    `${englishSettings}\n${chineseSettings}`,
    /co file protocol|co 文件协议/,
    'settings text must not tell users that manual chat is sent through co',
  );
});
