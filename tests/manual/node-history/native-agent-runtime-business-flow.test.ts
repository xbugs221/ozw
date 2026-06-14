/**
 * PURPOSE: Verify the native agent runtime preserves real Codex/Pi interaction
 * semantics for consecutive messages, steering, follow-up, abort, and refresh.
 */

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

type Provider = 'codex' | 'pi';

type RuntimeHarness = {
  sendMessage(input: {
    provider: Provider;
    sessionId: string;
    projectPath: string;
    text: string;
    runningBehavior?: 'abort-and-send' | 'steer' | 'followUp';
  }): Promise<{ accepted: boolean; providerSessionId?: string }>;
  abortSession(input: { provider: Provider; sessionId: string }): Promise<{ aborted: boolean }>;
  releaseProvider(provider: Provider, label?: string): Promise<void>;
  readMessages(input: { provider: Provider; sessionId: string }): Promise<Array<{ role: string; content: string }>>;
  getAdapterEvents(provider: Provider): Array<{ type: string; text?: string; behavior?: string }>;
};

/**
 * Load the planned native runtime test harness.
 * @returns Runtime harness factory exported by backend/native-agent-runtime.ts.
 */
async function loadRuntimeHarnessFactory(): Promise<() => RuntimeHarness> {
  const modulePath = path.join(process.cwd(), 'backend/native-agent-runtime.ts');
  assert.ok(
    existsSync(modulePath),
    'backend/native-agent-runtime.ts must exist and expose createNativeAgentRuntimeForTest',
  );

  const mod = await import(pathToFileURL(modulePath).href) as {
    createNativeAgentRuntimeForTest?: () => RuntimeHarness;
  };
  const createNativeAgentRuntimeForTest = mod.createNativeAgentRuntimeForTest;
  if (typeof createNativeAgentRuntimeForTest !== 'function') {
    assert.fail('native runtime must export createNativeAgentRuntimeForTest() for business-flow acceptance tests');
  }
  return createNativeAgentRuntimeForTest;
}

test('Codex running follow-up uses steer instead of queue', async () => {
  const createHarness = await loadRuntimeHarnessFactory();
  const runtime = createHarness();
  const projectPath = process.cwd();

  const first = await runtime.sendMessage({
    provider: 'codex',
    sessionId: 'c-native-codex',
    projectPath,
    text: 'first codex message',
  });
  assert.equal(first.accepted, true);

  const second = await runtime.sendMessage({
    provider: 'codex',
    sessionId: 'c-native-codex',
    projectPath,
    text: 'second codex message while running',
    runningBehavior: 'steer',
  });
  assert.equal(second.accepted, true);

  const eventsBeforeRelease = runtime.getAdapterEvents('codex');
  assert.ok(
    eventsBeforeRelease.some((event) => event.behavior === 'steer'),
    'Codex adapter must receive steer behavior for running input',
  );

  await runtime.releaseProvider('codex', 'finish first');

  const messages = await runtime.readMessages({ provider: 'codex', sessionId: 'c-native-codex' });
  assert.deepEqual(
    messages.map((message) => `${message.role}:${message.content}`),
    [
      'user:first codex message',
      'assistant:finish first',
      'user:second codex message while running',
    ],
  );
});

test('same cN route in different projects keeps independent running turns', async () => {
  const createHarness = await loadRuntimeHarnessFactory();
  const runtime = createHarness();
  const ozwProjectPath = path.join(process.cwd(), 'ozw');
  const matxProjectPath = path.join(process.cwd(), 'matx');

  const ozwFirst = await runtime.sendMessage({
    provider: 'codex',
    sessionId: 'c2',
    projectPath: ozwProjectPath,
    text: 'ozw project request',
  });
  assert.equal(ozwFirst.accepted, true);

  const matxFirst = await runtime.sendMessage({
    provider: 'codex',
    sessionId: 'c2',
    projectPath: matxProjectPath,
    text: 'matx project request',
  });
  assert.equal(matxFirst.accepted, true);

  const sendEvents = runtime.getAdapterEvents('codex').filter((event) => event.type === 'send');
  assert.deepEqual(
    sendEvents.map((event) => event.text),
    ['ozw project request', 'matx project request'],
    'both projects must start their own visible c2 turn instead of sharing one runtime slot',
  );

  await runtime.releaseProvider('codex', 'ozw done');
  await runtime.releaseProvider('codex', 'matx done');
});

test('Codex abort clears active run before a replacement message is sent', async () => {
  const createHarness = await loadRuntimeHarnessFactory();
  const runtime = createHarness();
  const projectPath = process.cwd();

  await runtime.sendMessage({
    provider: 'codex',
    sessionId: 'c-native-codex-abort',
    projectPath,
    text: 'obsolete codex message',
  });

  const abort = await runtime.abortSession({ provider: 'codex', sessionId: 'c-native-codex-abort' });
  assert.equal(abort.aborted, true);

  await runtime.sendMessage({
    provider: 'codex',
    sessionId: 'c-native-codex-abort',
    projectPath,
    text: 'replacement codex message',
  });
  await runtime.releaseProvider('codex', 'replacement done');

  const events = runtime.getAdapterEvents('codex');
  assert.ok(
    events.some((event) => event.type === 'abort'),
    'Codex adapter must receive abort for the obsolete run',
  );
  assert.deepEqual(
    (await runtime.readMessages({ provider: 'codex', sessionId: 'c-native-codex-abort' }))
      .map((message) => `${message.role}:${message.content}`),
    [
      'user:replacement codex message',
      'assistant:replacement done',
    ],
  );
});

test('Pi steer and followUp use AgentSession queue semantics', async () => {
  const createHarness = await loadRuntimeHarnessFactory();
  const runtime = createHarness();
  const projectPath = process.cwd();

  await runtime.sendMessage({
    provider: 'pi',
    sessionId: 'c-native-pi',
    projectPath,
    text: 'first pi message',
  });
  await runtime.sendMessage({
    provider: 'pi',
    sessionId: 'c-native-pi',
    projectPath,
    text: 'pi steering correction',
    runningBehavior: 'steer',
  });
  await runtime.sendMessage({
    provider: 'pi',
    sessionId: 'c-native-pi',
    projectPath,
    text: 'pi follow-up task',
    runningBehavior: 'followUp',
  });

  const piEvents = runtime.getAdapterEvents('pi');
  assert.ok(
    piEvents.some((event) => event.type === 'queue' && event.behavior === 'steer' && event.text === 'pi steering correction'),
    'Pi runtime must queue steering messages through AgentSession steer',
  );
  assert.ok(
    piEvents.some((event) => event.type === 'queue' && event.behavior === 'followUp' && event.text === 'pi follow-up task'),
    'Pi runtime must queue follow-up messages through AgentSession followUp',
  );

  await runtime.releaseProvider('pi', 'first pi assistant response');
  await runtime.releaseProvider('pi', 'steer applied response');
  await runtime.releaseProvider('pi', 'follow-up response');

  assert.deepEqual(
    (await runtime.readMessages({ provider: 'pi', sessionId: 'c-native-pi' }))
      .map((message) => `${message.role}:${message.content}`),
    [
      'user:first pi message',
      'assistant:first pi assistant response',
      'user:pi steering correction',
      'assistant:steer applied response',
      'user:pi follow-up task',
      'assistant:follow-up response',
    ],
  );
});
