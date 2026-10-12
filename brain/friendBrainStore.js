// brain/friendBrainStore.js
//
// Per-user conversational state for the Friend Brain (lastPhase / lastHelpProvided).
//
// It used to be ONE module-level object in brain.js shared by every user, so one
// user's phase (e.g. HELP) shaped the very next reply to a completely different
// user. This store keys it by userId instead.
//
// Rules:
//  - Unresolved / 'anonymous' users are NEVER stored: they get a fresh state each
//    turn (no continuity, but also no way for strangers to share one).
//  - Idle entries expire after FRIEND_STATE_TTL_MIN minutes (default 360).
//  - At most FRIEND_STATE_MAX users are kept (default 5000); least recently used
//    are evicted first, so guest sessions can't grow memory without bound.
//  - In-memory only, like before: it is small and low-value, and a restart just
//    means a fresh conversational phase.

function num(name, def) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : def;
}

const TTL_MS = num('FRIEND_STATE_TTL_MIN', 360) * 60_000;
const MAX_ENTRIES = Math.floor(num('FRIEND_STATE_MAX', 5000));

// Map keeps insertion order, so re-inserting on touch gives LRU order for free.
const store = new Map(); // key -> { state, touchedAt }

function freshState() {
  return { lastPhase: null, lastHelpProvided: false, updatedAt: Date.now() };
}

function keyOf(userId) {
  const k = userId == null ? '' : String(userId).trim();
  return k && k !== 'anonymous' ? k : null;
}

/** The user's state, or a fresh (not stored) one if there is none / it expired / user is anonymous. */
export function getFriendBrainState(userId) {
  const key = keyOf(userId);
  if (!key) return freshState();

  const entry = store.get(key);
  if (!entry) return freshState();

  const now = Date.now();
  if (now - entry.touchedAt > TTL_MS) {
    store.delete(key);
    return freshState();
  }

  store.delete(key); // re-insert = most recently used
  entry.touchedAt = now;
  store.set(key, entry);
  return entry.state;
}

/** Save the user's state. No-op for anonymous users. Returns the state it was given. */
export function setFriendBrainState(userId, state) {
  const key = keyOf(userId);
  if (!key) return state;

  store.delete(key);
  store.set(key, { state, touchedAt: Date.now() });

  while (store.size > MAX_ENTRIES) {
    store.delete(store.keys().next().value); // oldest first
  }
  return state;
}

/**
 * resetFriendBrainState(userId) clears one user.
 * resetFriendBrainState() with no argument clears everyone (same as the old
 * single-object reset, which is what the admin "reset all" path relies on).
 */
export function resetFriendBrainState(userId) {
  if (userId === undefined || userId === null) {
    const n = store.size;
    store.clear();
    return { cleared: n, scope: 'all' };
  }
  const key = keyOf(userId);
  return { cleared: key && store.delete(key) ? 1 : 0, scope: 'user' };
}

export function friendBrainStoreSize() {
  return store.size;
}