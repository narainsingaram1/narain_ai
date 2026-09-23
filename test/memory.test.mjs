import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  initMemorySchema,
  saveMemory,
  listMemories,
  deleteMemory,
  cosineSimilarity,
  float32ToBuffer,
  bufferToFloat32,
  hybridRetrieveMemories,
  saveChatMessage,
  getChatMessages
} from '../memory.mjs';

test('memory schema initialization and basic CRUD', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orbit-mem-'));
  const db = new DatabaseSync(join(dir, 'test.sqlite'));
  try {
    initMemorySchema(db);

    const mem = await saveMemory(db, {
      category: 'preference',
      content: 'Prefers studying CS 3600 in 2-hour morning blocks',
      importance: 4
    });

    assert.ok(mem.id);
    assert.equal(mem.category, 'preference');
    assert.equal(mem.content, 'Prefers studying CS 3600 in 2-hour morning blocks');
    assert.equal(mem.importance, 4);

    const list = listMemories(db);
    assert.equal(list.length, 1);

    const deleted = deleteMemory(db, mem.id);
    assert.equal(deleted.ok, true);
    assert.equal(listMemories(db).length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('vector math and cosine similarity calculations', () => {
  const v1 = new Float32Array([1, 0, 0]);
  const v2 = new Float32Array([1, 0, 0]);
  const v3 = new Float32Array([0, 1, 0]);
  const v4 = new Float32Array([0.7071, 0.7071, 0]);

  assert.equal(Math.round(cosineSimilarity(v1, v2)), 1);
  assert.equal(Math.round(cosineSimilarity(v1, v3)), 0);
  assert.ok(Math.abs(cosineSimilarity(v1, v4) - 0.7071) < 0.01);

  const buf = float32ToBuffer(v4);
  const restored = bufferToFloat32(buf);
  assert.equal(restored.length, 3);
  assert.ok(Math.abs(restored[0] - 0.7071) < 0.001);
});

test('hybrid retrieval with FTS5 lexical matching', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orbit-mem-'));
  const db = new DatabaseSync(join(dir, 'test.sqlite'));
  try {
    initMemorySchema(db);

    await saveMemory(db, {
      category: 'project_context',
      content: 'Preparing Robinhood OA and SWE internship interview questions',
      importance: 5
    });

    await saveMemory(db, {
      category: 'fact',
      content: 'Professor Smith is teaching LMC 3403 on Tuesdays and Thursdays',
      importance: 3
    });

    await saveMemory(db, {
      category: 'preference',
      content: 'Prefers dark mode and terminal CLI tools',
      importance: 2
    });

    const results = await hybridRetrieveMemories(db, 'Robinhood SWE interview', 3);
    assert.ok(results.length >= 1);
    assert.ok(results[0].content.includes('Robinhood OA'));
    assert.equal(results[0].access_count, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('chat session and multi-turn message history persistence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orbit-mem-'));
  const db = new DatabaseSync(join(dir, 'test.sqlite'));
  try {
    initMemorySchema(db);

    const sessionId = 'session-123';
    saveChatMessage(db, sessionId, { role: 'user', content: 'What are my upcoming deadlines?' });
    saveChatMessage(db, sessionId, { role: 'assistant', content: 'You have Homework 1B due next week.' });
    saveChatMessage(db, sessionId, { role: 'user', content: 'Can you break it into 2 tasks?' });

    const history = getChatMessages(db, sessionId);
    assert.equal(history.length, 3);
    assert.equal(history[0].role, 'user');
    assert.equal(history[0].content, 'What are my upcoming deadlines?');
    assert.equal(history[2].role, 'user');
    assert.equal(history[2].content, 'Can you break it into 2 tasks?');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
