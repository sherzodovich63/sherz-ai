// src/brain/tools.js
import dayjs from "dayjs";

const DEFAULT_TZ = process.env.DEFAULT_TZ || "Asia/Tashkent";

export function getToolSchemas() {
  return [
    // ─────────────────────────────
    // 1) SERVER VAQTI
    // ─────────────────────────────
    {
      type: "function",
      function: {
        name: "get_server_time",
        description: "Serverning joriy vaqtini qaytaradi.",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    },

    // ─────────────────────────────
    // 2) TODO QO‘SHISH
    // ─────────────────────────────
    {
      type: "function",
      function: {
        name: "todo_add",
        description: "Yangi vazifa qo‘shadi.",
        parameters: {
          type: "object",
          properties: {
            text: { type: "string" },
          },
          required: ["text"],
          additionalProperties: false,
        },
      },
    },

    // ─────────────────────────────
    // 3) TODO RO‘YXATI
    // ─────────────────────────────
    {
      type: "function",
      function: {
        name: "todo_list",
        description: "Bajarilmagan vazifalarni qaytaradi.",
        parameters: {
          type: "object",
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 50 },
          },
          additionalProperties: false,
        },
      },
    },

    // ─────────────────────────────
    // 4) ESСLATMA QO‘SHISH (Reminder)
    // ─────────────────────────────
    {
      type: "function",
      function: {
        name: "reminder_add",
        description:
          "Yangi eslatma qo‘shadi (Server kelajakda foydalanuvchiga eslatishi uchun).",
        parameters: {
          type: "object",
          properties: {
            text: {
              type: "string",
              description: "Eslatma matni, masalan: 'Onamga telefon qil'.",
            },
            whenIso: {
              type: "string",
              description:
                "Eslatma vaqti ISO 8601 formatida, masalan '2025-12-31T21:00:00Z'.",
            },
            timezone: {
              type: "string",
              description:
                "Ixtiyoriy. IANA timezone, masalan 'Asia/Tashkent'. Saqlash uchun.",
            },
          },
          required: ["text"],
          additionalProperties: false,
        },
      },
    },

    // ─────────────────────────────
    // 5) ESСLATMALAR RO‘YXATI
    // ─────────────────────────────
    {
      type: "function",
      function: {
        name: "reminder_list",
        description: "Foydalanuvchining eslatmalarini qaytaradi.",
        parameters: {
          type: "object",
          properties: {
            status: {
              type: "string",
              enum: ["pending", "fired", "all"],
              description: "Filtr: pending | fired | all. Default: pending.",
            },
            limit: {
              type: "integer",
              minimum: 1,
              maximum: 100,
            },
          },
          additionalProperties: false,
        },
      },
    },

    // ─────────────────────────────
    // 6) KAYFIYAT LOG (Mood)
    // ─────────────────────────────
    {
      type: "function",
      function: {
        name: "mood_log",
        description:
          "Foydalanuvchining hozirgi kayfiyatini (emotion) xotiraga yozib qo‘yadi.",
        parameters: {
          type: "object",
          properties: {
            mood: {
              type: "string",
              description:
                'Qisqa holat: "baxtli", "tushkun", "stressda" va hokazo.',
            },
            note: {
              type: "string",
              description: "Ixtiyoriy izoh, sabab yoki qo‘shimcha fikr.",
            },
            timezone: {
              type: "string",
              description: "Ixtiyoriy. IANA timezone, masalan 'Asia/Tashkent'.",
            },
          },
          required: ["mood"],
          additionalProperties: false,
        },
      },
    },

    // ─────────────────────────────
    // 7) JURNAL / KUNDALIK LOG
    // ─────────────────────────────
    {
      type: "function",
      function: {
        name: "journal_log",
        description:
          "Foydalanuvchining kundalik / jurnal yozuvini saqlaydi (diary entry).",
        parameters: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Ixtiyoriy sarlavha.",
            },
            text: {
              type: "string",
              description: "Jurnal matni (uzun bo‘lishi mumkin).",
            },
            timezone: {
              type: "string",
              description: "Ixtiyoriy. IANA timezone, masalan 'Asia/Tashkent'.",
            },
          },
          required: ["text"],
          additionalProperties: false,
        },
      },
    },

    // ─────────────────────────────
    // 8) KUNLIK BRIEFING
    // ─────────────────────────────
    {
      type: "function",
      function: {
        name: "daily_briefing",
        description:
          "Bugungi todo, reminder, kayfiyat va jurnal asosida kunlik brifing uchun xom ma’lumotlarni qaytaradi.",
        parameters: {
          type: "object",
          properties: {
            timezone: {
              type: "string",
              description:
                "Ixtiyoriy. Qaysi timezone bo‘yicha bugungi kunni hisoblash. Default: server vaqti.",
            },
          },
          additionalProperties: false,
        },
      },
    },

    // ─────────────────────────────
    // 9) EMOTION REFLECT (YANGI)
    // ─────────────────────────────
    {
      type: "function",
      function: {
        name: "emotion_reflect",
        description:
          "Foydalanuvchi hissiyotini 1-2 gapda qisqa aks ettirib beradi (do‘stona, sokin).",
        parameters: {
          type: "object",
          properties: {
            emotion: {
              type: "string",
              description:
                "Aniqlangan emotion: sad/tired/stressed/angry/anxious/happy/calm/neutral va hokazo.",
            },
            intensity: {
              type: "string",
              enum: ["low", "medium", "high"],
              description: "Kuch darajasi.",
            },
            confidence: {
              type: "number",
              description: "Ishonchlilik (0..1).",
            },
            locale: {
              type: "string",
              description: "Ixtiyoriy. Masalan: 'uz', 'ru', 'en'.",
            },
          },
          required: ["emotion"],
          additionalProperties: false,
        },
      },
    },
  ];
}

// ❗ ASOSIY FUNKSIYA – tool bajarilishi
export async function executeTool(name, args, { userId, prisma }) {
  switch (name) {
    // ─────────────────────────────
    // 1) SERVER VAQTI
    // ─────────────────────────────
    case "get_server_time": {
      const now = dayjs();
      const tz = DEFAULT_TZ;

      return {
        ok: true,
        name,
        result: {
          iso: now.toISOString(),
          date: now.format("YYYY-MM-DD"),
          time: now.format("HH:mm:ss"),
          timezone: tz,
        },
      };
    }

    // ─────────────────────────────
    // 2) TODO QO‘SHISH
    // ─────────────────────────────
    case "todo_add": {
      const text = String(args?.text || "").trim();
      if (!text) return { ok: false, error: "text is required for todo_add" };

      const todo = await prisma.todo.create({
        data: { userId, text },
      });

      return {
        ok: true,
        name,
        result: {
          id: todo.id,
          text: todo.text,
          createdAt: todo.createdAt,
        },
      };
    }

    // ─────────────────────────────
    // 3) TODO RO‘YXATI
    // ─────────────────────────────
    case "todo_list": {
      const limit =
        typeof args?.limit === "number"
          ? Math.min(Math.max(args.limit, 1), 50)
          : 10;

      const todos = await prisma.todo.findMany({
        where: { userId, done: false },
        take: limit,
        orderBy: { createdAt: "desc" },
      });

      return {
        ok: true,
        name,
        result: todos,
      };
    }

    // ─────────────────────────────
    // 4) ESСLATMA QO‘SHISH
    // ─────────────────────────────
    case "reminder_add": {
      if (!prisma) return { ok: false, error: "PRISMA_NOT_AVAILABLE" };

      const text = String(args?.text || "").trim();
      const tz = String(args?.timezone || DEFAULT_TZ);

      if (!text)
        return { ok: false, error: "text is required for reminder_add" };

      let when = null;
      if (args?.whenIso) {
        const parsed = dayjs(args.whenIso);
        if (parsed.isValid()) {
          when = parsed.toDate();
        }
      }
      // Agar to'g'ri vaqt kelmasa, default: hozir + 2 daqiqa
      if (!when) {
        when = dayjs().add(2, "minute").toDate();
      }

      const reminder = await prisma.reminder.create({
        data: {
          userId,
          text,
          scheduledFor: when,
          timezone: tz,
          status: "pending",
        },
      });

      return {
        ok: true,
        name,
        result: {
          id: reminder.id,
          text: reminder.text,
          scheduledFor: reminder.scheduledFor,
          timezone: reminder.timezone,
          status: reminder.status,
          createdAt: reminder.createdAt,
        },
      };
    }

    // ─────────────────────────────
    // 5) ESСLATMALAR RO‘YXATI
    // ─────────────────────────────
    case "reminder_list": {
      if (!prisma) return { ok: false, error: "PRISMA_NOT_AVAILABLE" };

      const statusRaw = (args?.status || "pending").toString();
      const limit =
        typeof args?.limit === "number"
          ? Math.min(Math.max(args.limit, 1), 100)
          : 20;

      const where = { userId };
      if (statusRaw === "pending") where.status = "pending";
      else if (statusRaw === "fired") where.status = "fired";
      // "all" bo'lsa, where.status qo‘shmaymiz

      const reminders = await prisma.reminder.findMany({
        where,
        take: limit,
        orderBy: { scheduledFor: "asc" },
      });

      return {
        ok: true,
        name,
        result: reminders,
      };
    }

    // ─────────────────────────────
    // 6) KAYFIYAT LOG
    // ─────────────────────────────
    case "mood_log": {
      if (!prisma) return { ok: false, error: "PRISMA_NOT_AVAILABLE" };

      const mood = String(args?.mood || "").trim();
      const note = args?.note ? String(args.note).trim() : null;
      const tz = String(args?.timezone || DEFAULT_TZ);

      if (!mood) return { ok: false, error: "mood is required for mood_log" };

      const now = dayjs();

      const entry = await prisma.moodEntry.create({
        data: {
          userId,
          mood,
          note,
          timezone: tz,
          loggedAt: now.toDate(),
        },
      });

      return {
        ok: true,
        name,
        result: {
          id: entry.id,
          mood: entry.mood,
          note: entry.note,
          timezone: entry.timezone,
          loggedAt: entry.loggedAt,
        },
      };
    }

    // ─────────────────────────────
    // 7) JURNAL / KUNDALIK LOG
    // ─────────────────────────────
    case "journal_log": {
      if (!prisma) return { ok: false, error: "PRISMA_NOT_AVAILABLE" };

      const title =
        args?.title && String(args.title).trim().length > 0
          ? String(args.title).trim()
          : null;
      const text = String(args?.text || "").trim();
      const tz = String(args?.timezone || DEFAULT_TZ);

      if (!text) return { ok: false, error: "text is required for journal_log" };

      const now = dayjs();

      const entry = await prisma.journalEntry.create({
        data: {
          userId,
          title,
          text,
          timezone: tz,
          loggedAt: now.toDate(),
        },
      });

      return {
        ok: true,
        name,
        result: {
          id: entry.id,
          title: entry.title,
          preview: entry.text.slice(0, 200),
          timezone: entry.timezone,
          loggedAt: entry.loggedAt,
        },
      };
    }

    // ─────────────────────────────
    // 8) KUNLIK BRIEFING
    // ─────────────────────────────
    case "daily_briefing": {
      if (!prisma) return { ok: false, error: "PRISMA_NOT_AVAILABLE" };

      const tz = String(args?.timezone || DEFAULT_TZ);
      const now = dayjs();
      const startOfDay = now.startOf("day");
      const endOfDay = now.endOf("day");

      // Bajarilmagan TODO-lar
      const todos = await prisma.todo.findMany({
        where: { userId, done: false },
        orderBy: { createdAt: "asc" },
        take: 20,
      });

      // Bugungi pending eslatmalar
      const reminders = await prisma.reminder.findMany({
        where: {
          userId,
          status: "pending",
          scheduledFor: {
            gte: startOfDay.toDate(),
            lte: endOfDay.toDate(),
          },
        },
        orderBy: { scheduledFor: "asc" },
        take: 20,
      });

      // Bugungi eng so‘nggi kayfiyat
      const latestMood = await prisma.moodEntry.findFirst({
        where: {
          userId,
          loggedAt: {
            gte: startOfDay.toDate(),
            lte: endOfDay.toDate(),
          },
        },
        orderBy: { loggedAt: "desc" },
      });

      // Bugungi jurnal soni
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
        `Date: ${now.format("YYYY-MM-DD")}, Time: ${now.format("HH:mm")}, TZ: ${tz}.`
      );

      if (todos.length) {
        summaryParts.push(
          `Open todos (${todos.length}): ` +
            todos
              .slice(0, 5)
              .map((t) => t.text)
              .join(" | ")
        );
      } else {
        summaryParts.push("No open todos for today.");
      }

      if (reminders.length) {
        summaryParts.push(
          `Upcoming reminders today (${reminders.length}): ` +
            reminders
              .slice(0, 5)
              .map((r) =>
                [dayjs(r.scheduledFor).format("HH:mm"), "-", r.text].join(" ")
              )
              .join(" | ")
        );
      } else {
        summaryParts.push("No pending reminders for the rest of the day.");
      }

      if (latestMood) {
        summaryParts.push(
          `Latest mood today: ${latestMood.mood}${
            latestMood.note ? ` (note: ${latestMood.note.slice(0, 100)})` : ""
          }`
        );
      } else {
        summaryParts.push("No mood logged yet today.");
      }

      summaryParts.push(`Journal entries today: ${journalCount}.`);

      const summaryText = summaryParts.join("\n");

      return {
        ok: true,
        name,
        result: {
          timezone: tz,
          nowIso: now.toISOString(),
          summaryText,
          todos,
          reminders,
          latestMood,
          journalCount,
        },
      };
    }

    // ─────────────────────────────
    // 9) EMOTION REFLECT 
    // ─────────────────────────────
    case "emotion_reflect": {
      const emotion = String(args?.emotion || "neutral").toLowerCase();
      const intensity = String(args?.intensity || "medium").toLowerCase();

      const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

      const map = {
        sad: [
          "Kayfiyating tushganini sezdim.",
          "Senga hozir og‘ir bo‘layotgandek sezilyapti.",
        ],
        tired: [
          "Charchaganing sezilyapti.",
          "Hozir energiyang kamayib turgandek.",
        ],
        stressed: [
          "Senda hozir bosim ko‘paygandek sezilyapti.",
          "Stress kuchayganini sezdim.",
        ],
        angry: [
          "Hozir jahling chiqqandek sezilyapti.",
          "Ichingda g‘azab borligini sezdim.",
        ],
        anxious: [
          "Hozir xavotir kuchaygandek sezilyapti.",
          "Bir oz bezovtalik borligini sezdim.",
        ],
        happy: [
          "Kayfiyating yaxshi ekan — zo‘r!",
          "Xursandliging sezilyapti.",
        ],
        calm: [
          "Hozir sokinroq holatdasandek.",
          "O‘zingni xotirjam his qilyapsan shekilli.",
        ],
        neutral: ["Tushundim.", "Xo‘p, eshitdim."],
      };

      const base = map[emotion] || map.neutral;
      let text = pick(base);

      // intensity bo‘yicha juda yengil kuchaytirish (majburiy emas)
      if (intensity === "high" && emotion !== "neutral") {
        text = text.replace(/\.$/, "") + " — anchagina kuchli.";
      }

      return {
        ok: true,
        name,
        result: {
          text,
          emotion,
          intensity,
        },
      };
    }

    // ─────────────────────────────
    // DEFAULT
    // ─────────────────────────────
    default:
      return { ok: false, error: `Unknown tool: ${name}` };
      
    }

}