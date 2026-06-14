import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = process.cwd();

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('Pi provider state loads Pi model catalog and exposes model/thinking controls', () => {
  const source = readRepoFile('frontend/components/chat/hooks/useChatProviderState.ts');

  assert.match(source, /\/api\/pi\/models/, 'useChatProviderState must load Pi model catalog from /api/pi/models');
  assert.match(source, /\bpiModel\b/, 'provider state must expose the selected Pi model');
  assert.match(source, /\bsetPiModel\b/, 'provider state must expose a Pi model setter');
  assert.match(source, /\bpiModelOptions\b/, 'provider state must expose Pi model options');
  assert.match(source, /\bpiThinkingLevel\b/, 'provider state must expose the selected Pi thinking level');
  assert.match(source, /\bsetPiThinkingLevel\b/, 'provider state must expose a Pi thinking level setter');
  assert.match(source, /\bpiThinkingOptions\b/, 'provider state must expose Pi thinking options for the active model');
  assert.match(source, /pi-thinking-level/, 'Pi thinking level must be persisted in localStorage');
  assert.match(source, /pi-model/, 'Pi model must be persisted in localStorage');
});

test('Chat composer renders provider-aware model controls for Pi sessions', () => {
  const source = readRepoFile('frontend/components/chat/view/subcomponents/ChatComposer.tsx');

  assert.match(
    source,
    /provider === 'pi'[\s\S]{0,1200}<(SessionModelControls|ProviderModelControls)/,
    'composer must render model/thinking controls when active provider is Pi',
  );
  assert.match(source, /piModel/, 'composer props must include Pi model state');
  assert.match(source, /piThinkingLevel/, 'composer props must include Pi thinking level state');
});

test('Pi command sends model and thinkingLevel but not Codex reasoningEffort', () => {
  const source = readRepoFile('frontend/components/chat/hooks/useChatComposerState.ts');
  const piCommandIndex = source.indexOf("type: 'pi-command'");
  assert.notEqual(piCommandIndex, -1, 'useChatComposerState must have a pi-command send branch');

  const piBranch = source.slice(piCommandIndex, piCommandIndex + 2200);
  assert.match(piBranch, /model:\s*piModel\b/, 'pi-command options must include the selected Pi model');
  assert.match(piBranch, /thinkingLevel:\s*piThinkingLevel\b/, 'pi-command options must include the selected Pi thinking level');
  assert.doesNotMatch(
    piBranch,
    /reasoningEffort\s*:/,
    'Pi command must not use Codex-only reasoningEffort for Pi thinking depth',
  );
});
