// brain/expertTurn.js
//
// Expert Mode's execution loop — a separate entry point from runBrain(),
// not a modification of it, so Expert Mode is additive and normal chat
// can't regress. Shares the same memory/context assembly as runBrain()
// via buildFullSystemContext() (systemContext.js) rather than
// reimplementing it — see that file's header for why that matters in this
// codebase specifically.
//
// ⚠️ Known simplification, flagged rather than hidden: this loop does NOT
// use true token-level API streaming (`stream: true`) for the OpenAI
// calls. Combining real streaming with tool-calling means reassembling
// tool_call argument deltas across chunks and tracking finish_reason
// mid-stream — real added complexity for a first version. Instead, each
// hop is a normal (non-streaming) call, and once a final text answer
// exists, it's chunked into words and fed to onToken() to simulate a
// stream — so the existing typewriter UI still gets incremental calls
// rather than the whole answer appearing at once. Worth revisiting if
// Expert Mode responses feel noticeably different from normal chat.

import { openai } from '../llm/openaiClient.js';
import { runSafety } from './safety.js';
import { buildSystemPrompt } from './systemPrompt.js';
import { decideResponsePolicy } from './policy/responsePolicy.js';
import { buildResponseInstruction } from './responseComposer.js';
import { userContextAnalyzer } from './userContextAnalyzer.js';
import { detectEmotion } from '../nlu/detectEmotion.js';
import { extractNameAndStyle } from '../nlu/nameStyleExtractor.js';

import {
  normalizeRecentMessages,
  normalizeEmotion,
  writeEmotionLog,
  getEmotionSummary,
  getFriendBrainState,
} from './brain.js';

import { buildFullSystemContext } from './systemContext.js';
import { getToolSchemas, executeTool } from './tools.js';
import { isExpertModeAllowed, isToolAllowed } from './expertModePermissions.js';

function getLastUserText(messages = []) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === 'user') {
      return typeof m.content === 'string' ? m.content : (m.content?.[0]?.text || '');
    }
  }
  return '';
}

/**
 * @param {object} params
 * @param {string} params.userId
 * @param {Array} params.messages
 * @param {object} params.prisma
 * @param {string|null} [params.image] - data-URL string, same format as runBrain()
 * @param {(delta:string)=>void} [params.onToken]
 * @param {number} [params.maxToolHops=5] - safety cap so a confused loop can't run away
 * @returns {Promise<{ type:string, content:string, toolTrace:Array, hops:number }>}
 */
export async function runExpertTurn({ userId, messages, prisma, image, onToken, maxToolHops = 5 }) {
  console.log('🛠️ SHERZ Expert Mode turn', { userId, msgCount: messages?.length, maxToolHops });

  // 1) Safety — same gate as normal chat; Expert Mode does not bypass it
  const safety = await runSafety({ userId, messages });
  if (!safety.ok) {
    return {
      type: 'safety_block',
      content: 'Kechirasiz, bu so\'rov xavfsizlik qoidalariga zid. Bu mavzuda yordam bera olmayman.',
      safety,
    };
  }

  // 2) Expert Mode access check
  const access = await isExpertModeAllowed({ userId });
  if (!access.allowed) {
    return {
      type: 'expert_mode_denied',
      content: 'Expert Mode hozircha mavjud emas.',
      reason: access.reason,
    };
  }

  const userText = getLastUserText(messages);

  // 3) Same memory/context/system-prompt assembly runBrain() uses.
  // isTrivialGreeting is always false here — Expert Mode is explicitly
  // invoked for substantive tasks, so the greeting latency fast-path
  // (built for cheap "salom"/"rahmat" chit-chat in normal chat) doesn't
  // apply — a real memory/context pass is always worth it in this mode.
  const { systemPrompt } = await buildFullSystemContext({
    userId,
    prisma,
    messages,
    userText,
    isTrivialGreeting: false,
    deps: {
      extractNameAndStyle,
      detectEmotion,
      normalizeEmotion,
      writeEmotionLog,
      getEmotionSummary,
      decideResponsePolicy,
      normalizeRecentMessages,
      userContextAnalyzer,
      buildSystemPrompt,
      buildResponseInstruction,
      friendBrainState: getFriendBrainState(),
    },
  });

  // 4) Image handling — same Vision-format conversion as brain.js, written
  // correctly here (this loop builds its own finalMessages rather than
  // calling runBrain(), so it needs its own correct version, not a copy
  // of the String()-destruction bug already fixed there).
  const workingMessages = [...messages];
  if (image && workingMessages.length > 0) {
    const lastMsg = workingMessages[workingMessages.length - 1];
    if (lastMsg.role === 'user') {
      lastMsg.content = [
        { type: 'text', text: lastMsg.content },
        { type: 'image_url', image_url: { url: image } },
      ];
    }
  }

  const expertSystemPrompt =
    systemPrompt +
    '\n\n' +
    [
      'EXPERT MODE ACTIVE:',
      '- Siz hozir texnik/murakkab vazifalarni bajarish rejimidasiz.',
      '- Zarur bo\'lsa, mavjud tool\'lardan foydalaning (kod tekshirish, web fetch, todo/reminder/journal va h.k.).',
      '- Har bir qadamni aniq va ishonchli bajaring; noaniq bo\'lsa, taxmin qilmasdan so\'rang.',
      '- Tool natijasini userga xom holda qaytarmang — tushunarli, foydali shaklda izohlang.',
    ].join('\n');

  const finalMessages = [
    { role: 'system', content: expertSystemPrompt },
    ...workingMessages
      .filter((m) => m?.role === 'user' || m?.role === 'assistant')
      .map((m) => ({
        role: m.role,
        content: Array.isArray(m.content) ? m.content : String(m.content ?? ''),
      })),
  ];

  const tools = getToolSchemas();
  const model = process.env.OPENAI_EXPERT_MODEL || process.env.OPENAI_CHAT_MODEL || 'gpt-4o';

  let hops = 0;
  let finalText = '';
  const toolTrace = [];

  while (hops < maxToolHops) {
    hops++;
    const isLastAllowedHop = hops >= maxToolHops;

    const response = await openai.chat.completions.create({
      model,
      messages: finalMessages,
      tools,
      // On the last allowed hop, force a text answer instead of another
      // tool call — guarantees the loop terminates with something to say.
      tool_choice: isLastAllowedHop ? 'none' : 'auto',
    });

    const msg = response.choices?.[0]?.message;
    if (!msg) break;

    const toolCalls = msg.tool_calls || [];

    if (!toolCalls.length) {
      finalText = msg.content || '';
      break;
    }

    finalMessages.push({
      role: 'assistant',
      content: msg.content || null,
      tool_calls: toolCalls,
    });

    for (const call of toolCalls) {
      const toolName = call.function?.name;
      let args = {};
      try {
        args = JSON.parse(call.function?.arguments || '{}');
      } catch (e) {
        args = {};
      }

      const permission = isToolAllowed({ toolName });

      let toolResult;
      if (!permission.allowed) {
        toolResult = { ok: false, error: permission.reason };
      } else {
        try {
          toolResult = await executeTool(toolName, args, { userId, prisma });
        } catch (e) {
          toolResult = { ok: false, error: `Tool execution failed: ${e.message}` };
        }
      }

      toolTrace.push({ tool: toolName, args, result: toolResult });

      finalMessages.push({
        role: 'tool',
        tool_call_id: call.id,
        // Safety cap on tool output fed back to the model — mirrors other
        // truncation points already used elsewhere in this codebase
        // (e.g. the 6000-char cap on faza5MemoryBlock).
        content: JSON.stringify(toolResult).slice(0, 8000),
      });
    }
    // loop continues — model sees the tool result(s), may call more tools
    // or produce a final answer on the next hop.
  }

  if (!finalText) {
    // Exhausted maxToolHops without ever producing a final answer — ask
    // once more with tool_choice:'none' to force text out of whatever's
    // been gathered, rather than returning nothing to the user.
    try {
      const forced = await openai.chat.completions.create({
        model,
        messages: finalMessages,
        tool_choice: 'none',
      });
      finalText = forced.choices?.[0]?.message?.content || '';
    } catch (e) {
      console.warn('[runExpertTurn] forced final-answer call failed:', e.message);
    }
  }

  // Simulated streaming — see the file header note on why this isn't true
  // token-level API streaming in this first version.
  if (finalText && typeof onToken === 'function') {
    const words = finalText.split(' ');
    words.forEach((w, i) => onToken(w + (i < words.length - 1 ? ' ' : '')));
  }

  return {
    type: 'expert_response',
    content: finalText,
    toolTrace,
    hops,
  };
}