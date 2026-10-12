import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInTree, lastJson } from './helpers/tree.mjs';

test('runner: 6 ticks never spam, text persists, blocked rows are closed', () => {
  const r = lastJson(runInTree('runner', [
    'proactive/proactiveRunner.js',
    'proactive/sendGuard.js',
    'proactive/boundary/boundaryIntelligence.js',
  ]));
  assert.ok(r.pushes.length <= 1, `expected at most 1 delivered push, got ${r.pushes.length}`);
  assert.equal(new Set(r.pushes).size, r.pushes.length, 'no duplicate texts delivered');
  assert.equal(r.savedMessages, r.pushes.length, 'every delivered push was saved with text: (not content:)');
  assert.equal(r.awaitingOnBlocked, 0, 'blocked events must not stay awaitingReply');
});

test('brain: per-user state isolation + no canned replies', () => {
  const r = lastJson(runInTree('brain', [
    'brain/brain.js',
    'brain/systemContext.js',
    'brain/systemPrompt.js',
    'brain/responseComposer.js',
    'brain/corePersona.js',
    'brain/friendBrainStore.js',
    'brain/workMode.js',
  ]));
  assert.equal(r.bob, 'null', "bob must not inherit alice's HELP phase");
  assert.equal(r.alice2, 'HELP', 'alice keeps her own phase');
  assert.equal(r.anon2, 'null', 'anonymous users never share state');
  assert.ok(r.greet.called, 'a greeting must go through the model (no hard-coded reply)');
  assert.equal(r.greet.content, 'MODEL_REPLY:salom');
  assert.equal(r.support.content, 'MODEL_REPLY:jonimga tegdi', 'nothing may be appended to a support reply');
  // Project → Work/Engineering mode
  assert.ok(r.work.hasBlock && r.work.hasGoal, 'work mode block carries the project name + goal');
  assert.ok(r.work.noFriendOverlay && r.work.keepsPersona, 'work mode drops the friend overlay but keeps the core persona');
  assert.equal(r.work.model, 'gpt-4.1', 'work mode uses the work model (even for a bare greeting)');
  assert.equal(r.work.timeout, 60000, 'work mode gets a long LLM timeout');
  assert.equal(r.work.friendHasBlock, false, 'the companion thread never gets the work block');
  assert.equal(r.work.friendTimeout, 18000, 'companion timeout unchanged');
});
