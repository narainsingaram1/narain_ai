import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('daily plan templates CRUD, save day as template, and apply to date', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orbit-template-test-'));
  const port = 36000 + Math.floor(Math.random() * 20000);
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: join(import.meta.dirname, '..'),
    env: { ...process.env, ORBIT_DATA_DIR: dir, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Server startup timed out')), 5000);
      child.stdout.on('data', data => {
        if (data.toString().includes('Orbit is running')) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.once('exit', code => {
        clearTimeout(timer);
        reject(new Error(`Server exited: ${code}`));
      });
    });

    async function request(path, method = 'GET', body) {
      const res = await fetch(base + path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
      });
      return { status: res.status, data: await res.json() };
    }

    // 1. Verify default templates are seeded
    const templatesRes = await request('/api/plan-templates');
    assert.equal(templatesRes.status, 200);
    assert.ok(templatesRes.data.length >= 3);
    const morningTpl = templatesRes.data.find(t => t.name.includes('Morning Momentum'));
    assert.ok(morningTpl);
    assert.ok(morningTpl.blocks.length >= 4);
    assert.equal(morningTpl.blocks[0].start_time, '07:00');
    assert.equal(morningTpl.blocks[0].end_time, '08:00');

    // 2. State endpoint includes plan_templates
    const stateRes = await request('/api/state');
    assert.equal(stateRes.status, 200);
    assert.ok(Array.isArray(stateRes.data.plan_templates));
    assert.equal(stateRes.data.plan_templates.length, templatesRes.data.length);

    // 3. Create a custom template directly
    const customTpl = await request('/api/plan-templates', 'POST', {
      name: 'Gym & LeetCode Focus',
      description: 'Custom daily routine for peak productivity',
      blocks: [
        { start_time: '07:00', end_time: '08:00', title: 'GYM', body: 'Leg day', area_name: 'Health', priority: 'high' },
        { start_time: '08:00', end_time: '09:00', title: 'Take a shower and meditation', body: 'Reset', area_name: 'Personal', priority: 'medium' },
        { start_time: '09:00', end_time: '11:00', title: 'Study LeetCode', body: 'Graphs and Trees', area_name: 'Career', priority: 'high' }
      ]
    });
    assert.equal(customTpl.status, 201);
    assert.equal(customTpl.data.name, 'Gym & LeetCode Focus');
    assert.equal(customTpl.data.blocks.length, 3);

    // 4. Apply custom template to a target date
    const targetDate = '2026-10-15';
    const applyRes = await request(`/api/plan-templates/${customTpl.data.id}/apply`, 'POST', {
      date: targetDate,
      mode: 'append'
    });
    assert.equal(applyRes.status, 200);
    assert.equal(applyRes.data.applied, 3);

    // Verify items were created on target date
    const itemsRes = await request('/api/items?type=event');
    assert.equal(itemsRes.status, 200);
    const dayEvents = itemsRes.data.filter(i => {
      const d = new Date(i.starts_at);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      return key === targetDate;
    }).sort((a,b) => (a.starts_at || '').localeCompare(b.starts_at || ''));
    assert.equal(dayEvents.length, 3);
    assert.equal(dayEvents[0].title, 'GYM');
    assert.equal(dayEvents[1].title, 'Take a shower and meditation');
    assert.equal(dayEvents[2].title, 'Study LeetCode');

    // 5. Save the day as a new template
    const savedDayRes = await request('/api/plan-templates/save-day', 'POST', {
      date: targetDate,
      name: 'Cloned 10-15 Routine',
      description: 'Saved from active day schedule'
    });
    assert.equal(savedDayRes.status, 201);
    assert.equal(savedDayRes.data.name, 'Cloned 10-15 Routine');
    assert.equal(savedDayRes.data.blocks.length, 3);

    // 6. Test replace mode when applying template
    const replaceRes = await request(`/api/plan-templates/${customTpl.data.id}/apply`, 'POST', {
      date: targetDate,
      mode: 'replace'
    });
    assert.equal(replaceRes.status, 200);
    assert.equal(replaceRes.data.applied, 3);

    const itemsAfterReplace = await request('/api/items?type=event');
    const dayEventsAfterReplace = itemsAfterReplace.data.filter(i => {
      const d = new Date(i.starts_at);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      return key === targetDate;
    });
    // Should be exactly 3, not 6
    assert.equal(dayEventsAfterReplace.length, 3);

    // 7. Delete custom template
    const deleteRes = await request(`/api/plan-templates/${customTpl.data.id}`, 'DELETE');
    assert.equal(deleteRes.status, 200);

    const templatesAfterDelete = await request('/api/plan-templates');
    assert.ok(!templatesAfterDelete.data.some(t => t.id === customTpl.data.id));

  } finally {
    child.kill('SIGTERM');
    await rm(dir, { recursive: true, force: true });
  }
});
