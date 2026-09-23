import { createReadStream } from 'node:fs';
import { spawn } from 'node:child_process';

const WORKOUT_ACTIVITY_MAP = {
  HKWorkoutActivityTypeRunning: 'Running',
  HKWorkoutActivityTypeWalking: 'Walking',
  HKWorkoutActivityTypeCycling: 'Cycling',
  HKWorkoutActivityTypeSwimming: 'Swimming',
  HKWorkoutActivityTypeTraditionalStrengthTraining: 'Strength Training',
  HKWorkoutActivityTypeFunctionalStrengthTraining: 'Functional Training',
  HKWorkoutActivityTypeHighIntensityIntervalTraining: 'HIIT',
  HKWorkoutActivityTypeYoga: 'Yoga',
  HKWorkoutActivityTypePilates: 'Pilates',
  HKWorkoutActivityTypeHiking: 'Hiking',
  HKWorkoutActivityTypeElliptical: 'Elliptical',
  HKWorkoutActivityTypeRower: 'Rowing',
  HKWorkoutActivityTypeStairClimbing: 'Stair Climbing',
  HKWorkoutActivityTypeCoreTraining: 'Core Training',
  HKWorkoutActivityTypeCooldown: 'Cool Down',
  HKWorkoutActivityTypeBarre: 'Barre',
  HKWorkoutActivityTypeBoxing: 'Boxing',
  HKWorkoutActivityTypeKickboxing: 'Kickboxing',
  HKWorkoutActivityTypeMartialArts: 'Martial Arts',
  HKWorkoutActivityTypeDance: 'Dance',
  HKWorkoutActivityTypeCrossTraining: 'Cross Training',
  HKWorkoutActivityTypeSoccer: 'Soccer',
  HKWorkoutActivityTypeBasketball: 'Basketball',
  HKWorkoutActivityTypeTennis: 'Tennis'
};

export function formatWorkoutType(rawType) {
  if (!rawType) return 'Workout';
  if (WORKOUT_ACTIVITY_MAP[rawType]) return WORKOUT_ACTIVITY_MAP[rawType];
  const cleaned = rawType.replace(/^HKWorkoutActivityType/, '');
  return cleaned.replace(/([a-z])([A-Z])/g, '$1 $2').trim() || 'Workout';
}

function parseAppleDate(dateStr) {
  if (!dateStr) return null;
  const trimmed = dateStr.trim();
  const m = trimmed.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+([+-]\d{2})(\d{2})?$/);
  if (m) {
    const tz = m[4] ? `${m[3]}:${m[4]}` : `${m[3]}:00`;
    return new Date(`${m[1]}T${m[2]}${tz}`);
  }
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d;
}

function extractAttr(str, attrName) {
  const regex = new RegExp(`${attrName}="([^"]*)"`);
  const match = str.match(regex);
  return match ? match[1] : null;
}

export async function parseAppleHealthXmlStream(stream) {
  const dailyMap = new Map();
  let totalRecords = 0;

  function getDay(dateStr) {
    if (!dailyMap.has(dateStr)) {
      dailyMap.set(dateStr, {
        date: dateStr,
        stepSources: {},
        distance_km: 0,
        calorieSources: {},
        restingHrSum: 0,
        restingHrCount: 0,
        hrSum: 0,
        hrCount: 0,
        min_heart_rate: null,
        max_heart_rate: null,
        latest_heart_rate: null,
        latestHrTime: 0,
        hrvSum: 0,
        hrvCount: 0,
        latest_hrv: null,
        sleep_hours: 0,
        sleep_core_hours: 0,
        sleep_deep_hours: 0,
        sleep_rem_hours: 0,
        sleep_awake_hours: 0,
        sleep_in_bed_hours: 0,
        water_ml: 0,
        weight_kg: null,
        weightTime: 0,
        workouts: []
      });
    }
    return dailyMap.get(dateStr);
  }

  function handleElement(tag, attrs) {
    totalRecords++;
    if (tag === 'Record') {
      const type = extractAttr(attrs, 'type');
      if (!type) return;

      const startDateStr = extractAttr(attrs, 'startDate');
      const endDateStr = extractAttr(attrs, 'endDate');
      const sourceName = extractAttr(attrs, 'sourceName') || 'Unknown';
      const unit = extractAttr(attrs, 'unit') || '';
      const rawVal = extractAttr(attrs, 'value') || '';
      const numVal = parseFloat(rawVal);

      if (type === 'HKQuantityTypeIdentifierStepCount') {
        const dateKey = (startDateStr || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || Number.isNaN(numVal)) return;
        const day = getDay(dateKey);
        const isWatch = /watch/i.test(sourceName);
        const sourceKey = isWatch ? 'watch' : sourceName;
        day.stepSources[sourceKey] = (day.stepSources[sourceKey] || 0) + numVal;
      } else if (type === 'HKQuantityTypeIdentifierDistanceWalkingRunning') {
        const dateKey = (startDateStr || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || Number.isNaN(numVal)) return;
        const day = getDay(dateKey);
        const km = unit.toLowerCase() === 'mi' || unit.toLowerCase() === 'miles' ? numVal * 1.60934 : numVal;
        day.distance_km += km;
      } else if (type === 'HKQuantityTypeIdentifierActiveEnergyBurned') {
        const dateKey = (startDateStr || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || Number.isNaN(numVal)) return;
        const day = getDay(dateKey);
        const isWatch = /watch/i.test(sourceName);
        const sourceKey = isWatch ? 'watch' : sourceName;
        day.calorieSources[sourceKey] = (day.calorieSources[sourceKey] || 0) + numVal;
      } else if (type === 'HKQuantityTypeIdentifierRestingHeartRate') {
        const dateKey = (startDateStr || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || Number.isNaN(numVal)) return;
        const day = getDay(dateKey);
        day.restingHrSum += numVal;
        day.restingHrCount += 1;
      } else if (type === 'HKQuantityTypeIdentifierHeartRate') {
        const dateKey = (startDateStr || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || Number.isNaN(numVal)) return;
        const day = getDay(dateKey);
        day.hrSum += numVal;
        day.hrCount += 1;
        if (day.min_heart_rate === null || numVal < day.min_heart_rate) day.min_heart_rate = Math.round(numVal);
        if (day.max_heart_rate === null || numVal > day.max_heart_rate) day.max_heart_rate = Math.round(numVal);
        const dObj = parseAppleDate(startDateStr);
        const t = dObj ? dObj.getTime() : 0;
        if (t >= day.latestHrTime) {
          day.latestHrTime = t;
          day.latest_heart_rate = Math.round(numVal);
        }
      } else if (type === 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN') {
        const dateKey = (startDateStr || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || Number.isNaN(numVal)) return;
        const day = getDay(dateKey);
        day.hrvSum += numVal;
        day.hrvCount += 1;
        day.latest_hrv = Math.round(numVal);
      } else if (type === 'HKCategoryTypeIdentifierSleepAnalysis') {
        const endDayKey = (endDateStr || startDateStr || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(endDayKey)) return;
        const startObj = parseAppleDate(startDateStr);
        const endObj = parseAppleDate(endDateStr);
        if (!startObj || !endObj || endObj <= startObj) return;
        const durationHours = (endObj.getTime() - startObj.getTime()) / 3600000;
        const day = getDay(endDayKey);

        const val = rawVal.toLowerCase();
        if (val.includes('core')) {
          day.sleep_core_hours += durationHours;
          day.sleep_hours += durationHours;
        } else if (val.includes('deep')) {
          day.sleep_deep_hours += durationHours;
          day.sleep_hours += durationHours;
        } else if (val.includes('rem')) {
          day.sleep_rem_hours += durationHours;
          day.sleep_hours += durationHours;
        } else if (val.includes('awake')) {
          day.sleep_awake_hours += durationHours;
        } else if (val.includes('inbed')) {
          day.sleep_in_bed_hours += durationHours;
        } else if (val.includes('asleep')) {
          day.sleep_hours += durationHours;
        }
      } else if (type === 'HKQuantityTypeIdentifierDietaryWater') {
        const dateKey = (startDateStr || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || Number.isNaN(numVal)) return;
        const day = getDay(dateKey);
        let ml = numVal;
        if (unit.toLowerCase().includes('oz')) {
          ml = numVal * 29.5735;
        }
        day.water_ml += ml;
      } else if (type === 'HKQuantityTypeIdentifierBodyMass') {
        const dateKey = (startDateStr || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || Number.isNaN(numVal)) return;
        const day = getDay(dateKey);
        let kg = numVal;
        if (unit.toLowerCase().includes('lb')) {
          kg = numVal * 0.453592;
        }
        const dObj = parseAppleDate(startDateStr);
        const t = dObj ? dObj.getTime() : 0;
        if (t >= day.weightTime) {
          day.weightTime = t;
          day.weight_kg = Math.round(kg * 10) / 10;
        }
      }
    } else if (tag === 'Workout') {
      const activityType = extractAttr(attrs, 'workoutActivityType');
      const startDateStr = extractAttr(attrs, 'startDate');
      const dateKey = (startDateStr || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return;

      const durationAttr = parseFloat(extractAttr(attrs, 'duration') || '0');
      const durationUnit = (extractAttr(attrs, 'durationUnit') || 'min').toLowerCase();
      let durationMins = durationAttr;
      if (durationUnit.includes('s') || durationUnit === 'sec') durationMins = durationAttr / 60;
      else if (durationUnit.includes('hr') || durationUnit === 'hour') durationMins = durationAttr * 60;

      const energyAttr = parseFloat(extractAttr(attrs, 'totalEnergyBurned') || '0');
      const workoutName = formatWorkoutType(activityType);

      const day = getDay(dateKey);
      const startedIso = parseAppleDate(startDateStr)?.toISOString() || `${dateKey}T12:00:00Z`;
      day.workouts.push({
        name: workoutName,
        duration_mins: Math.max(1, Math.round(durationMins)),
        calories: Math.max(0, Math.round(energyAttr)),
        started_at: startedIso
      });
    }
  }

  // Stream through chunks safely, handling boundaries
  let remainder = '';
  for await (const chunk of stream) {
    const text = remainder + (typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    const lastOpen = text.lastIndexOf('<');
    const safeText = lastOpen >= 0 ? text.slice(0, lastOpen) : text;
    remainder = lastOpen >= 0 ? text.slice(lastOpen) : '';

    const tagRegex = /<(Record|Workout)\s+([^>]+)>/g;
    let m;
    while ((m = tagRegex.exec(safeText)) !== null) {
      handleElement(m[1], m[2]);
    }
  }

  if (remainder) {
    const tagRegex = /<(Record|Workout)\s+([^>]+)>/g;
    let m;
    while ((m = tagRegex.exec(remainder)) !== null) {
      handleElement(m[1], m[2]);
    }
  }

  // Compile final clean records
  const result = [];
  for (const day of dailyMap.values()) {
    const stepSourceVals = Object.values(day.stepSources);
    const steps = stepSourceVals.length
      ? (day.stepSources.watch ? Math.round(day.stepSources.watch) : Math.round(Math.max(...stepSourceVals)))
      : 0;

    const calSourceVals = Object.values(day.calorieSources);
    const activeCalories = calSourceVals.length
      ? (day.calorieSources.watch ? Math.round(day.calorieSources.watch) : Math.round(Math.max(...calSourceVals)))
      : 0;

    const restingHr = day.restingHrCount > 0 ? Math.round(day.restingHrSum / day.restingHrCount) : null;
    const latestHr = day.latest_heart_rate !== null ? day.latest_heart_rate : (day.hrCount > 0 ? Math.round(day.hrSum / day.hrCount) : null);
    const hrv = day.latest_hrv !== null ? day.latest_hrv : (day.hrvCount > 0 ? Math.round(day.hrvSum / day.hrvCount) : null);

    const totalSleep = Math.round(day.sleep_hours * 10) / 10;
    const coreH = Math.round(day.sleep_core_hours * 10) / 10;
    const deepH = Math.round(day.sleep_deep_hours * 10) / 10;
    const remH = Math.round(day.sleep_rem_hours * 10) / 10;
    const awakeH = Math.round(day.sleep_awake_hours * 10) / 10;
    const computedInBed = day.sleep_in_bed_hours > 0 ? day.sleep_in_bed_hours : (day.sleep_hours + day.sleep_awake_hours);
    const inBedH = Math.round(computedInBed * 10) / 10;
    const efficiencyPct = inBedH > 0 ? Math.min(100, Math.round((totalSleep / inBedH) * 100)) : (totalSleep > 0 ? 95 : 0);

    // Sleep quality score (0-100)
    let score = 0;
    if (totalSleep > 0) {
      const durationScore = Math.min(45, (totalSleep / 8) * 45);
      const deepRatio = totalSleep > 0 ? deepH / totalSleep : 0;
      const deepScore = Math.min(25, (deepRatio / 0.20) * 25);
      const remRatio = totalSleep > 0 ? remH / totalSleep : 0;
      const remScore = Math.min(20, (remRatio / 0.22) * 20);
      const effScore = (efficiencyPct / 100) * 10;
      score = Math.min(100, Math.round(durationScore + deepScore + remScore + effScore));
    }

    const sleepDetails = {
      core_hours: coreH,
      deep_hours: deepH,
      rem_hours: remH,
      awake_hours: awakeH,
      in_bed_hours: inBedH,
      efficiency_pct: efficiencyPct,
      score: score
    };

    result.push({
      date: day.date,
      steps,
      distance_km: Math.round(day.distance_km * 100) / 100,
      active_calories: activeCalories,
      resting_heart_rate: restingHr,
      latest_heart_rate: latestHr,
      min_heart_rate: day.min_heart_rate,
      max_heart_rate: day.max_heart_rate,
      hrv_ms: hrv,
      sleep_hours: totalSleep,
      sleep_details: sleepDetails,
      water_ml: Math.round(day.water_ml),
      weight_kg: day.weight_kg,
      workouts: day.workouts
    });
  }

  result.sort((a, b) => a.date.localeCompare(b.date));

  return {
    totalRecords,
    daysCount: result.length,
    dateRange: result.length ? { start: result[0].date, end: result[result.length - 1].date } : null,
    days: result
  };
}

export function streamZipExport(zipPath) {
  const child = spawn('/usr/bin/unzip', ['-p', zipPath, '*export.xml']);
  return child.stdout;
}

export function streamXmlExport(xmlPath) {
  return createReadStream(xmlPath, { encoding: 'utf8' });
}

export function saveParsedHealthRecords(db, days, source = 'apple_export') {
  try { db.exec('ALTER TABLE health_daily ADD COLUMN min_heart_rate REAL;'); } catch {}
  try { db.exec('ALTER TABLE health_daily ADD COLUMN max_heart_rate REAL;'); } catch {}

  const syncStamp = new Date().toISOString();
  const upsert = db.prepare(`
    INSERT INTO health_daily (
      date, steps, distance_km, active_calories,
      resting_heart_rate, latest_heart_rate, min_heart_rate, max_heart_rate, hrv_ms,
      sleep_hours, sleep_details, water_ml, weight_kg,
      workouts, last_synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      steps=excluded.steps,
      distance_km=excluded.distance_km,
      active_calories=excluded.active_calories,
      resting_heart_rate=COALESCE(excluded.resting_heart_rate, health_daily.resting_heart_rate),
      latest_heart_rate=COALESCE(excluded.latest_heart_rate, health_daily.latest_heart_rate),
      min_heart_rate=COALESCE(excluded.min_heart_rate, health_daily.min_heart_rate),
      max_heart_rate=COALESCE(excluded.max_heart_rate, health_daily.max_heart_rate),
      hrv_ms=COALESCE(excluded.hrv_ms, health_daily.hrv_ms),
      sleep_hours=excluded.sleep_hours,
      sleep_details=excluded.sleep_details,
      water_ml=excluded.water_ml,
      weight_kg=COALESCE(excluded.weight_kg, health_daily.weight_kg),
      workouts=excluded.workouts,
      last_synced_at=excluded.last_synced_at
  `);

  db.exec('BEGIN TRANSACTION;');
  try {
    for (const d of days) {
      upsert.run(
        d.date,
        d.steps,
        d.distance_km,
        d.active_calories,
        d.resting_heart_rate,
        d.latest_heart_rate,
        d.min_heart_rate || null,
        d.max_heart_rate || null,
        d.hrv_ms,
        d.sleep_hours,
        JSON.stringify(d.sleep_details || {}),
        d.water_ml,
        d.weight_kg,
        JSON.stringify(d.workouts || []),
        syncStamp
      );
    }
    db.prepare(`INSERT OR REPLACE INTO health_settings (key, value) VALUES ('sync_source', ?)`).run(source);
    db.prepare(`INSERT OR REPLACE INTO health_settings (key, value) VALUES ('last_export_sync', ?)`).run(syncStamp);
    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}
