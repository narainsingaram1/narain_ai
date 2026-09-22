import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWhen, heuristicDrafts, matchEntity, normalizeName, splitIntents, zonedStamp } from '../parse.mjs';

const timeZone='America/New_York';
const now=new Date('2026-09-22T14:00:00Z'); // Tuesday 10:00 in New York
const workspace={
  classes:[{id:'class-cs3600',name:'CS 3600'},{id:'class-phil',name:'PHIL 1100'}],
  areas:[{id:'area-academics',name:'Academics'},{id:'area-health',name:'Health'}],
  now,
  timeZone
};

test('relative phrases resolve to one unambiguous instant', () => {
  assert.equal(parseWhen('friday',{now,timeZone}).iso,'2026-09-25T09:00:00-04:00');
  assert.equal(parseWhen('tomorrow at 5pm',{now,timeZone}).iso,'2026-09-23T17:00:00-04:00');
  assert.equal(parseWhen('next week',{now,timeZone}).iso,'2026-09-28T09:00:00-04:00');
  assert.equal(parseWhen('in 3 days',{now,timeZone}).iso,'2026-09-25T09:00:00-04:00');
  assert.equal(parseWhen('sep 30',{now,timeZone}).iso,'2026-09-30T09:00:00-04:00');
  assert.equal(parseWhen('9/25',{now,timeZone}).iso,'2026-09-25T09:00:00-04:00');
  assert.equal(parseWhen('eod',{now,timeZone}).iso,'2026-09-22T17:00:00-04:00');
  assert.equal(parseWhen('this weekend',{now,timeZone}).iso,'2026-09-26T09:00:00-04:00');
});

test('a date without a stated time is marked as assumed, not invented', () => {
  assert.equal(parseWhen('friday',{now,timeZone}).timeKnown,false);
  assert.equal(parseWhen('friday at 5pm',{now,timeZone}).timeKnown,true);
  assert.equal(parseWhen('sep 25 at 5 PM',{now,timeZone}).iso,'2026-09-25T17:00:00-04:00');
});

test('vague timing asks for a date instead of guessing one', () => {
  for (const phrase of ['soon','asap','sometime','later']) {
    const parsed=parseWhen(phrase,{now,timeZone});
    assert.equal(parsed.matched,true,phrase);
    assert.equal(parsed.vague,true,phrase);
    assert.equal(parsed.iso,null,phrase);
  }
  assert.equal(parseWhen('read the syllabus',{now,timeZone}).matched,false);
});

test('classes and areas match how people actually type them', () => {
  assert.equal(matchEntity('cs3600 midterm',workspace.classes).match.id,'class-cs3600');
  assert.equal(matchEntity('due in CS 3600',workspace.classes).match.id,'class-cs3600');
  assert.equal(matchEntity('cs3600 midterm',workspace.classes).match.name,'CS 3600');
  assert.equal(matchEntity('phil1100 reading',workspace.classes).match.id,'class-phil');
  assert.equal(matchEntity('buy groceries',workspace.classes).match,null);
});

test('a rough sentence becomes a linked draft, and vagueness stays visible', () => {
  const [draft]=heuristicDrafts('create a task in cs 3600 that we have a midterm soon',workspace);
  assert.equal(draft.type,'task');
  assert.equal(draft.title,'Midterm');
  assert.equal(draft.class_id,'class-cs3600');
  assert.equal(draft.class_name,'CS 3600');
  assert.equal(draft.area_id,'area-academics');
  assert.equal(draft.due_at,null);
  assert.equal(draft.when_phrase,'soon');
  assert.deepEqual(draft.needs,['date']);
});

test('a dated request keeps its date and drops the phrasing from the title', () => {
  const [draft]=heuristicDrafts('remind me to submit the problem set friday at 5pm',workspace);
  assert.equal(draft.type,'task');
  assert.equal(draft.title,'Submit the problem set');
  assert.equal(draft.due_at,'2026-09-25T17:00:00-04:00');
  assert.deepEqual(draft.needs,[]);
});

test('events, notes, priorities and multiple intents are recognised', () => {
  const [meeting]=heuristicDrafts('add a meeting with the advisor tomorrow at 2pm',workspace);
  assert.equal(meeting.type,'event');
  assert.equal(meeting.starts_at,'2026-09-23T14:00:00-04:00');
  assert.equal(meeting.due_at,null);

  const [idea]=heuristicDrafts('note: idea for the final project',workspace);
  assert.equal(idea.type,'note');
  assert.equal(idea.due_at,null);

  const [urgent]=heuristicDrafts('urgent: pay the tuition bill',workspace);
  assert.equal(urgent.priority,'high');

  const many=heuristicDrafts('midterm in cs 3600 friday; also email the professor',workspace);
  assert.equal(many.length,2);
  assert.equal(many[0].class_id,'class-cs3600');
  assert.equal(many[1].title,'Email the professor');
});

test('splitIntents keeps ordinary sentences in one piece', () => {
  assert.deepEqual(splitIntents('research and write the essay'),['research and write the essay']);
  assert.equal(splitIntents('call mom; buy milk').length,2);
});

test('normalised names ignore punctuation, spacing and case', () => {
  assert.equal(normalizeName('CS-3600'),'cs3600');
  assert.equal(normalizeName('cs 3600'),'cs3600');
});

test('zoned stamps carry the exact offset for the workspace time zone', () => {
  assert.equal(zonedStamp('America/New_York',{year:2026,month:9,day:25,hour:18,minute:0,second:0}),'2026-09-25T18:00:00-04:00');
  assert.equal(zonedStamp('America/New_York',{year:2026,month:1,day:25,hour:18,minute:0,second:0}),'2026-01-25T18:00:00-05:00');
});
