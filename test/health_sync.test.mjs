import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('Apple Health real-time sync, biometrics calculation, and quick log', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orbit-health-test-'));
  const port = 37000 + Math.floor(Math.random() * 20000);
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

    async function request(path, method = 'GET', body, headers = {}) {
      const res = await fetch(base + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
        body: body ? JSON.stringify(body) : undefined
      });
      return { status: res.status, data: await res.json() };
    }

    // 1. Verify health setup endpoint returns token and URLs
    const setupRes = await request('/api/health/setup');
    assert.equal(setupRes.status, 200);
    assert.ok(setupRes.data.sync_token);
    assert.ok(setupRes.data.webhook_url.includes('/api/health/sync'));
    const token = setupRes.data.sync_token;

    // 2. Unauthorized sync attempt rejected
    const unauthRes = await request('/api/health/sync', 'POST', {
      steps: 5000
    });
    assert.equal(unauthRes.status, 401);
    assert.match(unauthRes.data.error, /token/i);

    // 3. Successful sync with valid header token
    const syncPayload = {
      steps: 8420,
      distance_km: 6.35,
      active_calories: 540,
      resting_heart_rate: 58,
      latest_heart_rate: 74,
      hrv_ms: 65,
      sleep_hours: 7.6,
      sleep_details: { deep_hours: 1.8, rem_hours: 2.1, core_hours: 3.7 },
      water_ml: 1500,
      weight_kg: 74.2,
      workouts: [
        { name: 'Strength Training', duration_mins: 50, calories: 320, started_at: '2026-09-23T11:00:00Z' }
      ]
    };

    const syncRes = await request('/api/health/sync', 'POST', syncPayload, {
      'X-Health-Token': token
    });
    assert.equal(syncRes.status, 200);
    assert.equal(syncRes.data.ok, true);
    assert.equal(syncRes.data.metrics.steps, 8420);
    assert.equal(syncRes.data.metrics.resting_heart_rate, 58);
    assert.equal(syncRes.data.metrics.hrv_ms, 65);
    assert.equal(syncRes.data.metrics.sleep_hours, 7.6);
    assert.equal(syncRes.data.metrics.workouts.length, 1);
    assert.equal(syncRes.data.metrics.workouts[0].name, 'Strength Training');

    // 4. Verify metrics endpoint returns saved metrics and 7-day history
    const metricsRes = await request('/api/health/metrics');
    assert.equal(metricsRes.status, 200);
    assert.equal(metricsRes.data.today.steps, 8420);
    assert.equal(metricsRes.data.today.active_calories, 540);
    assert.ok(Array.isArray(metricsRes.data.history));
    assert.equal(metricsRes.data.history.length, 7);
    assert.equal(metricsRes.data.settings.daily_step_goal, 10000);

    // 5. Verify /api/state includes health summary
    const stateRes = await request('/api/state');
    assert.equal(stateRes.status, 200);
    assert.ok(stateRes.data.health);
    assert.equal(stateRes.data.health.connected, true);
    assert.equal(stateRes.data.health.today.steps, 8420);

    // 6. Quick log water (+250ml)
    const quickWater = await request('/api/health/quick-log', 'POST', {
      action: 'add_water',
      amount_ml: 250
    });
    assert.equal(quickWater.status, 200);
    assert.equal(quickWater.data.metrics.water_ml, 1750); // 1500 + 250

    // 7. Quick log manual workout
    const quickWorkout = await request('/api/health/quick-log', 'POST', {
      action: 'log_workout',
      name: 'Evening Run',
      duration_mins: 30,
      calories: 260
    });
    assert.equal(quickWorkout.status, 200);
    assert.equal(quickWorkout.data.metrics.workouts.length, 2);
    assert.equal(quickWorkout.data.metrics.active_calories, 800); // 540 + 260

    // 8. Update health goals
    const updateSettings = await request('/api/health/settings', 'POST', {
      daily_step_goal: 12000,
      daily_calorie_goal: 750
    });
    assert.equal(updateSettings.status, 200);
    assert.equal(updateSettings.data.settings.daily_step_goal, 12000);
    assert.equal(updateSettings.data.settings.daily_calorie_goal, 750);

    // 9. Clear all health data
    const clearRes = await request('/api/health/clear', 'POST');
    assert.equal(clearRes.status, 200);
    assert.equal(clearRes.data.ok, true);
    const postClearMetrics = await request('/api/health/metrics');
    assert.equal(postClearMetrics.data.total_days, 0);
    assert.equal(postClearMetrics.data.sync_source, 'none');

    // 10. Direct import of Apple Health export.xml
    const sampleXml = `<?xml version="1.0"?>
<HealthData>
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="Watch" unit="count" startDate="2026-09-22 10:00:00 -0400" endDate="2026-09-22 10:30:00 -0400" value="9500"/>
 <Record type="HKQuantityTypeIdentifierActiveEnergyBurned" sourceName="Watch" unit="kcal" startDate="2026-09-22 10:00:00 -0400" endDate="2026-09-22 10:30:00 -0400" value="620"/>
 <Record type="HKQuantityTypeIdentifierRestingHeartRate" sourceName="Watch" unit="count/min" startDate="2026-09-22 08:00:00 -0400" endDate="2026-09-22 08:00:00 -0400" value="54"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Watch" startDate="2026-09-21 23:00:00 -0400" endDate="2026-09-22 07:00:00 -0400" value="HKCategoryValueSleepAnalysisAsleepCore"/>
</HealthData>`;
    const importRes = await fetch(base + '/api/health/import-export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/xml', 'X-Filename': 'export.xml' },
      body: sampleXml
    });
    const importData = await importRes.json();
    assert.equal(importRes.status, 200);
    assert.equal(importData.ok, true);
    assert.equal(importData.days_imported, 1);

    const importedMetrics = await request('/api/health/metrics?date=2026-09-22');
    assert.equal(importedMetrics.data.today.steps, 9500);
    assert.equal(importedMetrics.data.today.active_calories, 620);
    assert.equal(importedMetrics.data.today.resting_heart_rate, 54);
    assert.equal(importedMetrics.data.today.sleep_hours, 8);
    assert.equal(importedMetrics.data.sync_source, 'apple_export');

    // 11. Ingest Health Auto Export format via webhook
    const autoExportPayload = {
      data: {
        metrics: [
          { name: 'step_count', units: 'count', data: [{ date: '2026-09-23 00:00:00 -0400', qty: 11200 }] },
          { name: 'active_energy', units: 'kcal', data: [{ date: '2026-09-23 00:00:00 -0400', qty: 680 }] },
          { name: 'resting_heart_rate', units: 'count/min', data: [{ date: '2026-09-23 00:00:00 -0400', qty: 52 }] }
        ],
        workouts: [
          { name: 'Morning Run', duration: 1800, activeEnergyBurned: { qty: 310 } }
        ]
      }
    };
    const autoExportRes = await request(`/api/health/sync?token=${token}`, 'POST', autoExportPayload);
    assert.equal(autoExportRes.status, 200);
    assert.equal(autoExportRes.data.metrics.steps, 11200);
    assert.equal(autoExportRes.data.metrics.active_calories, 680);
    assert.equal(autoExportRes.data.metrics.resting_heart_rate, 52);
    assert.equal(autoExportRes.data.metrics.workouts.length, 1);
    assert.equal(autoExportRes.data.metrics.workouts[0].name, 'Morning Run');

    // 12. Test Multi-Day Range Queries, Aggregates, Available Dates, and Sleep Architecture
    const multiDayRes = await request('/api/health/metrics?date=2026-09-23&range=7');
    assert.equal(multiDayRes.status, 200);
    assert.equal(multiDayRes.data.range, '7');
    assert.ok(Array.isArray(multiDayRes.data.history));
    assert.equal(multiDayRes.data.history.length, 7);
    assert.ok(multiDayRes.data.aggregates);
    assert.ok(multiDayRes.data.aggregates.total_steps >= 11200 + 9500);
    assert.ok(multiDayRes.data.aggregates.avg_steps > 0);
    assert.ok(Array.isArray(multiDayRes.data.available_dates));
    assert.ok(multiDayRes.data.available_dates.length >= 2);
    assert.ok(multiDayRes.data.available_dates.some(d => d.date === '2026-09-23'));
    assert.ok(multiDayRes.data.available_dates.some(d => d.date === '2026-09-22'));

    const allTimeRes = await request('/api/health/metrics?date=2026-09-23&range=all');
    assert.equal(allTimeRes.status, 200);
    assert.equal(allTimeRes.data.range, 'all');
    assert.ok(allTimeRes.data.history.length >= 2);
    assert.ok(allTimeRes.data.aggregates.total_days >= 2);

    // Deep dive into 2026-09-22 sleep stages
    const dayViewRes = await request('/api/health/metrics?date=2026-09-22&range=day');
    assert.equal(dayViewRes.status, 200);
    assert.equal(dayViewRes.data.selected_day.date, '2026-09-22');
    assert.equal(dayViewRes.data.selected_day.sleep_hours, 8);
    assert.ok(dayViewRes.data.selected_day.sleep_details);
    assert.equal(dayViewRes.data.selected_day.sleep_details.core_hours, 8);
    assert.ok(dayViewRes.data.selected_day.sleep_details.efficiency_pct >= 90);

  } finally {
    child.kill('SIGTERM');
    await rm(dir, { recursive: true, force: true });
  }
});
