// memory/interactionStore.js
// MVP: RAM store (server restart bo'lsa tozalanadi)

const lastInteractionMap = new Map(); // userId -> timestamp(ms)

export function touchInteraction(userId, ts = Date.now()) {
  if (!userId) return;
  lastInteractionMap.set(String(userId), ts);
}

export function getLastInteraction(userId) {
  if (!userId) return null;
  return lastInteractionMap.get(String(userId)) ?? null;
}

export function clearInteraction(userId) {
  if (!userId) return;
  lastInteractionMap.delete(String(userId));
}
