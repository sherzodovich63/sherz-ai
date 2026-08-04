// brain/skillsRouter.js (ESM) — rule-based skill router

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import tz from 'dayjs/plugin/timezone.js';
import { addTodo, listTodos, completeTodo, deleteTodo, updateTodo } from './todoService.js';

dayjs.extend(utc);
dayjs.extend(tz);

const DEFAULT_TZ = process.env.DEFAULT_TZ || 'Asia/Tashkent';

// ───────── YORDAMCHI FUNKSIYA: REMINDER VAQTINI PARSE QILISH ─────────

function parseReminderTime(originalText, tzName) {
  const now = dayjs().tz(tzName);
  const lower = (originalText || '')
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .trim();

  let dt = null;
  let reason = '';

  // 1) "yarim soatdan keyin"
  if (/yarim\s*soat(dan)?\s*keyin/.test(lower)) {
    dt = now.add(30, 'minute');
    reason = '30 daqiqadan keyin';
  }

  // 2) "X daqiqadan keyin"
  if (!dt) {
    const m = lower.match(/(\d+)\s*daqiqadan\s*keyin/);
    if (m) {
      const mins = parseInt(m[1], 10);
      dt = now.add(mins, 'minute');
      reason = `${mins} daqiqadan keyin`;
    }
  }

  // 3) "X soatdan keyin"
  if (!dt) {
    const m = lower.match(/(\d+)\s*soat(dan)?\s*keyin/);
    if (m) {
      const hours = parseInt(m[1], 10);
      dt = now.add(hours, 'hour');
      reason = `${hours} soatdan keyin`;
    }
  }

  // 4) "soat 3 da", "soat 15:30 da" va hokazo
  if (!dt) {
    const m = lower.match(/soat\s+(\d{1,2})([:\.](\d{1,2}))?\s*da/);
    if (m) {
      let hour = parseInt(m[1], 10);
      let minute = m[3] ? parseInt(m[3], 10) : 0;

      if (hour >= 0 && hour <= 23 && minute >= 0 && minute < 60) {
        let candidate = now
          .hour(hour)
          .minute(minute)
          .second(0)
          .millisecond(0);

        // Agar bugungi shu vaqt allaqachon o'tgan bo'lsa -> ertaga
        if (candidate.isBefore(now.add(1, 'minute'))) {
          candidate = candidate.add(1, 'day');
        }

        dt = candidate;
        reason = `soat ${hour.toString().padStart(2, '0')}:${minute
          .toString()
          .padStart(2, '0')} da`;
      }
    }
  }

  // 5) Hech narsa topilmasa: default +10 min
  if (!dt) {
    dt = now.add(10, 'minute');
    reason = 'default: 10 daqiqadan keyin';
  }

  return {
    scheduledFor: dt.toDate(),
    reason,
  };
}

// ───────── DETECT SKILL ─────────

export async function detectSkill({ userId = 'LOCAL_USER', text }) {
  if (!text || typeof text !== 'string') return null;

  const raw = text.toLowerCase().trim();
  // turli apostroflarni normalize qilamiz
  const lower = raw.replace(/[’`]/g, "'");

  // ✅ FAZA 5: CONTINUE_FROM_LAST (NEW)
  // "qayerda qolgan edik?", "davom ettiraylik", "continue" va h.k.
  if (
    lower.includes('qayerda qolgan') ||
    lower.includes('qayerda qolgandik') ||
    lower.includes('qayerdan davom') ||
    lower.includes('davom ettir') ||
    lower.includes('davom etaylik') ||
    lower.includes('davom etamiz') ||
    lower.includes('continue_from_last') ||
    lower.includes('where did we leave off') ||
    lower === 'continue'
  ) {
    return { name: 'continue_from_last', args: {}, raw: 'rule:continue_from_last' };
  }

  // 1) VAQT
  if (
    lower.includes('soat nechchi') ||
    lower.includes('hozir soat') ||
    lower.includes('vaqt nechchi') ||
    lower.includes('time now') ||
    lower.includes('current time')
  ) {
    return { name: 'get_time', args: {}, raw: 'rule:get_time' };
  }

  // 2) TODO ADD
  const todoAddMatch =
    lower.match(/todo\s*:(.+)/i) ||
    lower.match(/vazifa\s*:(.+)/i) ||
    lower.match(/eslat(ma)?\s+(.+)/i);
  if (todoAddMatch) {
    const textPart = (todoAddMatch[1] || todoAddMatch[2] || '').trim();
    if (textPart) {
      return {
        name: 'add_todo',
        args: { text: textPart },
        raw: 'rule:add_todo',
      };
    }
  }

  // 3) TODO LIST
  if (
    lower.includes('todo larim') ||
    lower.includes('todo list') ||
    lower.includes('vazifalarim') ||
    lower.includes("ro'yxatim") ||
    lower.includes('tasklarim') ||
    lower.includes('vazifalar ro‘yxati') ||
    lower.includes('vazifalar royxati')
  ) {
    return {
      name: 'list_todos',
      args: { includeDone: false, limit: 20 },
      raw: 'rule:list_todos',
    };
  }

  // 3.1) TODO COMPLETE / DELETE
  // Matndan birinchi raqamni todo id deb olamiz: "3-todo", "todo 5 ni tugatdim" va hokazo
  const idMatch = lower.match(/\b(\d+)\b/);
  const todoId = idMatch ? Number(idMatch[1]) : undefined;

  if (
    todoId &&
    lower.includes('todo') &&
    (lower.includes('tugatdim') ||
      lower.includes('bajarildi') ||
      lower.includes('yakunladim') ||
      lower.includes('done'))
  ) {
    return {
      name: 'complete_todo',
      args: { id: todoId },
      raw: 'rule:complete_todo',
    };
  }

  if (
    todoId &&
    lower.includes('todo') &&
    (lower.includes("o'chir") ||
      lower.includes('ochir') ||
      lower.includes('delete') ||
      lower.includes('remove'))
  ) {
    return {
      name: 'delete_todo',
      args: { id: todoId },
      raw: 'rule:delete_todo',
    };
  }

  // 4) REMINDER SET — soddalashtirilgan qoida:
  // gapda "eslatib" bo'lsa, reminder deb qabul qilamiz
  if (lower.includes('eslatib')) {
    return {
      name: 'set_reminder',
      args: { originalText: text },
      raw: 'rule:set_reminder',
    };
  }

  // 5) REMINDER LIST
  if (
    lower.includes('eslatmalarim') ||
    lower.includes("eslatmalar ro'yxati") ||
    lower.includes('eslatmalar royxati') ||
    lower.includes('eslatmalar') ||
    lower.includes('reminder list')
  ) {
    return {
      name: 'list_reminders',
      args: { status: 'pending', limit: 20 },
      raw: 'rule:list_reminders',
    };
  }

  // 6) MOOD LOG
  if (lower.includes('kayfiyatim')) {
    return {
      name: 'log_mood',
      args: { text },
      raw: 'rule:log_mood',
    };
  }

  // 7) JOURNAL LOG
  if (
    lower.includes('kundaligimga') ||
    lower.includes('kundaligiga') ||
    lower.includes('kundalikga') ||
    lower.includes('jurnalga yoz') ||
    lower.includes("jurnalga yozib qo'y")
  ) {
    return {
      name: 'log_journal',
      args: { text },
      raw: 'rule:log_journal',
    };
  }

  // 8) DAILY BRIEFING
  if (
    lower.includes('kunlik brifing') ||
    lower.includes('qisqacha brifing') ||
    lower.includes('bugungi kunim') ||
    lower.includes("bugungi kun bo'yicha") ||
    lower.includes('today summary')
  ) {
    return {
      name: 'daily_briefing',
      args: {},
      raw: 'rule:daily_briefing',
    };
  }

  return null;
}

// ───────── RUN SKILL ─────────

export async function runSkill({
  userId = 'LOCAL_USER',
  name,
  args = {},
  prisma,
}) {
  switch (name) {
    case 'get_time': {
      const tzName = args.timezone || DEFAULT_TZ;
      const now = dayjs().tz(tzName);
      return {
        ok: true,
        skill: name,
        data: {
          timezone: tzName,
          iso: now.toISOString(),
          formatted: now.format('YYYY-MM-DD HH:mm'),
        },
      };
    }

    // ✅ FAZA 5: CONTINUE_FROM_LAST (NEW)
    // Brain.js har javobdan keyin fact(key='last_state') ga qisqa holat saqlab boradi.
    case 'continue_from_last': {
      if (!prisma) return { ok: false, skill: name, error: 'PRISMA_NOT_AVAILABLE' };
      if (!prisma?.fact?.findFirst) return { ok: false, skill: name, error: 'FACT_MODEL_NOT_AVAILABLE' };

      const row = await prisma.fact.findFirst({
        where: { userId, key: 'last_state' },
        orderBy: { updatedAt: 'desc' },
      });

      const lastState = (row?.value || '').toString().trim();

      if (!lastState) {
        return {
          ok: true,
          skill: name,
          data: {
            found: false,
            message:
              "Oxirgi holat hali saqlanmagan. Qaysi mavzuda/FAZA’da turgandik? (masalan: FAZA 5 memoryRAG, yoki qaysi file?)",
          },
        };
      }

      return {
        ok: true,
        skill: name,
        data: {
          found: true,
          lastState,
          updatedAt: row?.updatedAt || null,
          message: "Mana oxirgi holat. Shu joydan davom etamiz:",
        },
      };
    }

    case 'add_todo': {
      if (!prisma)
        return { ok: false, skill: name, error: 'PRISMA_NOT_AVAILABLE' };
      const text = (args.text || '').toString().trim();
      if (!text) return { ok: false, skill: name, error: 'EMPTY_TEXT' };
      const todo = await addTodo(prisma, userId, text);
      return {
        ok: true,
        skill: name,
        data: { todo, message: 'Todo created' },
      };
    }

    case 'list_todos': {
      if (!prisma)
        return { ok: false, skill: name, error: 'PRISMA_NOT_AVAILABLE' };
      const includeDone = Boolean(args.includeDone);
      const limit = Number(args.limit || 20);
      const todos = await listTodos(prisma, userId, { includeDone, limit });
      return {
        ok: true,
        skill: name,
        data: { todos, count: todos.length },
      };
    }

    // ✅ TODO COMPLETE
    case 'complete_todo': {
      if (!prisma)
        return { ok: false, skill: name, error: 'PRISMA_NOT_AVAILABLE' };

      const rawId = args.id ?? args.todoId;
      const idNum = Number(rawId);
      if (!idNum || Number.isNaN(idNum)) {
        return { ok: false, skill: name, error: 'INVALID_TODO_ID' };
      }

      const done = typeof args.done === 'boolean' ? args.done : true;
      const todo = await completeTodo(prisma, userId, idNum, done);

      return {
        ok: true,
        skill: name,
        data: {
          todo,
          message: done ? 'Todo completed' : 'Todo marked as not done',
        },
      };
    }

    // ✏️ TODO UPDATE
    case 'update_todo': {
      if (!prisma)
        return { ok: false, skill: name, error: 'PRISMA_NOT_AVAILABLE' };

      const rawId = args.id ?? args.todoId;
      const idNum = Number(rawId);
      if (!idNum || Number.isNaN(idNum)) {
        return { ok: false, skill: name, error: 'INVALID_TODO_ID' };
      }

      const newText = (args.text || args.newText || '').toString().trim();
      if (!newText) {
        return { ok: false, skill: name, error: 'EMPTY_TEXT' };
      }

      const todo = await updateTodo(prisma, userId, idNum, newText);

      return {
        ok: true,
        skill: name,
        data: {
          todo,
          message: 'Todo updated',
        },
      };
    }

    // 🗑 TODO DELETE
    case 'delete_todo': {
      if (!prisma)
        return { ok: false, skill: name, error: 'PRISMA_NOT_AVAILABLE' };

      const rawId = args.id ?? args.todoId;
      const idNum = Number(rawId);
      if (!idNum || Number.isNaN(idNum)) {
        return { ok: false, skill: name, error: 'INVALID_TODO_ID' };
      }

      const result = await deleteTodo(prisma, userId, idNum);

      return {
        ok: true,
        skill: name,
        data: {
          deletedCount: result.deletedCount,
          message:
            result.deletedCount > 0
              ? 'Todo deleted'
              : 'Todo not found or already deleted',
        },
      };
    }

    case 'set_reminder': {
      if (!prisma)
        return { ok: false, skill: name, error: 'PRISMA_NOT_AVAILABLE' };

      const tzName = args.timezone || DEFAULT_TZ;
      const originalText = (args.originalText || '').toString().trim();

      // To'liq gapni eslatma matni sifatida saqlaymiz
      const text = originalText || 'Eslatma';

      // ⏰ Matndan vaqtni ajratib olamiz
      const { scheduledFor, reason } = parseReminderTime(originalText, tzName);

      const reminder = await prisma.reminder.create({
        data: {
          userId,
          text,
          timezone: tzName,
          scheduledFor,
          status: 'pending',
        },
      });

      return {
        ok: true,
        skill: name,
        data: {
          reminder,
          message: `Reminder created (${reason})`,
        },
      };
    }

    case 'list_reminders': {
      if (!prisma)
        return { ok: false, skill: name, error: 'PRISMA_NOT_AVAILABLE' };
      const status = (args.status || 'pending').toString();
      const limit =
        typeof args.limit === 'number'
          ? Math.min(Math.max(args.limit, 1), 50)
          : 20;

      const where = { userId };
      if (status === 'pending') where.status = 'pending';
      else if (status === 'fired') where.status = 'fired';

      const reminders = await prisma.reminder.findMany({
        where,
        orderBy: { scheduledFor: 'asc' },
        take: limit,
      });
      return {
        ok: true,
        skill: name,
        data: { reminders, count: reminders.length },
      };
    }

    case 'log_mood': {
      if (!prisma)
        return { ok: false, skill: name, error: 'PRISMA_NOT_AVAILABLE' };
      const tzName = args.timezone || DEFAULT_TZ;
      const text = (args.text || '').toString();
      const lower = text.toLowerCase();
      let mood = 'neutral';
      if (
        lower.includes('yaxshi') ||
        lower.includes("zo'r") ||
        lower.includes('zor') ||
        lower.includes('baxtli')
      ) {
        mood = 'positive';
      } else if (
        lower.includes('yomon') ||
        lower.includes('tushkun') ||
        lower.includes('charchadim') ||
        lower.includes('stress')
      ) {
        mood = 'negative';
      }

      const entry = await prisma.moodEntry.create({
        data: {
          userId,
          mood,
          note: text,
          timezone: tzName,
          loggedAt: dayjs().tz(tzName).toDate(),
        },
      });
      return {
        ok: true,
        skill: name,
        data: { moodEntry: entry },
      };
    }

    case 'log_journal': {
      if (!prisma)
        return { ok: false, skill: name, error: 'PRISMA_NOT_AVAILABLE' };
      const tzName = args.timezone || DEFAULT_TZ;
      const text = (args.text || '').toString().trim();
      if (!text) return { ok: false, skill: name, error: 'EMPTY_TEXT' };
      const entry = await prisma.journalEntry.create({
        data: {
          userId,
          title: null,
          text,
          timezone: tzName,
          loggedAt: dayjs().tz(tzName).toDate(),
        },
      });
      return {
        ok: true,
        skill: name,
        data: {
          journalEntry: {
            id: entry.id,
            loggedAt: entry.loggedAt,
            preview: entry.text.slice(0, 200),
          },
        },
      };
    }

    case 'daily_briefing': {
      if (!prisma)
        return { ok: false, skill: name, error: 'PRISMA_NOT_AVAILABLE' };
      const tzName = args.timezone || DEFAULT_TZ;
      const now = dayjs().tz(tzName);
      const startOfDay = now.startOf('day');
      const endOfDay = now.endOf('day');

      const todos = await prisma.todo.findMany({
        where: { userId, done: false },
        orderBy: { createdAt: 'asc' },
        take: 20,
      });

      const reminders = await prisma.reminder.findMany({
        where: {
          userId,
          status: 'pending',
          scheduledFor: {
            gte: startOfDay.toDate(),
            lte: endOfDay.toDate(),
          },
        },
        orderBy: { scheduledFor: 'asc' },
        take: 20,
      });

      const latestMood = await prisma.moodEntry.findFirst({
        where: {
          userId,
          loggedAt: {
            gte: startOfDay.toDate(),
            lte: endOfDay.toDate(),
          },
        },
        orderBy: { loggedAt: 'desc' },
      });

      const journalCount = await prisma.journalEntry.count({
        where: {
          userId,
          loggedAt: {
            gte: startOfDay.toDate(),
            lte: endOfDay.toDate(),
          },
        },
      });

      const summaryParts = [];
      summaryParts.push(
        `Date: ${now.format('YYYY-MM-DD')}, Time: ${now.format(
          'HH:mm',
        )}, TZ: ${tzName}.`,
      );

      if (todos.length) {
        summaryParts.push(
          `Open todos (${todos.length}): ` +
            todos
              .slice(0, 5)
              .map((t) => t.text)
              .join(' | '),
        );
      } else {
        summaryParts.push('No open todos for today.');
      }

      if (reminders.length) {
        summaryParts.push(
          `Upcoming reminders today (${reminders.length}): ` +
            reminders
              .slice(0, 5)
              .map(
                (r) =>
                  `${dayjs(r.scheduledFor).format('HH:mm')} - ${r.text}`,
              )
              .join(' | '),
        );
      } else {
        summaryParts.push('No pending reminders for the rest of the day.');
      }

      if (latestMood) {
        summaryParts.push(
          `Latest mood today: ${latestMood.mood}${
            latestMood.note
              ? ` (note: ${latestMood.note.slice(0, 100)})`
              : ''
          }`,
        );
      } else {
        summaryParts.push('No mood logged yet today.');
      }

      summaryParts.push(`Journal entries today: ${journalCount}.`);

      const summaryText = summaryParts.join('\n');

      return {
        ok: true,
        skill: name,
        data: {
          summaryText,
          todos,
          reminders,
          latestMood,
          journalCount,
        },
      };
    }

    default:
      return { ok: false, skill: name, error: 'UNKNOWN_SKILL' };
  }
}
