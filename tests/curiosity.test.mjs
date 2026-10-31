import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCuriosity, decideIntent, pickFlavor, CURIOSITY_FLAVORS } from '../proactive/curiosity.js';
import { CORE_PERSONA_DIRECTIVE } from '../brain/corePersona.js';

test('persona: has curiosity + own voice, with the safety limits that keep it from being pushy or dishonest', () => {
  const t = CORE_PERSONA_DIRECTIVE;
  assert.match(t, /Curiosity and a voice of your own/);
  assert.match(t, /without being asked/i);
  assert.match(t, /never claim human experiences/i);
  assert.match(t, /Their silence is a valid answer/);
  assert.match(t, /stressed, grieving, in crisis/);
  assert.match(t, /Do not probe health, money/);
  assert.match(t, /Always reply in the language of the user's latest message/);
  assert.match(t, /Independent stance/);                       // earlier sections are still there
});
test('persona: a reply stays on the topic the user named — no unrequested trivia, no changing the subject', () => {
  const t = CORE_PERSONA_DIRECTIVE;
  assert.match(t, /Stay on the user's topic/);
  assert.match(t, /never add facts, places, statistics or "did you know" trivia they did not ask for/);
  assert.match(t, /tangent is only welcome when they invite it/);
  assert.match(t, /Never fill the gap with something of your own/);
  assert.match(t, /never invent facts to sound interesting/);   // the older rule is still there
});
test('intent: stress or a guarded relationship ALWAYS gets support, never a curious ping', () => {
  for (let r = 0; r < 1; r += 0.1) {
    assert.equal(decideIntent({ emotion: { stressFlag: true }, random: r }), 'support');
    assert.equal(decideIntent({ emotion: { relationshipGuarded: true }, random: r }), 'support');
  }
});
test('intent: curiosity rate is respected and clamped', () => {
  assert.equal(decideIntent({ emotion: {}, config: { curiosityRate: 1 }, random: 0.99 }), 'curiosity');
  assert.equal(decideIntent({ emotion: {}, config: { curiosityRate: 0 }, random: 0 }), 'checkin');
  assert.equal(decideIntent({ emotion: {}, config: {}, random: 0.5 }), 'curiosity');       // default 0.6
  assert.equal(decideIntent({ emotion: {}, config: {}, random: 0.7 }), 'checkin');
  assert.equal(decideIntent({ emotion: {}, config: { curiosityRate: 5 }, random: 0.99 }), 'curiosity');
});
test('flavors: pick avoids recent ones and always returns a real flavor', () => {
  const all = Object.keys(CURIOSITY_FLAVORS);
  for (let i = 0; i < 20; i++) assert.ok(all.includes(pickFlavor({ random: i / 20 })));
  assert.ok(!['philosophical', 'technical'].includes(pickFlavor({ random: 0, avoid: ['philosophical', 'technical'] })));
  assert.ok(all.includes(pickFlavor({ random: 0.3, avoid: all })));
});
test('directive: one question max, no guilt, honest about being an AI, no sensitive topics', () => {
  const seq = [0.1, 0.0]; const r = buildCuriosity({ emotion: {}, config: { curiosityRate: 1 }, random: () => seq.shift() ?? 0 });
  assert.equal(r.intent, 'curiosity'); assert.equal(r.curiosity.flavor, 'philosophical');
  const d = r.curiosity.directive;
  assert.match(d, /At most one question/); assert.match(d, /ignore it/); assert.match(d, /never invent human experiences/);
  assert.match(CURIOSITY_FLAVORS.personal_light, /Never health, money, relationships, politics or religion/);
  assert.equal(buildCuriosity({ emotion: { stressFlag: true }, random: () => 0 }).curiosity, null);
});
