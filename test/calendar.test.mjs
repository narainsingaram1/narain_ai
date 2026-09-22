import test from 'node:test';
import assert from 'node:assert/strict';
import { dayKey, visibleDays, shiftPeriod, eventOnDay, moveEventDates } from '../public/calendar.js';

test('month and week navigation use local calendar dates', () => {
  const september=visibleDays('2026-09-21','month');
  assert.equal(september[0],'2026-08-30');
  assert.equal(september.at(-1),'2026-10-03');
  assert.equal(visibleDays('2026-09-21','week')[0],'2026-09-20');
  assert.equal(shiftPeriod('2026-01-31','month',1),'2026-02-28');
  assert.equal(shiftPeriod('2026-09-21','week',-1),'2026-09-14');
});

test('events spanning midnight appear on both days, and moving preserves time and duration', () => {
  const start=new Date(2026,8,21,23,30);
  const end=new Date(2026,8,22,0,30);
  const event={starts_at:start.toISOString(),ends_at:end.toISOString()};
  assert.equal(eventOnDay(event,'2026-09-21'),true);
  assert.equal(eventOnDay(event,'2026-09-22'),true);
  assert.equal(eventOnDay(event,'2026-09-23'),false);
  const moved=moveEventDates(event,'2026-09-28');
  assert.equal(dayKey(moved.starts_at),'2026-09-28');
  assert.equal(new Date(moved.starts_at).getHours(),23);
  assert.equal(new Date(moved.ends_at)-new Date(moved.starts_at),3600000);
});
