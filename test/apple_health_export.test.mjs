import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile, rm } from 'node:fs/promises';
import {
  parseAppleHealthXmlStream,
  formatWorkoutType,
  saveParsedHealthRecords,
  streamZipExport
} from '../health_export_parser.mjs';

test('formatWorkoutType correctly maps Apple Health workout activity identifiers', () => {
  assert.equal(formatWorkoutType('HKWorkoutActivityTypeRunning'), 'Running');
  assert.equal(formatWorkoutType('HKWorkoutActivityTypeTraditionalStrengthTraining'), 'Strength Training');
  assert.equal(formatWorkoutType('HKWorkoutActivityTypeHighIntensityIntervalTraining'), 'HIIT');
  assert.equal(formatWorkoutType('HKWorkoutActivityTypePickleball'), 'Pickleball');
  assert.equal(formatWorkoutType(''), 'Workout');
});

test('parseAppleHealthXmlStream aggregates real biometrics and deduplicates sources', async () => {
  const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<HealthData locale="en_US">
 <ExportDate value="2026-09-23 04:00:00 -0400"/>
 <!-- Day 1: 2026-09-22 -->
 <!-- Step counts from Watch and iPhone - should pick Watch and avoid double-count -->
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="Narain's Apple Watch" unit="count" startDate="2026-09-22 09:00:00 -0400" endDate="2026-09-22 09:30:00 -0400" value="3200"/>
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="Narain's Apple Watch" unit="count" startDate="2026-09-22 14:00:00 -0400" endDate="2026-09-22 15:00:00 -0400" value="5100"/>
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="Narain's iPhone" unit="count" startDate="2026-09-22 09:00:00 -0400" endDate="2026-09-22 09:30:00 -0400" value="2800"/>
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="Narain's iPhone" unit="count" startDate="2026-09-22 14:00:00 -0400" endDate="2026-09-22 15:00:00 -0400" value="4400"/>

 <!-- Distance in miles -->
 <Record type="HKQuantityTypeIdentifierDistanceWalkingRunning" sourceName="Narain's Apple Watch" unit="mi" startDate="2026-09-22 09:00:00 -0400" endDate="2026-09-22 15:00:00 -0400" value="4.0"/>

 <!-- Active calories -->
 <Record type="HKQuantityTypeIdentifierActiveEnergyBurned" sourceName="Narain's Apple Watch" unit="kcal" startDate="2026-09-22 09:00:00 -0400" endDate="2026-09-22 15:00:00 -0400" value="540"/>

 <!-- Heart rates -->
 <Record type="HKQuantityTypeIdentifierRestingHeartRate" sourceName="Narain's Apple Watch" unit="count/min" startDate="2026-09-22 08:00:00 -0400" endDate="2026-09-22 08:00:00 -0400" value="55"/>
 <Record type="HKQuantityTypeIdentifierHeartRate" sourceName="Narain's Apple Watch" unit="count/min" startDate="2026-09-22 10:00:00 -0400" endDate="2026-09-22 10:00:00 -0400" value="72"/>
 <Record type="HKQuantityTypeIdentifierHeartRate" sourceName="Narain's Apple Watch" unit="count/min" startDate="2026-09-22 16:30:00 -0400" endDate="2026-09-22 16:30:00 -0400" value="84"/>
 <Record type="HKQuantityTypeIdentifierHeartRateVariabilitySDNN" sourceName="Narain's Apple Watch" unit="ms" startDate="2026-09-22 08:15:00 -0400" endDate="2026-09-22 08:15:00 -0400" value="68"/>

 <!-- Sleep stages ending morning of 2026-09-22 -->
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Narain's Apple Watch" startDate="2026-09-21 23:30:00 -0400" endDate="2026-09-22 03:30:00 -0400" value="HKCategoryValueSleepAnalysisAsleepCore"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Narain's Apple Watch" startDate="2026-09-22 03:30:00 -0400" endDate="2026-09-22 05:00:00 -0400" value="HKCategoryValueSleepAnalysisAsleepDeep"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Narain's Apple Watch" startDate="2026-09-22 05:00:00 -0400" endDate="2026-09-22 07:00:00 -0400" value="HKCategoryValueSleepAnalysisAsleepREM"/>

 <!-- Water & Weight -->
 <Record type="HKQuantityTypeIdentifierDietaryWater" sourceName="Water Tracker" unit="mL" startDate="2026-09-22 11:00:00 -0400" endDate="2026-09-22 11:00:00 -0400" value="750"/>
 <Record type="HKQuantityTypeIdentifierBodyMass" sourceName="Smart Scale" unit="lb" startDate="2026-09-22 07:30:00 -0400" endDate="2026-09-22 07:30:00 -0400" value="165"/>

 <!-- Workout -->
 <Workout workoutActivityType="HKWorkoutActivityTypeTraditionalStrengthTraining" duration="45" durationUnit="min" totalEnergyBurned="320" totalEnergyBurnedUnit="kcal" startDate="2026-09-22 17:00:00 -0400" endDate="2026-09-22 17:45:00 -0400">
 </Workout>
</HealthData>`;

  const stream = Readable.from(sampleXml.split('\n'));
  const parsed = await parseAppleHealthXmlStream(stream);

  assert.equal(parsed.daysCount, 1);
  assert.equal(parsed.dateRange.start, '2026-09-22');
  assert.equal(parsed.dateRange.end, '2026-09-22');

  const day = parsed.days[0];
  assert.equal(day.date, '2026-09-22');
  // Watch recorded 3200 + 5100 = 8300. iPhone recorded 2800 + 4400 = 7200.
  // Result must be 8300 steps (not 15500!).
  assert.equal(day.steps, 8300);
  assert.equal(day.active_calories, 540);
  assert.equal(day.distance_km, 6.44); // 4 miles * 1.60934
  assert.equal(day.resting_heart_rate, 55);
  assert.equal(day.latest_heart_rate, 84);
  assert.equal(day.hrv_ms, 68);
  // Sleep: 4h core + 1.5h deep + 2h rem = 7.5h total
  assert.equal(day.sleep_hours, 7.5);
  assert.equal(day.sleep_details.core_hours, 4);
  assert.equal(day.sleep_details.deep_hours, 1.5);
  assert.equal(day.sleep_details.rem_hours, 2);
  assert.ok(day.sleep_details.score > 70, `Expected sleep score > 70, got ${day.sleep_details.score}`);
  assert.ok(day.sleep_details.efficiency_pct > 80, `Expected efficiency > 80%, got ${day.sleep_details.efficiency_pct}`);
  assert.equal(day.min_heart_rate, 72);
  assert.equal(day.max_heart_rate, 84);
  assert.equal(day.water_ml, 750);
  assert.equal(day.weight_kg, 74.8); // 165 lbs * 0.453592
  assert.equal(day.workouts.length, 1);
  assert.equal(day.workouts[0].name, 'Strength Training');
  assert.equal(day.workouts[0].duration_mins, 45);
  assert.equal(day.workouts[0].calories, 320);

  // Verify SQLite insertion
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE health_daily (
      date TEXT PRIMARY KEY,
      steps INTEGER NOT NULL DEFAULT 0,
      distance_km REAL NOT NULL DEFAULT 0,
      active_calories REAL NOT NULL DEFAULT 0,
      resting_heart_rate REAL,
      latest_heart_rate REAL,
      hrv_ms REAL,
      sleep_hours REAL NOT NULL DEFAULT 0,
      sleep_details TEXT NOT NULL DEFAULT '{}',
      water_ml REAL NOT NULL DEFAULT 0,
      weight_kg REAL,
      workouts TEXT NOT NULL DEFAULT '[]',
      last_synced_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE health_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
  `);

  saveParsedHealthRecords(db, parsed.days, 'apple_export');
  const row = db.prepare('SELECT * FROM health_daily WHERE date=?').get('2026-09-22');
  assert.ok(row);
  assert.equal(row.steps, 8300);
  assert.equal(row.active_calories, 540);
  assert.equal(row.resting_heart_rate, 55);
  assert.equal(row.sleep_hours, 7.5);
  const setting = db.prepare("SELECT value FROM health_settings WHERE key='sync_source'").get();
  assert.equal(setting.value, 'apple_export');
});

test('streamZipExport reads export.xml from a zip archive directly via pipe', async () => {
  const tmp = join(tmpdir(), `orbit-zip-test-${Date.now()}`);
  execSync(`mkdir -p "${tmp}/apple_health_export"`);
  const testXml = `<?xml version="1.0"?>
<HealthData>
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="Watch" unit="count" startDate="2026-09-23 10:00:00 -0400" endDate="2026-09-23 10:30:00 -0400" value="6400"/>
</HealthData>`;
  await writeFile(join(tmp, 'apple_health_export', 'export.xml'), testXml, 'utf8');
  execSync(`cd "${tmp}" && zip -q -r export.zip apple_health_export`);

  const stream = streamZipExport(join(tmp, 'export.zip'));
  const parsed = await parseAppleHealthXmlStream(stream);

  assert.equal(parsed.daysCount, 1);
  assert.equal(parsed.days[0].steps, 6400);

  await rm(tmp, { recursive: true, force: true });
});
