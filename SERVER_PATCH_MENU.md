# SERVER_PATCH_MENU — multi-conversation backend for the new Menu

## Step 1 — Prisma
In `prisma/schema.prisma` add `conversations Conversation[]` to `User`, and update `Message` + add `Conversation` exactly as in the shipped `prisma/schema.prisma`:

```prisma
model Message {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  role      String // "user" | "assistant" | "system"
  text      String
  createdAt DateTime @default(now())

  // null = written before conversations existed (adopted lazily by lib/conversations.js)
  conversationId String?
  conversation   Conversation? @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([userId, createdAt])
  @@index([conversationId, createdAt])
}

model Conversation {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  title     String   @default("New chat")
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  messages  Message[]

  @@index([userId, updatedAt])
}
```

Then run `npx prisma migrate dev -n conversations` (or `npx prisma db push`). Old messages keep `conversationId = null` and are adopted lazily.

## Step 2 — New/changed files
Copy `lib/conversations.js` (new), `lib/chatHistory.js`, `lib/guestMerge.js`, `tests/conversations.test.mjs` from the zip.

## Step 3 — server.js edits (SEARCH → REPLACE, apply in order)

### 1) import
**SEARCH**
```js
import { fetchPage, fetchContextForLLM } from './lib/chatHistory.js';
```
**REPLACE**
```js
import { fetchPage, fetchContextForLLM } from './lib/chatHistory.js';
import { listConversations, createConversation, renameConversation, deleteConversation, resolveConversation, saveTurn, adoptLegacyMessages } from './lib/conversations.js'; // ✅ multi-conversation sidebar
```

### 2) persistSkillTurn saves into a conversation
**SEARCH**
```js
async function persistSkillTurn(userId, userText, aiText) {
  try {
    await ensureGuestUser(userId);
    await prisma.message.create({ data: { userId, role: 'user',      text: userText } });
    await prisma.message.create({ data: { userId, role: 'assistant', text: aiText  } });
```
**REPLACE**
```js
async function persistSkillTurn(userId, userText, aiText, conversationId) {
  try {
    await ensureGuestUser(userId);
    await saveTurn(prisma, { userId, conversationId, userText, aiText });
```

### 3a) runBrainFlow takes a conversationId
**SEARCH**
```js
async function runBrainFlow(userId, clean, image, { onToken, expertMode = false } = {}) {
```
**REPLACE**
```js
async function runBrainFlow(userId, clean, image, { onToken, expertMode = false, conversationId } = {}) {
```

### 3b) LLM context = this conversation only
**SEARCH**
```js
      history = await fetchContextForLLM(prisma, userId);
```
**REPLACE**
```js
      history = await fetchContextForLLM(prisma, userId, { conversationId: (conversationId && conversationId !== 'new') ? conversationId : undefined });
```

### 3c) brain turn saved into the conversation
**SEARCH**
```js
      await prisma.message.create({ data: { userId, role: 'user',      text: clean } });
      await prisma.message.create({ data: { userId, role: 'assistant', text: said  } });
```
**REPLACE**
```js
      await saveTurn(prisma, { userId, conversationId, userText: clean, aiText: said });
```

### 4) history route can read one conversation
**SEARCH**
```js
    const page = await fetchPage(prisma, userId, {
      before: req.query?.before,
      limit:  req.query?.limit,
    });
```
**REPLACE**
```js
    const page = await fetchPage(prisma, userId, {
      before: req.query?.before,
      limit:  req.query?.limit,
      conversationId: req.query?.conversationId || undefined,   // omit = whole history (legacy)
    });
```

### 5) new routes (insert before /api/chat)
**SEARCH**
```js
app.post('/api/chat', async (req, res) => {
```
**REPLACE**
```js
// ── Conversations (sidebar): list / search / create / rename / delete ──
// Identity: verified token; outside production the ?userId= / body userId fallback matches the other routes.
const convUser = (req) => req.user?.id || (!isProd ? (req.query?.userId || req.body?.userId || 'u1') : null);

app.get('/api/conversations', async (req, res) => {
  try {
    const userId = convUser(req);
    if (!userId) return res.status(401).json({ ok: false, error: 'login required' });
    await ensureGuestUser(userId);
    await adoptLegacyMessages(prisma, userId);            // one-time: groups pre-existing chat into conversations
    const conversations = await listConversations(prisma, userId, { q: req.query?.q });
    return res.json({ ok: true, conversations });
  } catch (e) {
    console.error('/api/conversations list error:', e);
    return res.status(500).json({ ok: false, error: 'list failed' });
  }
});

app.post('/api/conversations', async (req, res) => {
  try {
    const userId = convUser(req);
    if (!userId) return res.status(401).json({ ok: false, error: 'login required' });
    await ensureGuestUser(userId);
    return res.status(201).json({ ok: true, conversation: await createConversation(prisma, userId, req.body?.title) });
  } catch (e) {
    console.error('/api/conversations create error:', e);
    return res.status(500).json({ ok: false, error: 'create failed' });
  }
});

app.patch('/api/conversations/:id', async (req, res) => {
  try {
    const userId = convUser(req);
    if (!userId) return res.status(401).json({ ok: false, error: 'login required' });
    const conversation = await renameConversation(prisma, userId, req.params.id, req.body?.title);
    if (!conversation) return res.status(404).json({ ok: false, error: 'not found' });
    return res.json({ ok: true, conversation });
  } catch (e) {
    if (e instanceof RangeError) return res.status(400).json({ ok: false, error: 'title required' });
    console.error('/api/conversations rename error:', e);
    return res.status(500).json({ ok: false, error: 'rename failed' });
  }
});

app.delete('/api/conversations/:id', async (req, res) => {
  try {
    const userId = convUser(req);
    if (!userId) return res.status(401).json({ ok: false, error: 'login required' });
    const removed = await deleteConversation(prisma, userId, req.params.id);
    if (!removed) return res.status(404).json({ ok: false, error: 'not found' });
    return res.json({ ok: true });
  } catch (e) {
    console.error('/api/conversations delete error:', e);
    return res.status(500).json({ ok: false, error: 'delete failed' });
  }
});

app.post('/api/chat', async (req, res) => {
```

### 6a) /api/chat: resolve the conversation
**SEARCH**
```js
    let said;
    if (!clean) {
      said = runSkillGreeting().said;
    } else {
      noteUserReplyForProactive(userId, clean);
      const skillResult = await runSkillCandidates(clean, lower, userId);
      if (skillResult) {
        said = skillResult.said;
        // ✅ NEW: this turn never reached runBrainFlow (which does its own
        // saving), so without this it was never persisted at all.
        await persistSkillTurn(userId, clean, said);
      } else {
        said = (await runBrainFlow(userId, clean, req.body?.image)).said;
      }
    }

    return res.json({ ok: true, reply: said, said });
```
**REPLACE**
```js
    let said;
    let conversationId;
    if (!clean) {
      said = runSkillGreeting().said;
    } else {
      // 'new' → fresh conversation, an id → that one, omitted → latest (older clients)
      try { await ensureGuestUser(userId); conversationId = (await resolveConversation(prisma, userId, req.body?.conversationId)).id; }
      catch (convErr) { console.warn('[chat] conversation resolve failed (non-fatal):', convErr.message); }
      noteUserReplyForProactive(userId, clean);
      const skillResult = await runSkillCandidates(clean, lower, userId);
      if (skillResult) {
        said = skillResult.said;
        // ✅ NEW: this turn never reached runBrainFlow (which does its own
        // saving), so without this it was never persisted at all.
        await persistSkillTurn(userId, clean, said, conversationId);
      } else {
        said = (await runBrainFlow(userId, clean, req.body?.image, { conversationId })).said;
      }
    }

    return res.json({ ok: true, reply: said, said, conversationId });
```

### 7a) /api/chat-stream: resolve the conversation
**SEARCH**
```js
    noteUserReplyForProactive(userId, clean);
    const skillResult = await runSkillCandidates(clean, lower, userId);
    if (skillResult) {
      send('chunk', { delta: skillResult.said });
      send('done', { text: skillResult.said });
      // ✅ NEW: same gap as /api/chat — a skill-handled turn here never
      // reached runBrainFlow, so it was never being persisted.
      await persistSkillTurn(userId, clean, skillResult.said);
      return res.end();
    }
```
**REPLACE**
```js
    // which conversation is this turn part of? ('new' → create, id → that one, omitted → latest)
    let conversationId;
    try { await ensureGuestUser(userId); conversationId = (await resolveConversation(prisma, userId, req.body?.conversationId)).id; }
    catch (convErr) { console.warn('[chat-stream] conversation resolve failed (non-fatal):', convErr.message); }

    noteUserReplyForProactive(userId, clean);
    const skillResult = await runSkillCandidates(clean, lower, userId);
    if (skillResult) {
      send('chunk', { delta: skillResult.said });
      // ✅ NEW: same gap as /api/chat — a skill-handled turn here never
      // reached runBrainFlow, so it was never being persisted.
      await persistSkillTurn(userId, clean, skillResult.said, conversationId);
      send('done', { text: skillResult.said, conversationId });
      return res.end();
    }
```

### 7b) /api/chat-stream: brain turn
**SEARCH**
```js
      runBrainFlow(userId, clean, req.body?.image, {
        onToken: (delta) => { if (!closed) send('chunk', { delta }); },
        expertMode,
      }),
```
**REPLACE**
```js
      runBrainFlow(userId, clean, req.body?.image, {
        onToken: (delta) => { if (!closed) send('chunk', { delta }); },
        expertMode,
        conversationId,
      }),
```

### 7c) /api/chat-stream: tell the client which conversation it landed in
**SEARCH**
```js
    if (!closed) send('done', { text: said });

  } catch (e) {
    console.error('/api/chat-stream error:', e);
```
**REPLACE**
```js
    if (!closed) send('done', { text: said, conversationId });

  } catch (e) {
    console.error('/api/chat-stream error:', e);
```
