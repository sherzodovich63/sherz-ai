// lib/guestMerge.js
//
// Guest sessions are ephemeral: the browser keeps the guest id in memory only, so
// a reload/close abandons that guest. When a guest signs in with Google DURING an
// active session, we move that session's chat + facts to the real account and
// remove the guest. Nothing else from the guest is carried over.
//
// Tables with a User relation (profile, emotions, tone events, ...) are removed by
// the onDelete: Cascade when the guest User row is deleted. Tables that only store
// a plain userId string (no relation) are deleted explicitly below.

export const GUEST_PREFIX = 'guest_';

export function isGuestId(id) {
  return typeof id === 'string' && id.startsWith(GUEST_PREFIX) && id.length > GUEST_PREFIX.length;
}

// models keyed by a bare userId column with NO relation to User
const LOOSE_MODELS = [
  'todo', 'reminder', 'moodEntry', 'journalEntry', 'habitEvent', 'userPref',
  'profileSummaryCache', 'proactiveEvent', 'proactiveInbox', 'userProactivePolicy',
];

/**
 * Moves Conversation + Message + Fact rows from guestId to userId, then deletes the guest.
 * Single transaction: either everything moves or nothing does.
 * Idempotent: a second call finds nothing and returns zeros.
 */
export async function mergeGuestIntoUser(prisma, guestId, userId) {
  if (!isGuestId(guestId)) throw new Error('mergeGuestIntoUser: not a guest id');
  if (!userId || isGuestId(userId) || guestId === userId) throw new Error('mergeGuestIntoUser: bad target user');

  return prisma.$transaction(async (tx) => {
    // conversations first: the guest's chats keep their grouping/titles in the real account
    if (tx.conversation?.updateMany) await tx.conversation.updateMany({ where: { userId: guestId }, data: { userId } });
    const messages = await tx.message.updateMany({ where: { userId: guestId }, data: { userId } });
    const facts = await tx.fact.updateMany({ where: { userId: guestId }, data: { userId } });

    for (const model of LOOSE_MODELS) {
      if (tx[model]?.deleteMany) await tx[model].deleteMany({ where: { userId: guestId } });
    }
    // only ever deletes a guest row, never a real account
    await tx.user.deleteMany({ where: { id: guestId } });

    return { messages: messages.count, facts: facts.count };
  });
}

/** Deletes abandoned guests (and, via cascade/explicit deletes, their data). */
export async function purgeStaleGuests(prisma, { olderThanHours = 48 } = {}) {
  const cutoff = new Date(Date.now() - olderThanHours * 3600_000);
  const stale = await prisma.user.findMany({
    where: { id: { startsWith: GUEST_PREFIX }, createdAt: { lt: cutoff } },
    select: { id: true },
    take: 500,
  });
  let purged = 0;
  for (const { id } of stale) {
    await prisma.$transaction(async (tx) => {
      for (const model of LOOSE_MODELS) {
        if (tx[model]?.deleteMany) await tx[model].deleteMany({ where: { userId: id } });
      }
      await tx.user.deleteMany({ where: { id } });
    });
    purged++;
  }
  return { purged };
}
