import { runBrain } from './brain/brain.js';
globalThis.__prompts = [];
const ask = async (userId, text) => {
  const before = globalThis.__prompts.length;
  const out = await runBrain({ userId, messages: [{ role: 'user', content: text }], prisma: {} });
  return { prompt: globalThis.__prompts.at(-1), called: globalThis.__prompts.length > before, content: out?.content };
};
const seen = (r) => (r.prompt.match(/PHASE_SEEN=(\S+)/) || [])[1];
await ask('alice', 'yordam kerak, kodni tuzat');            // phase HELP for alice
const bob    = seen(await ask('bob', 'qalaysan bugun'));      // different user, first message
const alice2 = seen(await ask('alice', 'yana gapir'));        // alice again
await ask('anonymous', 'yordam kerak, kod');
const anon2  = seen(await ask('anonymous', 'salom-aleyk gap'));
const greet  = await ask('carol', 'salom');                   // greeting must reach the model
const support = await ask('dave', 'jonimga tegdi');           // support turn: nothing may be appended
const askWork = async (userId, text) => {
  const out = await runBrain({ userId, messages: [{ role: 'user', content: text }], prisma: {}, workMode: { projectName: 'Shop API', description: 'Node + Postgres' } });
  return { prompt: globalThis.__prompts.at(-1), call: globalThis.__calls.at(-1), content: out?.content };
};
const workRes = await askWork('erin', 'salom');               // even a bare greeting gets the full work treatment
const friendRes = await ask('frank', 'qalaysan');
const work = {
  hasBlock: /WORK MODE ACTIVE — PROJECT: "Shop API"/.test(workRes.prompt),
  hasGoal: workRes.prompt.includes('Node + Postgres'),
  noFriendOverlay: !/FRIEND MODE POLICY/.test(workRes.prompt),
  keepsPersona: /CORE CHARACTER/.test(workRes.prompt),
  model: workRes.call.model, timeout: workRes.call.timeout,
  friendHasBlock: /WORK MODE ACTIVE/.test(friendRes.prompt),
  friendTimeout: globalThis.__calls.at(-1).timeout,
};
console.log('RESULT ' + JSON.stringify({ bob, alice2, anon2, greet, support, work }));
