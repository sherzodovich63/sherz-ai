# SHERZ — sidebar clean-up: no Create row, ONE scrollbar, no system keys

This goes **on top of `sherz-onespace.zip`** (it edits code that zip adds).

## What changed
1. **No "+ Create a Work Space" in the dropdown.** The dropdown now lists only your role(s). With no Work Space yet, the card itself says "Create your Work Space" and opens the creator. The second role is added with a **"+ 2nd role"** chip next to Skills / Edit profile (it disappears at 2 roles). Older accounts see a "Keep one…" chip instead.
2. **One scrollbar.** The sidebar (`.menu-inner`) is now the only scroll container. The project list, the Hub and the facts list no longer scroll on their own, so the three nested scrollbars are gone. The profile button and Log out stay pinned at the bottom. The Hub (appearance, voice, facts, reminders) opens in the same scroll above them and is brought into view. The facts list shows 5 entries with "Show all (N)" so it cannot grow without limit.
   *This replaces the drop-up popup from `sherz-fixes.zip` (the profile menu opened as an overlay with its own scroll). The old popup rules stay in the CSS but no longer match anything; you can delete that block if you like.*
3. **System keys hidden.** `proactive_*`, `learn:*`, `last_*`, `skill:*`, `system:*`, `internal:*`, `tmp:*`, `cache:*`, `state:*`, `tone:*`, `conversation_summary` and keys starting with `_` are never shown in "Knowledge (Facts)". Your own facts still show. The data itself is untouched.

Browser checks: 50 for the sidebar (desktop, short window, light theme, phone: exactly one scroll container, Log out always visible, no system keys, no create row, Show all works), plus the two Space tests updated (39 + 14). `server.js` and the database are unchanged.

## Files
NEW: `sidebar.css`, `tests/fe/sidebar.e2e.test.mjs` (needs the one-line `/api/facts/` route in your test mock, see the end)
CHANGED: `tests/fe/spaces.e2e.test.mjs`, `tests/fe/oneSpace.e2e.test.mjs`
By hand: `public/index.html` (14 edits below), `public/sherz-modern.css` (append `sidebar.css` at the very END)

## `public/index.html`

**1)** SEARCH
```js

              <button id="newSpaceBtn" class="hub-create" type="button"><span class="hub-create-plus" aria-hidden="true">+</span><span><b id="newSpaceTitle">Create your Work Space</b><small id="newSpaceSub">Pick a role or describe yours</small></span></button>
```
REPLACE
```js

```

**2)** SEARCH
```js
              <button id="hubEdit" class="hub-chip" type="button">Edit profile</button>
```
REPLACE
```js
              <button id="hubEdit" class="hub-chip" type="button">Edit profile</button>
              <button id="hubAddRole" class="hub-chip" type="button" hidden>+ 2nd role</button>
```

**3)** SEARCH
```js
      const nb = $('newSpaceBtn');
      if (nb){
        nb.hidden = !!one && !one.canAddRole;
        $('newSpaceTitle').textContent = spaceNeedsPick ? 'Choose your Work Space' : one ? 'Add a second role' : 'Create your Work Space';
        $('newSpaceSub').textContent = spaceNeedsPick ? 'You have older Spaces — keep one' : one ? 'e.g. a second job or study' : 'Pick a role or describe yours';
      }
```
REPLACE
```js
      const add = $('hubAddRole');                                                    // no "Create" row in the menu: the card creates the first Space, this chip adds the 2nd role
      if (add){ add.hidden = !(spaceNeedsPick || (one && one.canAddRole)); add.textContent = spaceNeedsPick ? 'Keep one…' : '+ 2nd role'; }
```

**4)** SEARCH
```js
      $('hubName').textContent = cur ? cur.name : 'Choose a Work Space';
```
REPLACE
```js
      $('hubName').textContent = cur ? cur.name : (spaceNeedsPick ? 'Choose your Work Space' : 'Create your Work Space');
```

**5)** SEARCH
```js
      $('hubSub').textContent = cur ? ((cur.role ? cur.role + ' · ' : '') + styleInfo(cur.style).label) : (spaces.length ? spaces.length + ' job profile' + (spaces.length === 1 ? '' : 's') + ' ready' : 'A job profile with its own rules and skills');
      $('hubActions').hidden = !cur;
```
REPLACE
```js
      $('hubSub').textContent = cur ? ((cur.role ? cur.role + ' · ' : '') + styleInfo(cur.style).label) : (spaceNeedsPick ? 'You have older Spaces — keep one' : 'Pick a role or describe yours');
      $('hubActions').hidden = !(cur || spaceNeedsPick);
      $('hubSkills').hidden = $('hubEdit').hidden = !cur;
```

**6)** SEARCH
```js
    $('newSpaceBtn')?.addEventListener('click', () => {
      hubMenu(false); openMenu();
      if (spaceNeedsPick) return openPickModal();
      const one = spaces.length === 1 ? spaces[0] : null;
      if (one) return openRoleSheet(one);
      openSpaceSheet(null);
    });
```
REPLACE
```js
    $('hubAddRole')?.addEventListener('click', () => {
      hubMenu(false); openMenu();
      if (spaceNeedsPick) return openPickModal();
      const one = spaces.length === 1 ? spaces[0] : null;
      if (one) openRoleSheet(one);
    });
```

**7)** SEARCH
```js
    $('hubCard')?.addEventListener('click', () => hubMenu($('spaceMenu').hidden));
```
REPLACE
```js
    $('hubCard')?.addEventListener('click', () => { if (!spaces.length){ openSpaceSheet(null); return; } hubMenu($('spaceMenu').hidden); });   // no Space yet → the card itself opens the creator
```

**8)** SEARCH
```js
        $('factsBox').innerHTML = (data.facts||[])
          .map(f=>
```
REPLACE
```js
        $('factsBox').innerHTML = (data.facts||[])
          .filter(f=>!isSystemFactKey(f.key))
          .map(f=>
```

**9)** SEARCH
```js
    async function refreshFacts(){
```
REPLACE
```js
    // internal bookkeeping (proactive pings, skill learning, tone state, summaries…) is not something the user should see
    const SYSTEM_FACT_KEY = /^(proactive[_:]|learn[_:]|last[_:]|skill[_:]|system[_:]|internal[_:]|tmp[_:]|cache[_:]|state[_:]|tone[_:]|conversation[_:]?summary|_)/i;
    const isSystemFactKey = (k) => SYSTEM_FACT_KEY.test(String(k || '').trim());
    async function refreshFacts(){
```

**10)** SEARCH
```js
    const hubEl = $('menuHub'), hubBtn = $('menuProfileBtn');
    function setHub(open){
      if (!hubEl || !hubBtn) return;
      hubEl.hidden = !open;
```
REPLACE
```js
    const hubEl = $('menuHub'), hubBtn = $('menuProfileBtn');
    { const foot = hubEl && hubEl.closest('.menu-foot'); if (foot && foot.parentNode) foot.parentNode.insertBefore(hubEl, foot); }   // the Hub scrolls WITH the sidebar; only the profile button + Log out stay pinned
    function setHub(open){
      if (!hubEl || !hubBtn) return;
      hubEl.hidden = !open;
```

**11)** SEARCH
```js
      if (open){ refreshFacts(); refreshReminders(); }
    }
```
REPLACE
```js
      if (open){
        refreshFacts(); refreshReminders();
        requestAnimationFrame(() => {                                          // bring the open Hub fully above the pinned footer
          const box = hubEl.closest('.menu-inner'), foot = document.querySelector('#leftPanel .menu-foot'); if (!box || !foot) return;
          const over = hubEl.getBoundingClientRect().bottom - foot.getBoundingClientRect().top + 8;
          if (over > 0) box.scrollTop += over;
        });
      }
    }
```

**12)** SEARCH
```js
        $('factsBox').innerHTML = (data.facts||[])
          .filter(f=>!isSystemFactKey(f.key))
          .map(f=>`<div class="item">• <b>${esc(f.key)}</b>: ${esc(f.value)}</div>`).join('') || '<i style="color:var(--muted)">Hali yo‘q</i>';
```
REPLACE
```js
        const mine = (data.facts||[]).filter(f=>!isSystemFactKey(f.key));
        const shown = factsAll ? mine : mine.slice(0, FACTS_PREVIEW);               // a short preview: the sidebar has ONE scroll, so the list must not grow without limit
        $('factsBox').innerHTML = shown.map(f=>`<div class="item">• <b>${esc(f.key)}</b>: ${esc(f.value)}</div>`).join('') || '<i style="color:var(--muted)">Hali yo‘q</i>';
        if (mine.length > FACTS_PREVIEW){
          const b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.id = 'factsMore'; b.textContent = factsAll ? 'Show less' : 'Show all (' + mine.length + ')';
          b.addEventListener('click', () => { factsAll = !factsAll; refreshFacts(); }); $('factsBox').appendChild(b);
        }
```

**13)** SEARCH
```js
    const isSystemFactKey = (k) => SYSTEM_FACT_KEY.test(String(k || '').trim());
```
REPLACE
```js
    const isSystemFactKey = (k) => SYSTEM_FACT_KEY.test(String(k || '').trim());
    const FACTS_PREVIEW = 5; let factsAll = false;
```

**14)** SEARCH
```js
          const over = hubEl.getBoundingClientRect().bottom - foot.getBoundingClientRect().top + 8;
          if (over > 0) box.scrollTop += over;
```
REPLACE
```js
          const h = hubEl.getBoundingClientRect(), top = box.getBoundingClientRect().top, room = foot.getBoundingClientRect().top - top;
          if (h.height > room - 16) box.scrollTop += h.top - top - 8;                // taller than the visible area → show its top
          else if (h.bottom > foot.getBoundingClientRect().top - 8) box.scrollTop += h.bottom - foot.getBoundingClientRect().top + 8;
```

## Test mock (only if you run the browser tests)
In `tests/fe/mock.mjs`, above the `/api/spaces` branch add:
```js
    if (u.pathname.startsWith('/api/facts/')) return json(res, 200, { ok: true, facts: state.facts || [] });
```
