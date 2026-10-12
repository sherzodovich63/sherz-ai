// lib/messages.js — permanently delete chat messages (single or bulk).
//
// Ownership is enforced IN the query (userId is part of every WHERE), so an id that belongs to
// someone else behaves exactly like an id that does not exist: it is never reported and never touched.
// Deleted rows also drop out of what the model sees, because fetchContextForLLM reads the same table.

export const MAX_DELETE_BATCH = 200;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Cleans a client-supplied id list: strings only, valid shape, de-duplicated. Throws RangeError when unusable. */
export function parseIds(input) {
  if (!Array.isArray(input)) throw new RangeError('ids must be an array');
  const ids = [...new Set(input.filter((x) => typeof x === 'string' && ID_RE.test(x)))];
  if (!ids.length) throw new RangeError('no valid message ids');
  if (ids.length > MAX_DELETE_BATCH) throw new RangeError(`too many ids (max ${MAX_DELETE_BATCH})`);
  return ids;
}

/**
 * Deletes the caller's messages with these ids. Returns the ids that were really removed
 * (unknown / foreign ids are silently ignored, never an error and never a leak).
 */
export async function deleteMessages(prisma, userId, ids) {
  const clean = parseIds(ids);
  const owned = await prisma.message.findMany({ where: { userId, id: { in: clean } }, select: { id: true } });
  const found = owned.map((m) => m.id);
  if (!found.length) return [];
  await prisma.message.deleteMany({ where: { userId, id: { in: found } } });
  return found;
}
