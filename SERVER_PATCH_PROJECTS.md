# SERVER_PATCH_PROJECTS — Companion thread + Projects (Work mode)

Applies **on top of** `SERVER_PATCH_MENU.md` (multi-conversation backend). If you have not applied that one yet, skip step 3 and just
replace `server.js` with `server.projects.js` from this zip — it already contains both.

What changes on the server:
- Every user has exactly **one Companion thread** (created on demand; adopts old messages, proactive messages and any chats created by the previous Menu build; can't be renamed or deleted).
- **Projects** are conversations with `kind = "project"`, created by name (+ optional goal/stack).
- A turn inside a project runs in **Work/Engineering mode**: the friend-mode overlay is replaced by an engineering block (complete code, surgical SEARCH/REPLACE, root cause first, no invented APIs), the work model + a longer timeout + a longer context window are used. Persona (honesty/independent judgment), safety gate and long-term memory are unchanged.
- Env (optional): `SHERZ_WORK_MODEL` (default: `SHERZ_BRAIN_MODEL`, else `gpt-4.1`).

## Step 1 — Prisma (`prisma/schema.prisma`), then `npx prisma migrate dev -n projects` (or `npx prisma db push`)
Existing conversations get `kind = "companion"` and are folded into the one Companion thread automatically on first use (nothing is deleted, order is by message time).

**SEARCH**
```prisma
  title     String   @default("New chat")
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  messages  Message[]

  @@index([userId, updatedAt])
```
**REPLACE**
```prisma
  title     String   @default("New chat")
  // "companion" = the user's ONE personal thread; "project" = a focused workspace (Work mode)
  kind        String   @default("companion")
  description String?  // project goal / stack, fed to the model in Work mode
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  messages  Message[]

  @@index([userId, updatedAt])
  @@index([userId, kind])
```

## Step 2 — Files
- `lib/conversations.js` → **replace** with the one in this zip (companion/project model; exports `createProject`, `updateConversation`, `ensureCompanion`, `workModeFor`, …).
- `brain/workMode.js` → **new file**.
- `lib/chatHistory.js`, `lib/guestMerge.js` are unchanged from the Menu patch (guest merge: two companion threads are folded into one on the next list call).
- Tests: `tests/conversations.test.mjs`, `tests/integration.test.mjs`, `tests/fixtures/brain/run.mjs`, `tests/fixtures/brain/llm/openaiClient.js` (all 114 backend tests pass).

## Step 3 — `server.js` (SEARCH → REPLACE, in order; these are written against the Menu-patched server)

### 1) imports
**SEARCH**
```js
import { listConversations, createConversation, renameConversation, deleteConversation, resolveConversation, saveTurn, adoptLegacyMessages } from './lib/conversations.js'; // ✅ multi-conversation sidebar
```
**REPLACE**
```js
import { listConversations, createProject, updateConversation, deleteConversation, resolveConversation, ensureCompanion, workModeFor, saveTurn } from './lib/conversations.js'; // ✅ Companion thread + Projects
import { WORK_CONTEXT } from './brain/workMode.js'; // ✅ Project → Work/Engineering mode
```

### 2a) runBrainFlow: knows its conversation (companion or project)
**SEARCH**
```js
async function runBrainFlow(userId, clean, image, { onToken, expertMode = false, conversationId } = {}) {
```
**REPLACE**
```js
async function runBrainFlow(userId, clean, image, { onToken, expertMode = false, conversationId, conversation } = {}) {
```

### 2b) runBrainFlow: Work mode + per-conversation context
**SEARCH**
```js
    let history = [];
    try {
      history = await fetchContextForLLM(prisma, userId, { conversationId: (conversationId && conversationId !== 'new') ? conversationId : undefined });
```
**REPLACE**
```js
    // Which conversation is this? A Project turns on Work/Engineering mode (own, longer working memory);
    // the companion thread keeps the normal friend-mode brain.
    let conv = conversation || null;
    if (!conv) { try { conv = await resolveConversation(prisma, userId, conversationId); } catch (e) { /* non-fatal */ } }
    if (conv) conversationId = conv.id;
    const workMode = workModeFor(conv);

    let history = [];
    try {
      history = await fetchContextForLLM(prisma, userId, { conversationId: conv ? conv.id : undefined, ...(workMode ? WORK_CONTEXT : {}) });
```

### 2c) runBrainFlow: pass workMode to the brain
**SEARCH**
```js
      ? await runExpertTurn({ userId, messages, prisma, image: image ?? null, onToken })
      : await runBrain({ userId, messages, prisma, image: image ?? null, onToken });
```
**REPLACE**
```js
      ? await runExpertTurn({ userId, messages, prisma, image: image ?? null, onToken, workMode })
      : await runBrain({ userId, messages, prisma, image: image ?? null, onToken, workMode });
```

### 3) history route: fold orphan messages (proactive pings, old history) into the companion thread first
**SEARCH**
```js
    const page = await fetchPage(prisma, userId, {
```
**REPLACE**
```js
    await ensureCompanion(prisma, userId);
    const page = await fetchPage(prisma, userId, {
```

### 4a) list route: ensureCompanion now runs inside listConversations
**SEARCH**
```js
    await adoptLegacyMessages(prisma, userId);            // one-time: groups pre-existing chat into conversations

```
**REPLACE**
```js

```

### 4b) create route = create a PROJECT
**SEARCH**
```js
    return res.status(201).json({ ok: true, conversation: await createConversation(prisma, userId, req.body?.title) });
  } catch (e) {
```
**REPLACE**
```js
    const conversation = await createProject(prisma, userId, { title: req.body?.title, description: req.body?.description });
    return res.status(201).json({ ok: true, conversation });
  } catch (e) {
    if (e instanceof RangeError) return res.status(400).json({ ok: false, error: e.message });
```

### 4c) rename/edit route
**SEARCH**
```js
    const conversation = await renameConversation(prisma, userId, req.params.id, req.body?.title);
    if (!conversation) return res.status(404).json({ ok: false, error: 'not found' });
    return res.json({ ok: true, conversation });
  } catch (e) {
    if (e instanceof RangeError) return res.status(400).json({ ok: false, error: 'title required' });
```
**REPLACE**
```js
    const conversation = await updateConversation(prisma, userId, req.params.id, { title: req.body?.title, description: req.body?.description });
    if (!conversation) return res.status(404).json({ ok: false, error: 'not found' });
    return res.json({ ok: true, conversation });
  } catch (e) {
    if (e instanceof RangeError) return res.status(400).json({ ok: false, error: e.message });
```

### 4d) delete route: the companion thread is protected
**SEARCH**
```js
    return res.json({ ok: true });
  } catch (e) {
    console.error('/api/conversations delete error:', e);
```
**REPLACE**
```js
    return res.json({ ok: true });
  } catch (e) {
    if (e instanceof RangeError) return res.status(400).json({ ok: false, error: e.message });
    console.error('/api/conversations delete error:', e);
```

### 5a) /api/chat: keep the resolved conversation row
**SEARCH**
```js
    let said;
    let conversationId;
    if (!clean) {
```
**REPLACE**
```js
    let said;
    let conversationId;
    let conversation;
    if (!clean) {
```

### 5b) /api/chat: resolve
**SEARCH**
```js
      // 'new' → fresh conversation, an id → that one, omitted → latest (older clients)
      try { await ensureGuestUser(userId); conversationId = (await resolveConversation(prisma, userId, req.body?.conversationId)).id; }
```
**REPLACE**
```js
      // an owned id → that conversation (project or companion); omitted/unknown → the companion thread
      try { await ensureGuestUser(userId); conversation = await resolveConversation(prisma, userId, req.body?.conversationId); conversationId = conversation.id; }
```

### 5c) /api/chat: hand the row to the brain
**SEARCH**
```js
        said = (await runBrainFlow(userId, clean, req.body?.image, { conversationId })).said;
```
**REPLACE**
```js
        said = (await runBrainFlow(userId, clean, req.body?.image, { conversationId, conversation })).said;
```

### 6a) /api/chat-stream: resolve
**SEARCH**
```js
    // which conversation is this turn part of? ('new' → create, id → that one, omitted → latest)
    let conversationId;
    try { await ensureGuestUser(userId); conversationId = (await resolveConversation(prisma, userId, req.body?.conversationId)).id; }
```
**REPLACE**
```js
    // which conversation is this turn part of? (owned id → that one; omitted/unknown → the companion thread)
    let conversationId;
    let conversation;
    try { await ensureGuestUser(userId); conversation = await resolveConversation(prisma, userId, req.body?.conversationId); conversationId = conversation.id; }
```

### 6b) /api/chat-stream: Work mode gets the long ceiling too
**SEARCH**
```js
    const brainTimeoutMs = expertMode ? 90000 : 25000;
```
**REPLACE**
```js
    const brainTimeoutMs = (expertMode || workModeFor(conversation)) ? 90000 : 25000;
```

### 6c) /api/chat-stream: hand the row to the brain
**SEARCH**
```js
        expertMode,
        conversationId,
      }),
```
**REPLACE**
```js
        expertMode,
        conversationId,
        conversation,
      }),
```

## Step 4 — brain files

### `brain/systemContext.js`

**1. SEARCH**
```js
import { buildCorePersonaBlock } from './corePersona.js'; // ✅ Core persona directive (pushback + protective tact)
```
**REPLACE**
```js
import { buildCorePersonaBlock } from './corePersona.js'; // ✅ Core persona directive (pushback + protective tact)
import { composeSystemPrompt } from './workMode.js'; // ✅ Project → Work/Engineering mode
```

**2. SEARCH**
```js
  isTrivialGreeting = false,
  deps,
}) {
```
**REPLACE**
```js
  isTrivialGreeting = false,
  workMode = null,   // { projectName, description } when the user is inside a Project → Work/Engineering mode
  deps,
}) {
```

**3. SEARCH**
```js
  const systemPrompt =
    baseSystemPrompt +
    '\n\n' +
    buildCorePersonaBlock() +
    policyOverlay +
    '\n\n' +
    responseInstruction +
    (faza5MemoryBlock ? '\n\n' + faza5MemoryBlock : '');
```
**REPLACE**
```js
  // Work mode swaps the friend-mode overlay + per-turn response instruction (short, comforting answers) for
  // the engineering block; persona, safety and long-term memory are unchanged.
  const systemPrompt = composeSystemPrompt({
    base: baseSystemPrompt,
    persona: buildCorePersonaBlock(),
    policyOverlay,
    responseInstruction,
    memory: faza5MemoryBlock,
    workMode,
  });
```

### `brain/brain.js`

**1. SEARCH**
```js
import { buildFullSystemContext } from './systemContext.js';
```
**REPLACE**
```js
import { buildFullSystemContext } from './systemContext.js';
import { workModelName, WORK_TIMEOUT_MS } from './workMode.js'; // ✅ Project → Work/Engineering mode
```

**2. SEARCH**
```js
export async function runBrain({ userId, messages, prisma, image, maxToolHops = 3, onToken }) {
```
**REPLACE**
```js
export async function runBrain({ userId, messages, prisma, image, maxToolHops = 3, onToken, workMode = null }) {
```

**3. SEARCH**
```js
  const isTrivialGreeting =
    trimmedUserText.length > 0 &&
```
**REPLACE**
```js
  const isTrivialGreeting =
    !workMode &&   // inside a Project every turn gets the full context + the work model
    trimmedUserText.length > 0 &&
```

**4. SEARCH**
```js
    isTrivialGreeting,
    deps: {
```
**REPLACE**
```js
    isTrivialGreeting,
    workMode,
    deps: {
```

**5. SEARCH**
```js
  const selectedModel = isTrivialGreeting
    ? (process.env.SHERZ_FAST_MODEL || 'gpt-4o-mini')
    : (process.env.SHERZ_BRAIN_MODEL || 'gpt-4.1-mini');
```
**REPLACE**
```js
  const selectedModel = workMode
    ? workModelName()
    : isTrivialGreeting
      ? (process.env.SHERZ_FAST_MODEL || 'gpt-4o-mini')
      : (process.env.SHERZ_BRAIN_MODEL || 'gpt-4.1-mini');
  const llmTimeoutMs = workMode ? WORK_TIMEOUT_MS : 18000; // engineering answers are long
```

**6. SEARCH**
```js
          timeout: 18000,
          maxRetries: 1,
        }
      );

      for await
```
**REPLACE**
```js
          timeout: llmTimeoutMs,
          maxRetries: 1,
        }
      );

      for await
```

**7. SEARCH**
```js
          timeout: 18000,
          maxRetries: 1,
        }
      );

      const choice
```
**REPLACE**
```js
          timeout: llmTimeoutMs,
          maxRetries: 1,
        }
      );

      const choice
```

**8. SEARCH**
```js
    if (ctx?.mode === 'INQUIRE' || ctx?.mode === 'LISTEN') {
```
**REPLACE**
```js
    if (!workMode && (ctx?.mode === 'INQUIRE' || ctx?.mode === 'LISTEN')) {
```

### `brain/expertTurn.js`

**1. SEARCH**
```js
export async function runExpertTurn({ userId, messages, prisma, image, onToken, maxToolHops = 5 }) {
```
**REPLACE**
```js
export async function runExpertTurn({ userId, messages, prisma, image, onToken, maxToolHops = 5, workMode = null }) {
```

**2. SEARCH**
```js
    isTrivialGreeting: false,
    deps: {
```
**REPLACE**
```js
    isTrivialGreeting: false,
    workMode,
    deps: {
```
