# SHERZ — three fixes: profile popup, "haqida" context loss, fake file links

## What was wrong and what changed

1. **Profile menu** — the popup was part of the sidebar footer, so opening it made the footer taller and pushed *Log out* off-screen. It is now an overlay that opens **upwards** from the profile button (opaque, scrolls inside itself). On short windows the upper part of the sidebar scrolls and the footer stays pinned. Browser check: 36 passed (desktop dark/light, short window, phone).
2. **"Xarajatlar haqida"** — two causes: (a) the word *haqida* sent the message to the web-lookup skill before the chat model saw it; (b) the short answer did not look like a file request, so the file tools were off. Now, when SHERZ's last message was a question and one of the last user messages asked for a file, the short answer is treated as part of that file task: skills are skipped, file tools are on, and the original request counts as the user's explicit request (so the file is built right away, no extra click). Cancel words (yo'q, kerak emas, bekor…) and long new messages are not treated as answers.
3. **Fake links** (`sandbox:/…xlsx`) — three layers: the Expert prompt now forbids links and says to call the file tool; if a draft still contains a made-up link and no plan was proposed, the model is sent back **once** to call `docs.create_*` (the fake draft is dropped from its context); whatever still gets through is stripped from the reply (normal chat too, with a short honest note that no file was made). Real links (`/api/files/<id>/download`) are untouched.

Tests: full suite 296 passing (6 new). No new packages.

## Files
NEW: `lib/docs/followup.js`, `tests/docFollowup.test.mjs`, `profile-popup.css`
CHANGED: `brain/expertTurn.js` (full file), `tests/boundaryTurn.harness.test.mjs` (full file)
Patch by hand: `server.js` (below), `public/sherz-modern.css` (append the block from `profile-popup.css` to the very END of the file)

## Patch — `server.js`

**1)** SEARCH
```js
import { wantsDocFile } from './lib/docs/intent.js';
```
REPLACE
```js
import { wantsDocFile } from './lib/docs/intent.js';
import { docFollowUpRequest, hasFakeFileLink, stripFakeFileLinks } from './lib/docs/followup.js';   // keeps a file task alive across a clarifying question; blocks made-up download links
```

**2)** SEARCH
```js
async function runBrainFlow(userId, clean, image, { onToken, expertMode = false, conversationId, conversation } = {}) {
```
REPLACE
```js
// The user asked for a file, SHERZ asked a question, and this message just answers it → returns the original file request, else null.
async function docFollowUpFor(userId, clean, conversationId) {
  try {
    const history = await fetchContextForLLM(prisma, userId, { conversationId: (conversationId && conversationId !== 'new') ? conversationId : undefined });
    return docFollowUpRequest({ history: (history || []).slice(-8), text: clean });
  } catch { return null; }
}

async function runBrainFlow(userId, clean, image, { onToken, expertMode = false, conversationId, conversation, docRequest = null } = {}) {
```

**3)** SEARCH
```js
maxToolHops: 8, conversationId: conv ? conv.id : (conversationId || null) })
      : await runBrain(
```
REPLACE
```js
maxToolHops: 8, conversationId: conv ? conv.id : (conversationId || null), docRequest })
      : await runBrain(
```

**4)** SEARCH
```js
    const said = brainResult?.content || brainResult?.said || null;
    if (!said) {
      console.error('[brain.llm] runBrain returned empty
```
REPLACE
```js
    let said = brainResult?.content || brainResult?.said || null;
    // a made-up download link (sandbox:/…xlsx) must never reach the chat — nothing was created
    if (said && !expertMode && hasFakeFileLink(said)) said = stripFakeFileLinks(said) + '\n\n(Fayl hali yaratilmadi. Yaratish uchun yozing: «Excel fayl yaratib ber: …» — tayyor bo‘lganda haqiqiy yuklab olish tugmasi chiqadi.)';
    if (!said) {
      console.error('[brain.llm] runBrain returned empty
```

**5)** SEARCH
```js
      noteUserReplyForProactive(userId, clean);
      const skillResult = req.body?.image ? null : await runSkillCandidates(clean, lower, userId);
      if (skillResult) {
        said = skillResult.said;
```
REPLACE
```js
      noteUserReplyForProactive(userId, clean);
      const docRequest = req.body?.image ? null : await docFollowUpFor(userId, clean, conversationId);   // answering SHERZ's question about a file → stay on that task
      const skillResult = (req.body?.image || docRequest) ? null : await runSkillCandidates(clean, lower, userId);
      if (skillResult) {
        said = skillResult.said;
```

**6)** SEARCH
```js
const bf = await runBrainFlow(userId, clean, req.body?.image, { conversationId, conversation });
```
REPLACE
```js
const bf = await runBrainFlow(userId, clean, req.body?.image, { conversationId, conversation, docRequest, expertMode: !!docRequest || wantsDocFile(clean) });
```

**7)** SEARCH
```js
    noteUserReplyForProactive(userId, clean);
    const skillResult = req.body?.image ? null : await runSkillCandidates(clean, lower, userId);
    if (skillResult) {
      send('chunk', { delta: skillResult.said });
```
REPLACE
```js
    noteUserReplyForProactive(userId, clean);
    const docRequest = req.body?.image ? null : await docFollowUpFor(userId, clean, conversationId);   // answering SHERZ's question about a file ("Xarajatlar haqida") → stay on that task, no web lookup
    const skillResult = (req.body?.image || docRequest) ? null : await runSkillCandidates(clean, lower, userId);
    if (skillResult) {
      send('chunk', { delta: skillResult.said });
```

**8)** SEARCH
```js
    const autoDocs = wantsDocFile(clean);

```
REPLACE
```js
    const autoDocs = wantsDocFile(clean) || !!docRequest;

```

**9)** SEARCH
```js
        expertMode,
        conversationId,
        conversation,
      }),
```
REPLACE
```js
        expertMode,
        conversationId,
        conversation,
        docRequest,
      }),
```

## Try it
1. Restart. Open the sidebar → click your profile: the menu opens upward, Log out stays visible.
2. Write `manga excel jadval qilib ber`, answer `Xarajatlar haqida` → terminal shows `[docs] file request detected → Expert Mode on`, and the Excel card runs with a Download button; no dictionary answer.
3. If you ever see a plain-text file link again, send me the reply — it should now be stripped or replaced by a real tool call.
