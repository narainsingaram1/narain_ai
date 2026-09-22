import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('fast-path executes conversational add prompt with zero model delay', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orbit-fast-'));
  const port = 36000 + Math.floor(Math.random() * 10000);
  // Intentionally invalid model URL to prove that fast-path needs NO model
  const app = spawn(process.execPath, ['server.mjs'], {
    cwd: join(import.meta.dirname, '..'),
    env: {
      ...process.env,
      ORBIT_DATA_DIR: dir,
      PORT: String(port),
      ORBIT_OLLAMA_URL: 'http://127.0.0.1:59999'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Startup timed out')), 5000);
      app.stdout.on('data', data => {
        if (data.toString().includes('Orbit is running')) {
          clearTimeout(timer);
          resolve();
        }
      });
      app.once('exit', code => {
        clearTimeout(timer);
        reject(new Error(`App exited: ${code}`));
      });
    });

    const request = async (path, body, method = body ? 'POST' : 'GET') => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
      });
      return { status: response.status, data: await response.json() };
    };

    // 1. Settings endpoint works
    const settings = await request('/api/settings');
    assert.equal(settings.status, 200);
    assert.equal(settings.data.provider, 'Local Ollama');

    // 2. The exact prompt from user screenshot succeeds instantly via fast-path
    const started = Date.now();
    const result = await request('/api/assistant', {
      question: 'I have a Superhuman SWE OA due in 7 days can you please add it to tasks'
    });
    const elapsed = Date.now() - started;

    assert.equal(result.status, 200);
    assert.ok(elapsed < 2000, `Expected instant execution, took ${elapsed}ms`);
    assert.equal(result.data.changes.length, 1);
    const created = result.data.changes[0];
    assert.equal(created.title, 'Superhuman SWE OA');
    assert.equal(created.area_name, 'Career');
    assert.ok(created.due_at, 'Due date must be set');
    assert.ok(result.data.answer.includes('Created task “Superhuman SWE OA”'));

    // 3. Settings update works
    const updated = await request('/api/settings', { groq_model: 'llama-3.3-70b-versatile' });
    assert.equal(updated.status, 200);
  } finally {
    app.kill('SIGTERM');
    await rm(dir, { recursive: true, force: true });
  }
});

test('anti-stall guard catches model asking questions and creates task anyway', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orbit-antistall-'));
  // Stub model that stubbornly asks clarification questions like Ollama 4b did in user's screenshot
  const stubbornModel = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      message: {
        role: 'assistant',
        content: 'To add this as a task, I need to know: 1. What is the exact title? 2. What area should it be in? 3. What class? 4. What date?'
      }
    }));
  });
  await new Promise(resolve => stubbornModel.listen(0, '127.0.0.1', resolve));
  const modelPort = stubbornModel.address().port;
  const port = 36000 + Math.floor(Math.random() * 10000);

  const app = spawn(process.execPath, ['server.mjs'], {
    cwd: join(import.meta.dirname, '..'),
    env: {
      ...process.env,
      ORBIT_DATA_DIR: dir,
      PORT: String(port),
      ORBIT_OLLAMA_URL: `http://127.0.0.1:${modelPort}`
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Startup timed out')), 5000);
      app.stdout.on('data', data => {
        if (data.toString().includes('Orbit is running')) {
          clearTimeout(timer);
          resolve();
        }
      });
      app.once('exit', code => {
        clearTimeout(timer);
        reject(new Error(`App exited: ${code}`));
      });
    });

    const request = async (path, body) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
      });
      return { status: response.status, data: await response.json() };
    };

    // User prompt that reaches the model, model stalls with questions, Anti-Stall Guard recovers and creates it!
    const result = await request('/api/assistant', {
      question: 'Add a task to submit the Stripe take-home by tomorrow at 5pm'
    });
    assert.equal(result.status, 200);
    assert.equal(result.data.changes.length, 1);
    assert.equal(result.data.changes[0].title, 'Submit the Stripe take-home');
    assert.ok(result.data.changes[0].due_at);
    assert.ok(result.data.answer.includes('Created task “Submit the Stripe take-home”'));
  } finally {
    app.kill('SIGTERM');
    stubbornModel.close();
    await rm(dir, { recursive: true, force: true });
  }
});
