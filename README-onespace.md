# SHERZ — ONE Work Space per user, up to TWO roles inside it

## What changed
- **One Work Space per user.** Creating a second one is refused (`you already have your Work Space — edit it or add a second role instead`).
- **Up to two roles inside it.** Role 1 is the Space itself; role 2 is stored in a new `role2` column. The user switches the active role from the sidebar card. Switching changes the profile SHERZ uses (name, role, instructions, work style); **skills, chats and files stay shared by the whole Work Space.** The chat title follows the active role. Editing while role 2 is active edits role 2. "Remove this role" brings back role 1 only.
- **Older accounts with several Spaces** get a "Choose your Work Space" dialog when they open the app (once per visit; "Later" is allowed). They keep one, and can use one other as the second role. **Nothing is merged or deleted automatically:** the others are archived, and the second Space's skills move into the kept one (a skill with the same name keeps the original). Until they choose, all their Spaces keep working.
- No new packages.

Tests: full suite **299 passing** (spaces: 15, 3 new groups: roles, migration, routes). Browser: 39 (existing Space flow, updated for roles) + 14 (the new "choose" dialog: opens by itself, Later, keep + second role, nothing deleted, never shows again, phone fit) + 36 (profile popup, from the last zip).

## Files
NEW: `tests/fe/oneSpace.e2e.test.mjs`, `one-space.css`
CHANGED (full files): `lib/spaces.js`, `routes/spaces.js`, `tests/spaces.test.mjs`, `tests/helpers/spacesDb.mjs`, `tests/fe/spaces.e2e.test.mjs`
By hand: `prisma/schema.prisma` (1 edit), `public/sherz-modern.css` (append `one-space.css` at the very END), `public/index.html` (14 edits below). `server.js` needs **no change**.

## Step 1 — database (additive, safe: two new columns with defaults)
SEARCH (in `model WorkSpace`)
```prisma
  templates     Json           @default("[]")
```
REPLACE
```prisma
  templates     Json           @default("[]")
  role2         Json           @default("{}")   // the optional SECOND role: { name, role, instructions, style, icon, color, preset }
  activeRole    Int            @default(1)      // which role is active: 1 or 2
```
Then `npx prisma db push` — on your **Neon dev** database first. Do the production one deliberately, when you deploy. Until the push is done the app still works with one role; adding a role answers "run `npx prisma db push`".

## Step 2 — `public/index.html`

**1)** SEARCH
```js
<button id="newSpaceBtn" class="hub-create" type="button"><span class="hub-create-plus" aria-hidden="true">+</span><span><b>Create a Work Space</b><small>Pick a role or describe yours</small></span></button>
```
REPLACE
```js
<button id="newSpaceBtn" class="hub-create" type="button"><span class="hub-create-plus" aria-hidden="true">+</span><span><b id="newSpaceTitle">Create your Work Space</b><small id="newSpaceSub">Pick a role or describe yours</small></span></button>
```

**2)** SEARCH
```js
  <div id="spaceModal" class="sp-overlay" hidden role="dialog" aria-modal="true" aria-labelledby="spTitle">
```
REPLACE
```js
  <div id="pickModal" class="sp-overlay" hidden role="dialog" aria-modal="true" aria-labelledby="pkTitle">
    <div class="sp-sheet">
      <header class="sp-head"><h2 id="pkTitle">Choose your Work Space</h2></header>
      <div class="sp-body">
        <p class="pk-text">SHERZ now keeps <b>one</b> Work Space per person, with up to <b>two roles</b> inside it. Pick the one to keep. Nothing is deleted: the others are archived.</p>
        <div class="sp-label" id="pkKeepLabel">Keep this Work Space</div>
        <div id="pkList" class="pk-list" role="radiogroup" aria-labelledby="pkKeepLabel"></div>
        <div class="sp-label" id="pkSecondLabel">Optional: add another as your second role</div>
        <div id="pkSecond" class="pk-list" role="radiogroup" aria-labelledby="pkSecondLabel"></div>
        <div id="pkError" class="pf-error" role="alert" hidden></div>
        <div class="pf-actions">
          <button id="pkSave" class="pf-create" type="button">Keep this Work Space</button>
          <button id="pkLater" class="pf-cancel" type="button">Later</button>
        </div>
      </div>
    </div>
  </div>

  <div id="spaceModal" class="sp-overlay" hidden role="dialog" aria-modal="true" aria-labelledby="spTitle">
```

**3)** SEARCH
```js
spacesSupported = true, editingSpace = null, skillEditId = null, spaceSkills = [];
```
REPLACE
```js
spacesSupported = true, editingSpace = null, skillEditId = null, spaceSkills = [], spaceNeedsPick = false, pickShown = false, addingRoleTo = null;
```

**4)** SEARCH
```js
        spacesSupported = true; spaces = d.spaces || [];
        spaceMeta = { categories: d.categories || [], styles: d.styles || [], icons: d.icons || [], colors: d.colors || [], aiGenerator: !!d.aiGenerator };
        renderSpaces(); return true;
```
REPLACE
```js
        spacesSupported = true; spaces = d.spaces || []; spaceNeedsPick = !!d.needsPick;
        spaceMeta = { categories: d.categories || [], styles: d.styles || [], icons: d.icons || [], colors: d.colors || [], aiGenerator: !!d.aiGenerator };
        renderSpaces();
        if (spaceNeedsPick && !pickShown){ pickShown = true; openPickModal(); }       // an older account with several Spaces: choose one (once per visit)
        return true;
```

**5)** SEARCH
```js
      $('spaceCount').textContent = String(spaces.length);
      const cur = spaceOfConv(currentSpaceConv());
```
REPLACE
```js
      const one = spaces.length === 1 ? spaces[0] : null;                               // ONE Work Space per user; the list below shows its ROLES (max 2)
      $('spaceCount').textContent = one ? one.roles.length + '/2' : String(spaces.length);
      const cur = spaceOfConv(currentSpaceConv()) || one;
      const nb = $('newSpaceBtn');
      if (nb){
        nb.hidden = !!one && !one.canAddRole;
        $('newSpaceTitle').textContent = spaceNeedsPick ? 'Choose your Work Space' : one ? 'Add a second role' : 'Create your Work Space';
        $('newSpaceSub').textContent = spaceNeedsPick ? 'You have older Spaces — keep one' : one ? 'e.g. a second job or study' : 'Pick a role or describe yours';
      }
```

**6)** SEARCH
```js
      if (!spaces.length){ const e = document.createElement('div'); e.className = 'hub-empty'; e.textContent = 'No Work Spaces yet.'; list.appendChild(e); }
      for (const s of spaces){
```
REPLACE
```js
      if (!spaces.length){ const e = document.createElement('div'); e.className = 'hub-empty'; e.textContent = 'No Work Space yet.'; list.appendChild(e); }
      if (one) for (const r of one.roles){
        const on = r.n === one.activeRole;
        const b = document.createElement('button'); b.type = 'button'; b.className = 'hub-item sp-' + r.color + (on ? ' on' : ''); b.dataset.role = String(r.n);
        b.setAttribute('role', 'option'); b.setAttribute('aria-selected', on ? 'true' : 'false');
        const av = document.createElement('span'); av.className = 'hub-avatar sm'; av.setAttribute('aria-hidden', 'true'); av.textContent = SP_ICON[r.icon] || '💼';
        const tx = document.createElement('span'); tx.className = 'hub-text';
        const n = document.createElement('span'); n.className = 'hub-name'; n.textContent = r.name;
        const m = document.createElement('span'); m.className = 'hub-sub'; m.textContent = 'Role ' + r.n + (on ? ' · active' : '') + ' · ' + styleInfo(r.style).label;
        tx.append(n, m); b.append(av, tx);
        b.addEventListener('click', () => { hubMenu(false); switchRole(one.id, r.n); });
        list.appendChild(b);
      }
      else for (const s of spaces){
```

**7)** SEARCH
```js
    async function openSpace(id, opts = {}){
```
REPLACE
```js
    async function switchRole(id, n){
      const s = spaces.find(x => x.id === id);
      try{
        if (!s || s.activeRole !== n){
          const r = await convFetch('/api/spaces/' + encodeURIComponent(id) + '/active-role', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: n, userId: GUEST_ID }) });
          const d = await r.json().catch(() => null);
          if (!r.ok || !d || !d.ok) throw new Error((d && d.error) || ('HTTP ' + r.status));
          await refreshSpaces(); await refreshConversations();
        }
        await openSpace(id);
      }catch(e){ menuNotice('Couldn’t switch the role.'); }
    }
    async function openSpace(id, opts = {}){
```

**8)** SEARCH
```js
    function closeSpaceSheet(){ $('spaceModal').hidden = true; document.body.classList.remove('sp-open'); editingSpace = null; }
```
REPLACE
```js
    function closeSpaceSheet(){ $('spaceModal').hidden = true; document.body.classList.remove('sp-open'); editingSpace = null; addingRoleTo = null; }
    function openRoleSheet(sp){                                             // the creator, but it saves as the SECOND role of the existing Work Space
      openSpaceSheet(null); addingRoleTo = sp.id;
      $('spTitle').textContent = 'Add a second role'; $('spSave').textContent = 'Add role';
    }
```

**9)** SEARCH
```js
      $('spSave').textContent = space ? 'Save changes' : 'Create Work Space';
```
REPLACE
```js
      $('spSave').textContent = space ? 'Save changes' : 'Create Work Space';
      $('spArchive').textContent = space && space.activeRole === 2 ? 'Remove this role' : 'Archive';
      $('spDelete').textContent = 'Delete forever';
```

**10)** SEARCH
```js
        const r = await convFetch('/api/spaces' + (editingSpace ? '/' + encodeURIComponent(editingSpace.id) : ''), { method: editingSpace ? 'PATCH' : 'POST', headers:
```
REPLACE
```js
        const r = await convFetch('/api/spaces' + (addingRoleTo ? '/' + encodeURIComponent(addingRoleTo) + '/role2' : editingSpace ? '/' + encodeURIComponent(editingSpace.id) : ''), { method: addingRoleTo ? 'PUT' : editingSpace ? 'PATCH' : 'POST', headers:
```

**11)** SEARCH
```js
      if (!editingSpace) return; const id = editingSpace.id;
      try{
        const r = await convFetch('/api/spaces/' + encodeURIComponent(id) + (permanent ? '?permanent=1' : ''), { method: 'DELETE' });
```
REPLACE
```js
      if (!editingSpace) return; const id = editingSpace.id;
      if (!permanent && editingSpace.activeRole === 2){                      // "Remove this role": back to role 1, the Work Space itself stays
        try{
          const r = await convFetch('/api/spaces/' + encodeURIComponent(id) + '/role2', { method: 'DELETE' });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          closeSpaceSheet(); await refreshSpaces(); await refreshConversations(); menuNotice('Second role removed.');
        }catch(e){ spErr('Couldn’t remove the role.'); }
        return;
      }
      try{
        const r = await convFetch('/api/spaces/' + encodeURIComponent(id) + (permanent ? '?permanent=1' : ''), { method: 'DELETE' });
```

**12)** SEARCH
```js
    $('newSpaceBtn')?.addEventListener('click', () => { hubMenu(false); openMenu(); openSpaceSheet(null); });
```
REPLACE
```js
    $('newSpaceBtn')?.addEventListener('click', () => {
      hubMenu(false); openMenu();
      if (spaceNeedsPick) return openPickModal();
      const one = spaces.length === 1 ? spaces[0] : null;
      if (one) return openRoleSheet(one);
      openSpaceSheet(null);
    });
```

**13)** SEARCH
```js
    $('hubCard')?.addEventListener('click', () => hubMenu($('spaceMenu').hidden));
```
REPLACE
```js
    // ── older accounts with several Spaces: keep one (+ optionally another as role 2); the rest are archived, never deleted ──
    let pkKeep = null, pkSecond = null;
    function pkRender(){
      const fill = (box, withNone, cur, set) => {
        box.textContent = '';
        const items = withNone ? [{ id: null, name: 'No second role', role: '', icon: 'briefcase', color: 'violet' }, ...spaces.filter(s => s.id !== pkKeep)] : spaces;
        for (const s of items){
          const b = document.createElement('button'); b.type = 'button'; b.className = 'pk-item' + (cur === s.id ? ' on' : ''); b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', cur === s.id ? 'true' : 'false'); b.dataset.id = s.id || '';
          const i = document.createElement('span'); i.className = 'pk-ico'; i.textContent = s.id ? (SP_ICON[s.icon] || '💼') : '–';
          const t = document.createElement('span'); t.className = 'pk-txt'; const n = document.createElement('b'); n.textContent = s.name; const m = document.createElement('small'); m.textContent = s.id ? (s.role || 'Work Space') + ' · ' + (s.skillCount || 0) + ' skills' : 'Only one role for now';
          t.append(n, m); b.append(i, t); b.addEventListener('click', () => { set(s.id); pkRender(); }); box.appendChild(b);
        }
      };
      fill($('pkList'), false, pkKeep, (id) => { pkKeep = id; if (pkSecond === id) pkSecond = null; });
      fill($('pkSecond'), true, pkSecond, (id) => { pkSecond = id; });
    }
    function openPickModal(){
      if (spaces.length < 2) return;
      pkKeep = (spaceOfConv(currentSpaceConv()) || spaces[0]).id; pkSecond = null; pkRender(); spErr('', 'pkError');
      $('pickModal').hidden = false; document.body.classList.add('sp-open');
    }
    function closePickModal(){ $('pickModal').hidden = true; if ($('spaceModal').hidden) document.body.classList.remove('sp-open'); }
    async function savePick(){
      if (!pkKeep) return; const btn = $('pkSave'); btn.disabled = true; spErr('', 'pkError');
      try{
        const r = await convFetch('/api/spaces/pick', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: pkKeep, secondId: pkSecond, userId: GUEST_ID }) });
        const d = await r.json().catch(() => null);
        if (!r.ok || !d || !d.ok) throw new Error((d && d.error) || ('HTTP ' + r.status));
        closePickModal(); await refreshSpaces(); await refreshConversations(); menuNotice('Your Work Space is set.');
      }catch(e){ spErr(/^HTTP/.test(e.message) ? 'Couldn’t save. Try again.' : e.message, 'pkError'); }
      finally{ btn.disabled = false; }
    }
    $('pkSave')?.addEventListener('click', savePick);
    $('pkLater')?.addEventListener('click', closePickModal);
    $('pickModal')?.addEventListener('keydown', (e) => { if (e.key === 'Escape'){ e.stopPropagation(); closePickModal(); } });

    $('hubCard')?.addEventListener('click', () => hubMenu($('spaceMenu').hidden));
```

**14)** SEARCH
```js
    $('hubSkills')?.addEventListener('click', () => { const s = spaceOfConv(currentSpaceConv()); if (s) openSpaceSheet(s, 'skills'); });
    $('hubEdit')?.addEventListener('click', () => { const s = spaceOfConv(currentSpaceConv()); if (s) openSpaceSheet(s, 'profile'); });
```
REPLACE
```js
    const myWorkSpace = () => spaceOfConv(currentSpaceConv()) || (spaces.length === 1 ? spaces[0] : null);
    $('hubSkills')?.addEventListener('click', () => { const s = myWorkSpace(); if (s) openSpaceSheet(s, 'skills'); });
    $('hubEdit')?.addEventListener('click', () => { const s = myWorkSpace(); if (s) openSpaceSheet(s, 'profile'); });
```

## Try it
1. Restart. New or one-Space account: open the sidebar → the Work card lists your **roles**; "Add a second role" opens the creator; after adding, the button disappears (limit 2) and the count shows 2/2. Click the other role to switch; the chat title and the profile follow.
2. Older account with several Spaces: the "Choose your Work Space" dialog opens by itself.
3. A switched role is visible to the model: ask "who are you here?" in each role.

## Not built yet (next steps of the plan)
Screen perception and mouse/keyboard control (the helper program). They are separate work: first screenshots only, then single approved actions, then limited sessions.
