import { ssePushToUser } from '../realtime/sseHub.js';
import { recordReplyToLastProactive } from '../proactive/proactiveFeedback.js';
import { recomputeUserProactivePolicy } from '../proactive/proactivePolicy.js';
import { checkRateLimit } from '../services/rateLimiter.js';

export function chatRoute(app, prisma, runBrain) {
  app.post('/api/chat', async (req, res) => {
    const userId = String(req.body.userId || 'u1');
    const text   = String(req.body.message || '').trim();
    const image  = req.body.image;

    if (!text && !image) {
      return res.status(400).json({ ok: false, error: 'EMPTY_MESSAGE' });
    }

    // 0) Rate limit
    const limit = checkRateLimit(userId);
    if (!limit.allowed) {
      return res.status(429).json({
        ok: false,
        error: 'rate_limited',
        reason: limit.reason,
        reply: "Sherz juda tez javob beryapti. Iltimos, bir daqiqa kutib turib, keyin yozing.",
        resetAt: limit.resetAt
      });
    }

    // 1) Save user message
    const userMsg = await prisma.message.create({
      data: {
        userId,
        role: 'user',
        content: text,
        meta: image ? { hasImage: true, imageData: image.substring(0, 100) + '...' } : {}
      }
    });

    // 2) Push user message to frontend via SSE
    ssePushToUser(userId, 'message', {
      id: userMsg.id,
      role: userMsg.role,
      content: userMsg.content,
      createdAt: userMsg.createdAt,
      meta: userMsg.meta
    });

    // 3) Proactive signal update
    const updated = await recordReplyToLastProactive({ prisma, userId });
    if (updated) {
      await recomputeUserProactivePolicy({ prisma, userId });
    }

    // 4) ✅ FETCH CHAT HISTORY — this is what was missing
    // Load last 20 messages so brain.llm has full conversation context
    const recentMessages = await prisma.message.findMany({
      where:   { userId },
      orderBy: { createdAt: 'asc' },
      take:    20,
      select:  { role: true, content: true }
    });

    // Shape into { role, content } array that OpenAI expects
    const messages = recentMessages.map(m => ({
      role:    m.role,
      content: String(m.content || '')
    }));

    // 5) Call brain WITH history
    const brainResult = await runBrain({ userId, text, image, messages });

    // 6) ✅ UNWRAP the response object — runBrain returns { type, content, ... }
    const replyText = brainResult?.content
      ?? brainResult?.reply
      ?? brainResult?.said
      ?? (typeof brainResult === 'string' ? brainResult : null)
      ?? "Uzr, javob olishda xato yuz berdi.";

    // 7) Save assistant message
    const botMsg = await prisma.message.create({
      data: {
        userId,
        role: 'assistant',
        content: replyText,
        meta: { proactive: false }
      }
    });

    // 8) Push assistant message to frontend via SSE
    ssePushToUser(userId, 'message', {
      id:        botMsg.id,
      role:      botMsg.role,
      content:   botMsg.content,
      createdAt: botMsg.createdAt,
      meta:      botMsg.meta
    });

    res.json({ ok: true, reply: replyText });
  });
}