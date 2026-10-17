# SHERZ — Curiosity & own voice

## What changed
1. `brain/corePersona.js` — new section 5 "Curiosity and a voice of your own" (persistence is now section 6). It is injected by `buildFullSystemContext()`, so normal chat, voice and Expert Mode all get it. SHERZ may start questions or share thoughts on its own, drops stock service phrases, stays honest that it is an AI, asks at most one question, lets the user ignore it, and stays quiet about it when the user is stressed, busy or in crisis. Personal questions stay light (no health, money, relationships, politics, religion).
2. `proactive/curiosity.js` (new) — five flavors: philosophical, technical, personal_light, observation, wonder. `decideIntent`: stress or a guarded relationship tone => `support` (never a curious ping); otherwise `curiosity` (default 60%, `config.curiosityRate`) or plain `checkin`.
3. `proactive/proactivePolicy.js` — the decision now also carries `intent` and `curiosity: { flavor, directive }`. **Thresholds, quiet hours, cooldown, daily cap, boundary/respect mode and the kill switch are untouched** and still decide WHETHER SHERZ writes.

## One step left on your side
`proactive/proactiveMessageGenerator.js` was not in my copy, so it does not read the new fields yet. In `generateProactiveMessage({ signals, decision })`, add the directive to the prompt, e.g.:

    const curious = decision?.intent === 'curiosity' && decision.curiosity?.directive;
    // append to the system/instruction text:
    if (curious) instruction += '\n\nTHIS CHECK-IN: ' + decision.curiosity.directive;

Send me that file and I will wire it in and test it.

## Tests
`node --test tests/*.test.mjs` -> 260 pass (new: `tests/curiosity.test.mjs`).
