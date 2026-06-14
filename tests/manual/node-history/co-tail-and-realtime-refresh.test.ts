// @ts-nocheck -- Proposal acceptance test: executes against current read-model contracts.
/**
 * PURPOSE: Verify co-backed chat sessions open from the latest tail window and
 * refresh from scoped session events without falling back to full page reloads.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { readCoConversationMessages } from '../../../backend/co-read-model.ts';
import { sessionChangedMatchesSelectedSession } from '../../shared/socket-message-utils.ts';

/**
 * Write JSON with parent directories created, matching ozw's durable state files.
 */
async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/**
 * Build one Pi assistant response event with cumulative visible text.
 */
function buildPiTextEvent({ conversationId, turnId, sequence, text, createdAt }) {
  return {
    seq: sequence,
    type: 'pi-response',
    provider: 'pi',
    conversation_id: conversationId,
    turn_id: turnId,
    created_at: createdAt,
    data: {
      type: 'item',
      itemType: 'agent_message',
      message: { content: text },
      raw: {
        assistantMessageEvent: {
          type: 'text_delta',
          delta: text,
          partial: {
            responseId: `response-${turnId}`,
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: `thinking ${turnId}` },
              { type: 'text', text },
            ],
          },
        },
        message: {
          responseId: `response-${turnId}`,
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: `thinking ${turnId}` },
            { type: 'text', text },
          ],
        },
      },
    },
  };
}

/**
 * Return a strictly increasing ISO timestamp for ordered co request fixtures.
 */
function timestampFor(index, extraMs = 0) {
  return new Date(Date.UTC(2026, 4, 24, 0, 0, index, extraMs)).toISOString();
}

/**
 * Write the event stream for one co turn.
 */
async function writeTurnEvents(coHome, turnId, events) {
  const turnDir = path.join(coHome, 'turns', turnId);
  await fs.mkdir(turnDir, { recursive: true });
  await fs.writeFile(
    path.join(turnDir, 'events.jsonl'),
    `${events.map((event) => JSON.stringify(event)).join('\n')}\n`,
    'utf8',
  );
}

/**
 * Create a realistic co conversation with ordered requests and turn event files.
 */
async function writeCoConversation(coHome, { conversationId, providerSessionId, turnCount }) {
  const turns = [];
  for (let index = 1; index <= turnCount; index += 1) {
    const padded = String(index).padStart(3, '0');
    const requestId = `req-${padded}`;
    const turnId = `turn_${requestId}`;
    const createdAt = timestampFor(index, 0);
    turns.push(turnId);

    await writeJson(path.join(coHome, 'requests', 'done', `${requestId}.json`), {
      request_id: requestId,
      conversation_id: conversationId,
      provider: 'pi',
      text: `user ${index}`,
      created_at: createdAt,
    });
    await writeJson(path.join(coHome, 'turns', turnId, 'request.json'), {
      request_id: requestId,
      conversation_id: conversationId,
    });
    await writeTurnEvents(coHome, turnId, [
      buildPiTextEvent({
        conversationId,
        turnId,
        sequence: 1,
        text: `assistant ${index}`,
        createdAt: timestampFor(index, 500),
      }),
    ]);
  }

  await writeJson(path.join(coHome, 'conversations', conversationId, 'state.json'), {
    contract: 'co-conversation-v1',
    conversation_id: conversationId,
    provider: 'pi',
    provider_session_id: providerSessionId,
    project_path: '/tmp/ozw-oz47-real-project',
    status: 'completed',
    turns,
  });

  return {
    conversation_id: conversationId,
    provider: 'pi',
    provider_session_id: providerSessionId,
    project_path: '/tmp/ozw-oz47-real-project',
    turns,
  };
}

/**
 * Extract the append cursor field accepted by the proposal.
 */
function getAppendCursor(result) {
  return result?.appendCursor || result?.cursor || result?.nextCursor || result?.highWatermark || null;
}

test('co conversation limited reads return latest tail window in chronological order', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-oz47-tail-'));
  const previousCoHome = process.env.CCFLOW_CO_HOME;
  process.env.CCFLOW_CO_HOME = path.join(tempRoot, 'co');

  try {
    const conversation = await writeCoConversation(process.env.CCFLOW_CO_HOME, {
      conversationId: 'c47-tail',
      providerSessionId: 'pi-provider-tail',
      turnCount: 120,
    });

    const latest = await readCoConversationMessages(conversation, 'pi', 6, 0);
    assert.equal(latest.total, 240);
    assert.equal(latest.hasMore, true);
    assert.deepEqual(
      latest.messages.map((message) => message.message?.content),
      ['user 118', 'assistant 118', 'user 119', 'assistant 119', 'user 120', 'assistant 120'],
    );

    const previousPage = await readCoConversationMessages(conversation, 'pi', 4, 6);
    assert.deepEqual(
      previousPage.messages.map((message) => message.message?.content),
      ['user 116', 'assistant 116', 'user 117', 'assistant 117'],
    );
  } finally {
    if (previousCoHome === undefined) {
      delete process.env.CCFLOW_CO_HOME;
    } else {
      process.env.CCFLOW_CO_HOME = previousCoHome;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('co realtime cursor detects same assistant message content growth', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-oz47-cursor-'));
  const previousCoHome = process.env.CCFLOW_CO_HOME;
  process.env.CCFLOW_CO_HOME = path.join(tempRoot, 'co');

  try {
    const conversation = await writeCoConversation(process.env.CCFLOW_CO_HOME, {
      conversationId: 'c47-cursor',
      providerSessionId: 'pi-provider-cursor',
      turnCount: 1,
    });
    const turnId = conversation.turns[0];

    await writeTurnEvents(process.env.CCFLOW_CO_HOME, turnId, [
      buildPiTextEvent({
        conversationId: conversation.conversation_id,
        turnId,
        sequence: 1,
        text: 'Let',
        createdAt: '2026-05-24T01:00:01.000Z',
      }),
    ]);

    const initial = await readCoConversationMessages(conversation, 'pi', 10, 0);
    assert.deepEqual(
      initial.messages.map((message) => message.message?.content),
      ['user 1', 'Let'],
    );
    const cursor = getAppendCursor(initial);
    assert.ok(cursor, 'co read model must return an append cursor or equivalent revision');

    await writeTurnEvents(process.env.CCFLOW_CO_HOME, turnId, [
      buildPiTextEvent({
        conversationId: conversation.conversation_id,
        turnId,
        sequence: 1,
        text: 'Let',
        createdAt: '2026-05-24T01:00:01.000Z',
      }),
      buildPiTextEvent({
        conversationId: conversation.conversation_id,
        turnId,
        sequence: 2,
        text: 'Let me finish.',
        createdAt: '2026-05-24T01:00:02.000Z',
      }),
    ]);

    const refreshed = await readCoConversationMessages(conversation, 'pi', null, 0, {
      afterCursor: cursor,
    });
    assert.deepEqual(
      refreshed.messages.map((message) => ({ type: message.type, content: message.message?.content })),
      [{ type: 'assistant', content: 'Let me finish.' }],
    );
    assert.equal(refreshed.total, 2);
  } finally {
    if (previousCoHome === undefined) {
      delete process.env.CCFLOW_CO_HOME;
    } else {
      process.env.CCFLOW_CO_HOME = previousCoHome;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('scoped session_changed events match a cN route by provider session id', () => {
  const selectedSession = {
    id: 'c47',
    provider: 'pi',
    __provider: 'pi',
    providerSessionId: 'pi-provider-cursor',
    sourceSessionId: 'pi-provider-cursor',
  };

  const update = {
    type: 'session_changed',
    provider: 'pi',
    sessionId: 'pi-provider-cursor',
    providerSessionId: 'pi-provider-cursor',
    sourceSessionId: 'pi-provider-cursor',
    projectPath: '/tmp/ozw-oz47-real-project',
  };

  assert.equal(sessionChangedMatchesSelectedSession(update, selectedSession), true);
});
