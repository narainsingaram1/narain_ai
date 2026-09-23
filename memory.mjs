// Universal Second Brain Memory Engine for narain.ai (Orbit)
//
// Combines:
// 1. Lexical search (SQLite FTS5 BM25)
// 2. Dense vector embeddings (Zero-cost local Ollama 'nomic-embed-text' or fallback)
// 3. Reciprocal Rank Fusion (RRF) for fast, highly accurate, non-static retrieval
// 4. Multi-turn chat session persistence

import { randomUUID } from 'node:crypto';

export function initMemorySchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user','assistant','tool','system')),
      content TEXT NOT NULL,
      tool_calls TEXT,
      sources TEXT,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, created_at ASC);

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL CHECK(category IN ('preference','habit','fact','project_context','reflection')),
      content TEXT NOT NULL,
      importance INTEGER NOT NULL DEFAULT 3 CHECK(importance BETWEEN 1 AND 5),
      source_type TEXT NOT NULL,
      source_id TEXT,
      access_count INTEGER NOT NULL DEFAULT 0,
      last_accessed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_memories_cat ON memories(category);
    CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);

    CREATE TABLE IF NOT EXISTS embeddings (
      entity_type TEXT NOT NULL CHECK(entity_type IN ('memory','item','chat_message')),
      entity_id TEXT NOT NULL,
      dim INTEGER NOT NULL,
      embedding BLOB NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (entity_type, entity_id)
    ) STRICT;

    CREATE VIRTUAL TABLE IF NOT EXISTS memory_search USING fts5(content, category, content='memories', content_rowid='rowid');
    CREATE TRIGGER IF NOT EXISTS memory_ai AFTER INSERT ON memories BEGIN 
      INSERT INTO memory_search(rowid,content,category) VALUES(new.rowid,new.content,new.category); 
    END;
    CREATE TRIGGER IF NOT EXISTS memory_ad AFTER DELETE ON memories BEGIN 
      INSERT INTO memory_search(memory_search,rowid,content,category) VALUES('delete',old.rowid,old.content,old.category); 
    END;
    CREATE TRIGGER IF NOT EXISTS memory_au AFTER UPDATE ON memories BEGIN 
      INSERT INTO memory_search(memory_search,rowid,content,category) VALUES('delete',old.rowid,old.content,old.category); 
      INSERT INTO memory_search(rowid,content,category) VALUES(new.rowid,new.content,new.category); 
    END;
  `);
}

// Vector math utilities for Float32Array BLOB storage
export function float32ToBuffer(arr) {
  const f32 = arr instanceof Float32Array ? arr : new Float32Array(arr);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}

export function bufferToFloat32(buf) {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

export function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

let embeddingProbe = { available: null, lastChecked: 0 };

export async function isEmbeddingAvailable(ollamaUrl) {
  const now = Date.now();
  if (embeddingProbe.available !== null && (now - embeddingProbe.lastChecked < 30000)) {
    return embeddingProbe.available;
  }
  embeddingProbe.lastChecked = now;
  try {
    const res = await fetch(ollamaUrl + '/api/tags', { signal: AbortSignal.timeout(350) });
    embeddingProbe.available = res.ok;
  } catch {
    embeddingProbe.available = false;
  }
  return embeddingProbe.available;
}

// Zero-cost embedding using local Ollama model (e.g. nomic-embed-text)
export async function getEmbedding(text, options = {}) {
  // If running in a test suite with temporary data dir and no explicit embedding test, return null to avoid hitting mock model server
  if (process.env.ORBIT_DATA_DIR && !process.env.ORBIT_ENABLE_EMBEDDINGS && !options.forceEmbedding) {
    return null;
  }
  const ollamaUrl = options.ollamaUrl || process.env.ORBIT_OLLAMA_URL || 'http://127.0.0.1:11434';
  const model = options.embedModel || process.env.ORBIT_EMBED_MODEL || 'nomic-embed-text';
  const clean = String(text ?? '').trim().slice(0, 4000);
  if (!clean) return null;

  if (options.skipProbe !== true) {
    const ready = await isEmbeddingAvailable(ollamaUrl);
    if (!ready) return null;
  }

  try {
    const res = await fetch(ollamaUrl + '/api/embed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: clean }),
      signal: AbortSignal.timeout(1500)
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.embeddings?.[0])) return new Float32Array(data.embeddings[0]);
    }
  } catch {}

  // Fallback to legacy /api/embeddings endpoint
  try {
    const res = await fetch(ollamaUrl + '/api/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: clean }),
      signal: AbortSignal.timeout(1500)
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.embedding)) return new Float32Array(data.embedding);
    }
  } catch {}

  return null;
}

// Save or update a memory nugget
export async function saveMemory(db, { id, category = 'fact', content, importance = 3, sourceType = 'chat', sourceId = null }, options = {}) {
  const memoryId = id || randomUUID();
  const stamp = new Date().toISOString();
  const textContent = String(content || '').trim();
  if (!textContent) throw new Error('Memory content is required');

  const existing = db.prepare('SELECT id FROM memories WHERE id=?').get(memoryId);
  if (existing) {
    db.prepare('UPDATE memories SET category=?, content=?, importance=?, source_type=?, source_id=?, updated_at=? WHERE id=?')
      .run(category, textContent, importance, sourceType, sourceId, stamp, memoryId);
  } else {
    db.prepare('INSERT INTO memories(id, category, content, importance, source_type, source_id, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(memoryId, category, textContent, importance, sourceType, sourceId, stamp, stamp);
  }

  // Generate and store embedding if possible
  const vec = await getEmbedding(textContent, options);
  if (vec) {
    const buf = float32ToBuffer(vec);
    db.prepare('INSERT INTO embeddings(entity_type, entity_id, dim, embedding, updated_at) VALUES(?,?,?,?,?) ON CONFLICT(entity_type, entity_id) DO UPDATE SET dim=excluded.dim, embedding=excluded.embedding, updated_at=excluded.updated_at')
      .run('memory', memoryId, vec.length, buf, stamp);
  }

  return db.prepare('SELECT * FROM memories WHERE id=?').get(memoryId);
}

export function listMemories(db, { category = null, limit = 50 } = {}) {
  if (category) {
    return db.prepare('SELECT * FROM memories WHERE category=? ORDER BY importance DESC, updated_at DESC LIMIT ?').all(category, limit);
  }
  return db.prepare('SELECT * FROM memories ORDER BY importance DESC, updated_at DESC LIMIT ?').all(limit);
}

export function deleteMemory(db, id) {
  db.prepare('DELETE FROM memories WHERE id=?').run(id);
  db.prepare("DELETE FROM embeddings WHERE entity_type='memory' AND entity_id=?").run(id);
  return { ok: true };
}

// Reciprocal Rank Fusion (RRF) Hybrid Retrieval: Lexical (FTS5) + Dense Vector Cosine Similarity
export async function hybridRetrieveMemories(db, queryText, limit = 5, options = {}) {
  const q = String(queryText || '').trim();
  if (!q) return [];

  const ftsRanks = new Map();
  const tokens = q.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length >= 2);
  
  if (tokens.length) {
    try {
      const ftsQuery = tokens.map(t => `"${t}"*`).join(' OR ');
      const ftsRows = db.prepare(`
        SELECT m.id, m.category, m.content, m.importance, m.updated_at
        FROM memories m
        JOIN (SELECT rowid FROM memory_search WHERE memory_search MATCH ? LIMIT 25) s
        ON m.rowid = s.rowid
      `).all(ftsQuery);

      ftsRows.forEach((row, idx) => {
        ftsRanks.set(row.id, { rank: idx + 1, row });
      });
    } catch {}
  }

  // Dense Vector Retrieval (only if vector embeddings exist in DB)
  const vectorRanks = new Map();
  const hasEmbeddings = db.prepare("SELECT 1 FROM embeddings WHERE entity_type='memory' LIMIT 1").get();

  if (hasEmbeddings) {
    const queryVec = await getEmbedding(q, options);
    if (queryVec) {
      const storedVecs = db.prepare("SELECT entity_id, embedding FROM embeddings WHERE entity_type='memory'").all();
      const scored = [];
      for (const item of storedVecs) {
        const vec = bufferToFloat32(item.embedding);
        const sim = cosineSimilarity(queryVec, vec);
        if (sim > 0.15) {
          scored.push({ id: item.entity_id, sim });
        }
      }
      scored.sort((a, b) => b.sim - a.sim);
      scored.slice(0, 25).forEach((item, idx) => {
        vectorRanks.set(item.id, { rank: idx + 1, sim: item.sim });
      });
    }
  }

  // Combine scores with Reciprocal Rank Fusion (RRF k=60)
  const candidateIds = new Set([...ftsRanks.keys(), ...vectorRanks.keys()]);
  const rrfScores = [];
  const RRF_K = 60;

  for (const id of candidateIds) {
    let score = 0;
    if (ftsRanks.has(id)) score += 1 / (RRF_K + ftsRanks.get(id).rank);
    if (vectorRanks.has(id)) score += 1 / (RRF_K + vectorRanks.get(id).rank);

    const mem = db.prepare('SELECT * FROM memories WHERE id=?').get(id);
    if (mem) {
      // Small multiplier for high importance memories
      const weightedScore = score * (1 + (mem.importance - 3) * 0.1);
      rrfScores.push({ mem, score: weightedScore });
    }
  }

  rrfScores.sort((a, b) => b.score - a.score);
  const selected = rrfScores.slice(0, limit).map(item => item.mem);

  // Update access count and timestamp
  if (selected.length) {
    const stamp = new Date().toISOString();
    const updateStmt = db.prepare('UPDATE memories SET access_count=access_count+1, last_accessed_at=? WHERE id=?');
    for (const mem of selected) {
      updateStmt.run(stamp, mem.id);
      mem.access_count = (mem.access_count || 0) + 1;
      mem.last_accessed_at = stamp;
    }
  }

  return selected;
}

// Chat Session & History Persistence
export function getOrCreateChatSession(db, sessionId = null, title = 'Current Workspace Dialogue') {
  const stamp = new Date().toISOString();
  if (sessionId) {
    const existing = db.prepare('SELECT * FROM chat_sessions WHERE id=?').get(sessionId);
    if (existing) return existing;
  }
  const id = sessionId || randomUUID();
  db.prepare('INSERT INTO chat_sessions(id, title, created_at, updated_at) VALUES(?,?,?,?)').run(id, title, stamp, stamp);
  return db.prepare('SELECT * FROM chat_sessions WHERE id=?').get(id);
}

export function saveChatMessage(db, sessionId, { role, content, tool_calls = null, sources = null }) {
  const id = randomUUID();
  const stamp = new Date().toISOString();
  getOrCreateChatSession(db, sessionId);

  db.prepare('INSERT INTO chat_messages(id, session_id, role, content, tool_calls, sources, created_at) VALUES(?,?,?,?,?,?,?)')
    .run(
      id,
      sessionId,
      role,
      String(content || ''),
      tool_calls ? JSON.stringify(tool_calls) : null,
      sources ? JSON.stringify(sources) : null,
      stamp
    );
  db.prepare('UPDATE chat_sessions SET updated_at=? WHERE id=?').run(stamp, sessionId);
  return id;
}

export function getChatMessages(db, sessionId, limit = 12) {
  if (!sessionId) return [];
  const rows = db.prepare('SELECT * FROM chat_messages WHERE session_id=? ORDER BY created_at DESC LIMIT ?').all(sessionId, limit);
  rows.reverse();
  return rows.map(r => ({
    id: r.id,
    role: r.role,
    content: r.content,
    tool_calls: r.tool_calls ? JSON.parse(r.tool_calls) : null,
    sources: r.sources ? JSON.parse(r.sources) : null,
    created_at: r.created_at
  }));
}
