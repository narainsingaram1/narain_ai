import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initAgenticSchema, listProfileFacts, upsertProfileFact, deleteProfileFact, createMission, listMissions, stageExternalAction, decideExternalAction, handoffExternalAction, markExternalActionExecuted } from '../agentic.mjs';

test('profile facts, missions, and external actions enforce the approval lifecycle', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  initAgenticSchema(db);

  const publicFact = upsertProfileFact(db, { key: 'Graduation', value: 'May 2028' });
  upsertProfileFact(db, { key: 'Government ID', value: 'never-send-this', sensitivity: 'sensitive' });
  assert.deepEqual(listProfileFacts(db).map(item => item.fact_key), ['Graduation']);
  assert.equal(listProfileFacts(db, { includeSensitive: true }).length, 2);

  const mission = createMission(db, { title: 'Professor outreach', objective: 'Find aligned labs and draft truthful emails.' });
  assert.equal(listMissions(db)[0].id, mission.id);

  const action = stageExternalAction(db, {
    mission_id: mission.id,
    kind: 'email',
    recipient_name: 'Professor Example',
    recipient_address: 'prof@example.edu',
    subject: 'Research interest',
    body: 'A grounded draft.',
    rationale: 'Their lab page matches the stated interest.',
    evidence: [{ title: 'Lab page', url: 'https://example.edu/lab', snippet: 'Research summary' }]
  });
  assert.equal(action.status, 'pending_approval');
  assert.throws(() => handoffExternalAction(db, action.id), /Approve this action/);
  const approved = decideExternalAction(db, action.id, 'approve');
  assert.equal(approved.status, 'approved');
  assert.throws(() => decideExternalAction(db, action.id, 'approve'), /Only pending actions/);
  const handoff = handoffExternalAction(db, action.id);
  assert.match(handoff.handoff_url, /^mailto:/);
  assert.equal(handoff.action.status, 'handed_off');
  assert.equal(markExternalActionExecuted(db, action.id).status, 'executed');

  assert.throws(() => stageExternalAction(db, { kind: 'linkedin_message', target_url: 'http://localhost/profile', body: 'Nope', rationale: 'Nope' }), /HTTPS/);
  deleteProfileFact(db, publicFact.id);
  assert.equal(listProfileFacts(db).length, 0);
  db.close();
});
