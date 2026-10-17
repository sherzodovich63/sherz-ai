import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spacesDb } from './helpers/spacesDb.mjs';
import { cleanSkill, levelOf, scoreOf, rankSkills, teachSkill, updateSkill, deleteSkill, recordUse, recordDecision, thumbs, pickSkills, listSkills, MAX_BODY, toClient } from '../lib/skills.js';

const U = 'u1', S = 'sp1';
const taught = (db, name, extra = {}) => teachSkill(db, U, S, { name, summary: `how to ${name}`, body: '1. do it\n2. check it', ...extra });

test('cleanSkill: requires name/summary/steps, strips markers, caps triggers, rejects oversize body', () => {
  assert.throws(() => cleanSkill({ summary: 'x', body: 'abc' }), RangeError);
  assert.throws(() => cleanSkill({ name: 'x', body: 'abc' }), RangeError);
  assert.throws(() => cleanSkill({ name: 'x', summary: 'y', body: 'a'.repeat(MAX_BODY + 1) }), /too long/);
  const c = cleanSkill({ name: 'Rate <<<con>>>\nconfirm', summary: 's', body: 'abc', triggers: 'Rate, rate, load,,' + 'x,'.repeat(20) });
  assert.equal(c.name, 'Rate con confirm'); assert.ok(c.triggers.length <= 8); assert.equal(c.triggers[0], 'rate'); assert.equal(new Set(c.triggers).size, c.triggers.length);
});

test('levels are computed from evidence, never self-reported', () => {
  assert.equal(levelOf({}).level, 'learning');
  assert.equal(levelOf({ successes: 3 }).level, 'competent');
  assert.equal(levelOf({ successes: 8 }).level, 'proficient');
  assert.equal(levelOf({ successes: 15 }).level, 'expert');
  assert.equal(scoreOf({ successes: 10, rejections: 2, corrections: 1 }), 5);
  assert.equal(levelOf({ successes: 10, rejections: 2, corrections: 1 }).level, 'competent');
  assert.equal(levelOf({ successes: 3, rejections: 1, corrections: 0 }).accepted, 75);
  assert.equal(levelOf({}).accepted, null);
});

test('teach: unique name, auto triggers, cap, event log; update bumps version; delete removes events', async () => {
  const db = spacesDb();
  const a = await taught(db, 'Rate confirmation check');
  assert.equal(a.status, 'active'); assert.equal(a.source, 'taught'); assert.deepEqual(a.triggers.slice(0, 2), ['rate', 'confirmation']);
  await assert.rejects(() => taught(db, 'Rate confirmation check'), /already exists/);
  const b = await updateSkill(db, U, S, a.id, { body: '1. new steps' });
  assert.equal(b.version, 2); assert.equal(b.body, '1. new steps');
  assert.equal(await updateSkill(db, 'other', S, a.id, { body: 'xyz' }), null);                    // other user can't touch it
  await assert.rejects(() => updateSkill(db, U, S, a.id, {}), /nothing to update/);
  await assert.rejects(() => updateSkill(db, U, S, a.id, { status: 'bogus' }), RangeError);
  assert.equal(db.T.skillEvent.length >= 2, true);
  assert.equal(await deleteSkill(db, U, S, a.id), true);
  assert.equal(db.T.skill.length, 0); assert.equal(db.T.skillEvent.length, 0);
  for (let i = 0; i < 60; i++) await taught(db, 'skill number ' + i);
  await assert.rejects(() => taught(db, 'one too many'), /too many/);
});

test('ranking: triggers beat summary; proficiency breaks ties; drafts/archived never selected; index ≤15', async () => {
  const db = spacesDb();
  const a = await taught(db, 'Invoice follow up', { triggers: 'invoice, payment' });
  const b = await taught(db, 'Load tender', { summary: 'handle a tender; invoice later', triggers: 'tender' });
  await teachSkill(db, U, S, { name: 'Draft invoice idea', summary: 'invoice', body: 'abc', triggers: 'invoice' }, { status: 'draft' });
  const rows = await listSkills(db, U, S);
  const r = rankSkills(rows, 'please chase this invoice payment');
  assert.equal(r.top[0].id, a.id); assert.ok(r.top.every((s) => s.status === 'active'));
  assert.deepEqual(rankSkills(rows, 'something unrelated entirely').top, []);
  for (let i = 0; i < 20; i++) await taught(db, 'filler ' + i);
  const r2 = rankSkills(await listSkills(db, U, S), 'invoice');
  assert.ok(r2.index.length <= 15);
  const p = await pickSkills({ skill: { findMany: async () => { throw new Error('db down'); } } }, { userId: U, spaceId: S, message: 'x' });
  assert.deepEqual(p, { top: [], index: [] });                                                         // never breaks a turn
  assert.ok(b);
});

test('evidence: use recorded once per plan; approve/edit/reject credit once; unknown plan does nothing', async () => {
  const db = spacesDb();
  const a = await taught(db, 'Invoice follow up'), b = await taught(db, 'Rate check');
  assert.equal(await recordUse(db, { userId: U, skillIds: [a.id, a.id, b.id], ref: 'act1' }), 2);
  assert.equal(await recordUse(db, { userId: U, skillIds: [a.id], ref: 'act1' }), 0);                  // deduped
  assert.equal(await recordUse(db, { userId: U, skillIds: [a.id] }), 0);                               // no ref → nothing
  assert.equal(await recordDecision(db, { userId: U, actionId: 'act1', outcome: 'approved' }), 2);
  assert.equal(await recordDecision(db, { userId: U, actionId: 'act1', outcome: 'approved' }), 0);     // approve twice ≠ double credit
  assert.equal(await recordDecision(db, { userId: U, actionId: 'nope', outcome: 'approved' }), 0);
  assert.equal(await recordDecision(db, { userId: 'evil', actionId: 'act1', outcome: 'rejected' }), 0);// other users' events invisible
  assert.equal(await recordDecision(db, { userId: U, actionId: 'act1', outcome: 'weird' }), 0);
  await recordUse(db, { userId: U, skillIds: [a.id], ref: 'act2' }); await recordDecision(db, { userId: U, actionId: 'act2', outcome: 'rejected' });
  await recordUse(db, { userId: U, skillIds: [a.id], ref: 'act3' }); await recordDecision(db, { userId: U, actionId: 'act3', outcome: 'edited' });
  const c = toClient(db.T.skill.find((s) => s.id === a.id));
  assert.deepEqual([c.uses, c.successes, c.rejections, c.corrections], [3, 1, 1, 1]);
  assert.equal(c.accepted, 33); assert.equal(c.level, 'learning'); assert.ok(c.lastUsedAt);
});

test('thumbs: up credits, down debits; foreign space → null', async () => {
  const db = spacesDb(); const a = await taught(db, 'Rate check');
  assert.equal((await thumbs(db, U, S, a.id, 1)).successes, 1);
  assert.equal((await thumbs(db, U, S, a.id, -1)).rejections, 1);
  assert.equal(await thumbs(db, U, 'other-space', a.id, 1), null);
});
