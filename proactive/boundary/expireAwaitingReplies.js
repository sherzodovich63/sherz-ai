// src/proactive/boundary/expireAwaitingReplies.js
import { prisma } from '../../db/prisma.js';

export async function expireAwaitingReplies(){
  const now = new Date();
  const expired = await prisma.proactiveEvent.findMany({
    where:{
      awaitingReply:true,
      replyDeadlineAt:{ lte: now }
    },
    take: 100
  });

  for (const e of expired){
    await prisma.proactiveEvent.update({
      where:{ id: e.id },
      data:{ awaitingReply:false, gotReply:false }
    });
  }

  return expired.length;
}
