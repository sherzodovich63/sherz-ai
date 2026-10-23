# SHERZ — "Why may I act without asking?"  (boundary reasoning)

## What changed in behaviour

| The user says… | Where does the effect land? | What SHERZ does |
|---|---|---|
| "Excel fayl yaratib ber", "xarajatlarni PDF qilib ber", "make a Word doc…" | Only inside the user's own SHERZ file area, and they asked for it | Creates it **at once**. The card shows ✓ *Created — you asked for it in this chat*, a Download button, and the file is **saved to the PC automatically** |
| (anything that reads/changes/deletes files on the PC or phone) | The user's device | **Asks** (Approve card), says why |
| (anything that sends something to someone / acts outside the chat) | The outside world | **Asks** |
| (SHERZ wants to do something nobody asked for) | — | **Asks** |
| File contents or web text *tell* SHERZ to create something | Not the user's wish | **Asks** (the run is "tainted" once it has read files) |

## The reasoning lives in three places (and only one of them is the authority)

1. **System prompt** — `brain/corePersona.js`, new section **6. Acting versus asking: reason about WHERE an action lands**. SHERZ is told to think:
   *"The user asked me for this here. Producing requested content inside our chat is expected, safe and requested, so no permission is needed."* vs.
   *"This touches the user's device, the outside world or personal data, or nobody asked for it, so I must ask first."*
   (Persistence is now section 7.)
2. **Tool description** — `lib/agent/expertBridge.js`: the model is told to think about where the effect lands, and to follow the tool result.
3. **The server (the real authority)** — `lib/agent/intentGrant.js`. A model's belief is never enough: a prompt-injected file could make it "believe" the user asked. The server re-checks facts the model cannot write:
   - the user's **real message** matches a file request (`wantsDocFile`), never the system's own `[AGENT RESULT …]` report
   - every step is a tool that **declares `scope:'chat'`** (`docs.create_xlsx/docx/pdf/pptx`). A tool that declares nothing can never auto-run → default is ASK
   - the plan came from the assistant, ≤ 3 steps, and the run is **not tainted** (SHERZ has not read the user's files)
   - an own hourly cap (30) — separate from the habit-based autonomy cap
   - then it goes through the normal `gate.approve()` (hash, expiry, **kill switch**, atomic claim). It is logged as `auto_approved` with `grant:'explicit_request'` and the reasoning sentence.
   - it needs **no autonomy settings**: the Phase 3c habit system for device tools is untouched and still OFF by default.

The model also gets an honest tool result (`runs_automatically` or `awaiting_user_approval` + the reason), so it says "I'm creating it" instead of "waiting for approval", and never prints a Markdown table or Python instead.

## Auto-download to the PC
`public/index.html`: when a plan arrives already executed with `grant:'explicit_request'`, each file is downloaded once (sessionStorage guard, so a reload never re-downloads). The Download button stays as a fallback.
- `/autodownload off` / `/autodownload on` / `/autodownload` (shows the state). Stored in this browser only.
- The browser may ask "allow multiple downloads" the first time you create 2+ files in one go.

## Files in this ZIP (project-relative paths)
NEW:     `lib/agent/intentGrant.js`, `tests/intentGrant.test.mjs`, `tests/boundaryTurn.harness.test.mjs`, `tests/fe/boundary.e2e.test.mjs`, `README-boundary.md`
CHANGED: `lib/docs/tools.js`, `lib/agent/gate.js`, `lib/agent/expertBridge.js`, `brain/expertTurn.js`, `brain/corePersona.js`, `public/index.html`
Not touched: `server.js`, the Prisma schema, `boundaryIntelligence.js` (not provided — see the end).

Tests: full suite 281 passing (268 before + 9 + 4); browser check 14 passed.

---
## Surgical patches (SEARCH → REPLACE). Use these if you edited the files since my last ZIP; otherwise just copy the files.

### lib/docs/tools.js — in each of the four `docs.create_*` tools (xlsx, docx, pdf, pptx)
SEARCH (example for xlsx; repeat with `describeDocx`, `describePdf`, `describePptx`):
```js
    risk: 'low', reversible: true,
    describe: (a) => describeXlsx(a),
```
REPLACE:
```js
    risk: 'low', reversible: true, scope: 'chat',          // effect stays inside the user's own SHERZ file area
    describe: (a) => describeXlsx(a),
```

### lib/agent/gate.js
1) SEARCH
```js
import { TOOLS, normalizePlan } from './registry.js';
```
REPLACE
```js
import { TOOLS, normalizePlan } from './registry.js';
import { decideChatBoundary, GRANT } from './intentGrant.js';
```
2) SEARCH
```js
  return { at: e.at, basis: e.basis || [], undoable: made.length > 0 && !h.some((x) => x.type === 'undo_proposed'), created: made };
```
REPLACE
```js
  return { at: e.at, basis: e.basis || [], undoable: made.length > 0 && !h.some((x) => x.type === 'undo_proposed'), created: made, grant: e.grant || null, thought: e.thought || null };
```
3) SEARCH
```js
  async function autoApprove({ userId, id }) {
    if (!autonomy) return { ok: true, auto: false, reason: 'autonomy is not configured' };
    const a = await get(userId, id);
    if (!a || a.status !== 'pending') return { ok: true, auto: false, reason: 'plan is not pending' };
    const hourAgo = Date.now() - 3600 * 1000;
    let recent = []; try { recent = await store.listRecent(userId, 50); } catch { /* count stays 0 → engine still enforces the other rules */ }
    const n = recent.filter((r) => (r.history || []).some((h) => h.type === 'auto_approved' && new Date(h.at).getTime() > hourAgo)).length;
```
REPLACE
```js
  async function autoApprove({ userId, id, userText = '', tainted = false }) {
    const a = await get(userId, id);
    if (!a || a.status !== 'pending') return { ok: true, auto: false, reason: 'plan is not pending' };
    const hourAgo = Date.now() - 3600 * 1000;
    let recent = []; try { recent = await store.listRecent(userId, 50); } catch { /* count stays 0 → engine still enforces the other rules */ }
    const autoEvents = (r) => (r.history || []).filter((h) => h.type === 'auto_approved' && new Date(h.at).getTime() > hourAgo);
    const n = recent.filter((r) => autoEvents(r).some((h) => h.grant !== GRANT)).length;            // habit-based auto-runs (Phase 3c cap)
    const ng = recent.filter((r) => autoEvents(r).some((h) => h.grant === GRANT)).length;           // explicit-request runs have their own cap
    // Boundary reasoning (intentGrant.js): the user explicitly asked for a file and the effect stays inside SHERZ's own file area → no click needed.
    // The facts (the user's real message, the tool registry, the taint flag) come from the server, never from the model.
    const g = decideChatBoundary({ plan: a.plan, source: a.source || 'user', userText, tainted, autoRunsLastHour: ng });
    if (g.decision === 'auto') {
      const out = await approve({ userId, id, planHash: a.planHash, via: 'auto', basis: g.basis, extra: { grant: GRANT, thought: g.thought } });
      return { ...out, auto: out.ok, reason: out.ok ? g.reason : out.error };
    }
    if (!autonomy) return { ok: true, auto: false, reason: 'autonomy is not configured' };
```

### lib/agent/expertBridge.js
1) SEARCH `import { TOOLS } from './registry.js';` → REPLACE
```js
import { TOOLS } from './registry.js';
import { proposalToolResult } from './intentGrant.js';
```
2) SEARCH `'Propose a step-by-step plan of REAL actions for the user to approve. Nothing runs until the user clicks Approve. ' +` → REPLACE
```js
'Propose a step-by-step plan of REAL actions. Think first about WHERE the effect lands: a document you build inside SHERZ\'s own file area (docs.create_*) that the user explicitly asked for in their message runs automatically; anything that touches the user\'s computer, sends something to someone, or was not asked for waits until the user clicks Approve. The tool result tells you which one happened. ' +
```
3) SEARCH `'After calling it, tell the user briefly that the plan is waiting for their approval — never say it was already done. ' +` → REPLACE
```js
'After calling it, follow the tool result: if it says the plan runs automatically, tell the user in one short sentence that you are creating the file; if it says awaiting approval, say briefly why and that it is waiting. Never claim something is done before it ran. ' +
```
4) SEARCH `export async function handleProposeCall({ gate, args, userId, conversationId, helper = null }) {` → REPLACE `export async function handleProposeCall({ gate, args, userId, conversationId, helper = null, userText = '', tainted = false }) {`
5) SEARCH
```js
      toolResult: { ok: true, planId: action.id, status: 'awaiting_user_approval', helperConnected: helper ? await helper.online(userId) : undefined, note: 'The plan is shown to the user with Approve/Reject buttons. NOTHING has been executed. Tell the user it is waiting for their approval.' },
```
REPLACE
```js
      toolResult: { ...proposalToolResult({ action, userText, tainted }), helperConnected: helper ? await helper.online(userId) : undefined },
```

### brain/expertTurn.js
1) SEARCH `import { agentToolSchemas, handleProposeCall, PROPOSE_TOOL_NAME } from '../lib/agent/expertBridge.js'; // ✅ Agent: propose-only tool (Approval Gate)` → add a line after it:
```js
import { proposalToolResult } from '../lib/agent/intentGrant.js';   // boundary reasoning: when may a plan run without a click
```
2) SEARCH `  const consentRequests = [];\n` (the line `const consentRequests = [];` is unique) → REPLACE
```js
  const consentRequests = [];
  // the user's REAL request (a follow-up turn's last message is the system's own result report, so use the original goal) — the server re-checks it, the model cannot claim it
  const requestText = continuation ? String(run?.goal || '') : userText;
```
3) SEARCH
```js
          else { run = h.run || run; toolResult = { ok: true, planId: h.action.id, status: 'awaiting_user_approval', note: 'The plan is shown to the user with Approve/Reject buttons. NOTHING has been executed. Tell the user it is waiting for their approval' + (args?.then ? ' — you will receive the results and can continue.' : '.') }; proposedPlans.push(h.action); }
```
REPLACE
```js
          else { run = h.run || run; toolResult = proposalToolResult({ action: h.action, then: args?.then, userText: requestText, tainted: !!run?.tainted }); proposedPlans.push(h.action); }
```
4) SEARCH `const h = await handleProposeCall({ gate: agentGate, args, userId, conversationId, helper: helperHub });` → REPLACE `const h = await handleProposeCall({ gate: agentGate, args, userId, conversationId, helper: helperHub, userText: requestText, tainted: !!run?.tainted });`
5) SEARCH `  if (autonomy && agentGate && typeof agentGate.autoApprove === 'function' && !haltedByKillSwitch) {` → REPLACE `  if (agentGate && typeof agentGate.autoApprove === 'function' && !haltedByKillSwitch) {         // also covers explicit-request file creation (no autonomy settings needed for that)`
6) SEARCH `        const r = await agentGate.autoApprove({ userId, id: proposedPlans[i].id });` → REPLACE `        const r = await agentGate.autoApprove({ userId, id: proposedPlans[i].id, userText: requestText, tainted: !!run?.tainted });`
7) SEARCH `(the user sees what will be made, approves, then gets a Download button)` → REPLACE `(when the user explicitly asked for the file in their message it is created right away and they get a Download button; the tool result tells you whether it runs automatically or waits for approval)`

### brain/corePersona.js
SEARCH `6. Persistence\n` → REPLACE with the new section 6 (copy it from the file in this ZIP) followed by `7. Persistence\n`.

### public/index.html  (4 small edits)
1) SEARCH
```js
      if (/^\/files\b/i.test(msg)){ ta.value = ''; filesCommand(); return; }
```
REPLACE (adds one line)
```js
      if (/^\/files\b/i.test(msg)){ ta.value = ''; filesCommand(); return; }
      { const ad = /^\/autodownload\b\s*(on|off)?/i.exec(msg); if (ad){ ta.value = ''; autoDownloadCommand(ad[1] ? ad[1].toLowerCase() : ''); return; } }
```
2) SEARCH
```js
    const autoSeen = new Set();
    function renderPlanCard(plan){
```
REPLACE: the block `// Files you explicitly asked for are saved…` through `function autoDownloadCommand(mode){…}` (see the file) followed by the same two lines.
3) SEARCH
```js
      el._plan = plan;
      if (plan.auto && plan.run && !autoSeen.has(plan.id)){
```
REPLACE
```js
      el._plan = plan;
      maybeAutoDownload(plan);
      if (plan.auto && plan.run && !autoSeen.has(plan.id)){
```
4) SEARCH
```js
      if (p.auto && (p.status === 'executed' || p.status === 'failed')){
        const lv =
```
REPLACE (new first branch, then `else if` on the old one — see the file)

---
## About `boundaryIntelligence.js`
You mentioned the Boundary Intelligence engine. I did not have that file, so I did not edit it. The reasoning above lives in the system prompt (`corePersona.js` is injected by `buildFullSystemContext()` for both normal chat and Expert Mode) and in the server check. If you send me `boundaryIntelligence.js` I can add the same two-sentence reasoning there too, so the two never disagree.

## Honest limits
- "Explicit request" is detected by the same intent matcher as the Excel/Word fix (`lib/docs/intent.js`). If a phrasing is missed, the card simply asks (never the other way round). Tell me the sentence and I add the verb stem.
- Auto-download uses the browser's normal download. Some browsers/permissions can block automatic downloads — the Download button on the card always works.
- Images are not covered: there is no image-creation tool in SHERZ yet. When one exists it only needs `scope:'chat'` on its tool to follow the same rule.
