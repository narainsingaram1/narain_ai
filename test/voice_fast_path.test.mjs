import test from 'node:test';
import assert from 'node:assert/strict';
import { extractDirectIntent, heuristicDraft } from '../parse.mjs';

test('voice fast-path extracts spoken reminder with class, time, and priority', () => {
  const context = {
    classes: [{ id: 'lmc-id', name: 'LMC 3403' }, { id: 'cs-id', name: 'CS 3600' }],
    areas: [{ id: 'acad-id', name: 'Academics' }, { id: 'car-id', name: 'Career' }],
    timeZone: 'America/New_York',
    now: new Date('2026-09-22T12:00:00-04:00') // Tuesday noon
  };

  const spoken = 'Add a reminder to submit LMC 3403 proposal by Thursday 5pm high priority';
  const direct = extractDirectIntent(spoken, context);

  assert.ok(direct, 'Voice command should trigger direct intent');
  assert.equal(direct.intent, 'create');
  assert.equal(direct.draft.type, 'task');
  assert.equal(direct.draft.title, 'Submit proposal');
  assert.equal(direct.draft.priority, 'high');
  assert.equal(direct.draft.class_id, 'lmc-id');
  assert.equal(direct.draft.class_name, 'LMC 3403');
  assert.equal(direct.draft.area_id, 'acad-id');
  assert.equal(direct.draft.area_name, 'Academics');
  assert.ok(direct.draft.due_at.includes('T17:00:00'));
});

test('voice fast-path handles conversational voice add variations', () => {
  const context = {
    classes: [{ id: 'cs-id', name: 'CS 2110' }],
    areas: [{ id: 'acad-id', name: 'Academics' }, { id: 'health-id', name: 'Health' }],
    timeZone: 'America/New_York',
    now: new Date('2026-09-22T12:00:00-04:00')
  };

  const spoken1 = 'Remind me to go to the gym tomorrow morning';
  const direct1 = extractDirectIntent(spoken1, context);
  assert.ok(direct1);
  assert.equal(direct1.draft.title, 'Go to the gym');
  assert.equal(direct1.draft.area_name, 'Health');

  const spoken2 = 'Schedule meeting with advisor next Tuesday at 10am';
  const direct2 = extractDirectIntent(spoken2, context);
  assert.ok(direct2);
  assert.equal(direct2.draft.type, 'event');
  assert.ok(direct2.draft.starts_at.includes('T10:00:00'));
});
