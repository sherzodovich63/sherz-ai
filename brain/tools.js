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

    // ─────────────────────────────
    // 10) ✅ NEW (Expert Mode): CODE ANALYSIS
    // ─────────────────────────────
    {
      type: "function",
      function: {
        name: "code_analysis",
        description:
          "Checks a code snippet's syntax validity (JavaScript/TypeScript only) and returns basic structural stats (line count, rough function/class counts). Does NOT execute the code — safe for untrusted input. This is syntax validation + stats only, not a full linter or security scanner.",
        parameters: {
          type: "object",
          properties: {
            code: { type: "string", description: "The code snippet to analyze." },
            language: {
              type: "string",
              enum: ["javascript", "typescript"],
              description: "Only javascript/typescript syntax checking is currently supported. Default: javascript.",
            },
          },
          required: ["code"],
          additionalProperties: false,
        },
      },
    },

    // ─────────────────────────────
    // 11) ✅ NEW (Expert Mode): WEB FETCH
    // ─────────────────────────────
    {
      type: "function",
      function: {
        name: "web_fetch",
        description:
          "Fetches a public web page and returns its readable text content (HTML tags stripped). Blocks requests to private/internal/local network addresses. Use for looking up current information, documentation, or external data the user references.",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string", description: "Full URL to fetch, must start with http:// or https://." },
          },
          required: ["url"],
          additionalProperties: false,
        },
      },
    },
  ];
}

// ─────────────────────────────
// ✅ NEW (Expert Mode) helpers for web_fetch
// ─────────────────────────────

// Basic SSRF guard — blocks the obvious local/internal targets (localhost,
// private IP ranges, the common cloud metadata endpoint). This is a
// first-line denylist, NOT a complete SSRF defense: it doesn't resolve DNS
// to catch rebinding attacks, doesn't cover every private range, and isn't
// a substitute for real network-level egress restrictions in production.
// Good enough to block naive/accidental internal access; not a security
// boundary to rely on alone for a public-facing Expert Mode.
function isSafeFetchUrl(urlString) {
  let u;
  try {
    u = new URL(urlString);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;

  const host = u.hostname.toLowerCase();
  const blockedHosts = ["localhost", "0.0.0.0", "127.0.0.1", "169.254.169.254"];
  if (blockedHosts.includes(host)) return false;
  if (host.startsWith("127.") || host.startsWith("10.") || host.startsWith("192.168.")) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
  if (host.endsWith(".local") || host.endsWith(".internal")) return false;

  return true;
}

// Very basic HTML-to-text: strips script/style blocks and tags, decodes a
// handful of common entities, collapses whitespace. No external dependency
// — good enough for "give the model readable text", not a faithful content
// extractor (won't handle complex layouts, tables, etc. gracefully).
function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
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
    // 10) ✅ NEW (Expert Mode): CODE ANALYSIS
    // ─────────────────────────────
    case "code_analysis": {
      const code = String(args?.code || "");
      const language = String(args?.language || "javascript").toLowerCase();

      if (!code.trim()) return { ok: false, error: "code is required for code_analysis" };

      if (language !== "javascript" && language !== "typescript") {
        return {
          ok: true,
          name,
          result: {
            syntaxValid: null,
            note: `Syntax checking for '${language}' isn't supported yet — only javascript/typescript. Returned structural stats only.`,
            lineCount: code.split("\n").length,
            charCount: code.length,
          },
        };
      }

      let syntaxValid = true;
      let syntaxError = null;
      try {
        // Safe: `new Function(code)` only PARSES the code to check syntax
        // — it constructs a function object but never CALLS it, so the
        // code body never executes. Does NOT catch TypeScript-only syntax
        // (types, interfaces) — those report as syntax errors even when
        // valid TS. True TS checking would need the TypeScript compiler
        // package, not included here.
        new Function(code);
      } catch (e) {
        syntaxValid = false;
        syntaxError = e.message;
      }

      return {
        ok: true,
        name,
        result: {
          syntaxValid,
          syntaxError,
          lineCount: code.split("\n").length,
          charCount: code.length,
          roughFunctionCount: (code.match(/\bfunction\b|=>\s*{|=>\s*\(/g) || []).length,
          roughClassCount: (code.match(/\bclass\s+\w+/g) || []).length,
          todoComments: (code.match(/\/\/\s*TODO|\/\*\s*TODO/gi) || []).length,
          note: "Syntax validation + basic structural stats only — not a full linter, type-checker, or security scanner.",
        },
      };
    }

    // ─────────────────────────────
    // 11) ✅ NEW (Expert Mode): WEB FETCH
    // ─────────────────────────────
    case "web_fetch": {
      const url = String(args?.url || "").trim();
      if (!url) return { ok: false, error: "url is required for web_fetch" };

      if (!isSafeFetchUrl(url)) {
        return { ok: false, error: "URL blocked — only public http(s) URLs are allowed (no local/internal addresses)." };
      }

      const MAX_CHARS = 500000;
      const TIMEOUT_MS = 8000;

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

        const res = await fetch(url, {
          signal: controller.signal,
          redirect: "follow",
          headers: { "User-Agent": "SherzAI-ExpertMode/1.0 (+web_fetch tool)" },
        });
        clearTimeout(timer);

        if (!res.ok) {
          return { ok: false, error: `Fetch failed: HTTP ${res.status}` };
        }

        const contentType = res.headers.get("content-type") || "";
        const raw = await res.text();
        const capped = raw.slice(0, MAX_CHARS);

        const isHtml = contentType.includes("text/html");
        const text = isHtml ? stripHtml(capped) : capped;
        const excerpt = text.slice(0, 4000);

        return {
          ok: true,
          name,
          result: {
            url,
            contentType,
            excerpt,
            truncated: text.length > 4000,
          },
        };
      } catch (e) {
        const timedOut = e.name === "AbortError";
        return { ok: false, error: timedOut ? "Fetch timed out" : `Fetch error: ${e.message}` };
      }
    }

    // ─────────────────────────────
    // DEFAULT
    // ─────────────────────────────
    default:
      return { ok: false, error: `Unknown tool: ${name}` };
      
    }

}