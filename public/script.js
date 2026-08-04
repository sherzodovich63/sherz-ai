// public/script.js
// ✅ $ ni qayta e’lon qilmaymiz — index.html ichida bor bo‘lsa ham ishlaydi
window.$ = window.$ || ((sel) => document.querySelector(sel));

console.log("✅ script.js loaded OK", new Date().toISOString());
window.__SHERZ_SCRIPT_OK__ = true;

function getToken() { return localStorage.getItem('token'); }
function authHeaders(extra = {}) {
  const token = getToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

// ── SHERZ TTS: speak AI responses via ElevenLabs (/api/tts) ──────────────────
// ✅ FIX: Declared at top of file so speak() is in scope for ALL callers,
//    including postChatFlow() and SSE handlers.
const TTS_ENABLED_KEY = 'sherz_tts_enabled';
let ttsEnabled = localStorage.getItem(TTS_ENABLED_KEY) !== 'false'; // default ON
let ttsAudioEl = null;  // currently playing <audio> element
let ttsAborted = false;

function updateTtsButton() {
  const btn = document.getElementById('ttsBtn');
  if (!btn) return;
  btn.textContent      = ttsEnabled ? '🔊 Ovoz: ON' : '🔇 Ovoz: OFF';
  btn.style.borderColor = ttsEnabled ? 'rgba(0,221,192,0.4)' : '';
  btn.style.color       = ttsEnabled ? 'var(--s, #00ddc0)' : '';
}

function ttsStop() {
  ttsAborted = true;
  if (ttsAudioEl) {
    try { ttsAudioEl.pause(); ttsAudioEl.src = ''; } catch {}
    ttsAudioEl = null;
  }
}

async function speak(text) {
  // Guard: disabled, empty, or already aborted
  if (!ttsEnabled)    { console.log('[tts] disabled — toggle ON with Ovoz button'); return; }
  if (!text?.trim())  { console.log('[tts] empty text, skipping'); return; }

  ttsAborted = false;
  const token = getToken();

  console.log('[tts] speak() called, chars=' + text.length + ', ttsEnabled=' + ttsEnabled);

  try {
    const res = await fetch('/api/tts', {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      body: JSON.stringify({ text: String(text).slice(0, 4000) }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.warn('[tts] HTTP ' + res.status + ':', errBody.slice(0, 200));
      return;
    }
    if (ttsAborted) { console.log('[tts] aborted before blob read'); return; }

    const blob = await res.blob();
    if (ttsAborted) { console.log('[tts] aborted after blob read'); return; }

    if (!blob || blob.size === 0) { console.warn('[tts] received empty audio blob'); return; }

    const url   = URL.createObjectURL(blob);
    const audio = new Audio(url);
    ttsAudioEl  = audio;

    audio.onended = () => { URL.revokeObjectURL(url); ttsAudioEl = null; };
    audio.onerror = (ev) => {
      console.warn('[tts] audio playback error:', ev);
      URL.revokeObjectURL(url);
      ttsAudioEl = null;
    };

    // play() requires a user gesture on first call — works after any click/keydown
    await audio.play().catch(e => {
      console.warn('[tts] play() blocked (needs user gesture?):', e.message);
    });

    console.log('[tts] ✅ playing audio, duration≈' + (audio.duration || '?') + 's');
  } catch (e) {
    console.warn('[tts] speak() error:', e.message);
  }
}

// Wire TTS toggle button + orb barge-in — runs after DOM ready
document.addEventListener('DOMContentLoaded', () => {
  updateTtsButton();

  const ttsBtn = document.getElementById('ttsBtn');
  if (ttsBtn) {
    ttsBtn.addEventListener('click', () => {
      ttsEnabled = !ttsEnabled;
      localStorage.setItem(TTS_ENABLED_KEY, String(ttsEnabled));
      if (!ttsEnabled) ttsStop();
      updateTtsButton();
      console.log('[tts] toggled:', ttsEnabled ? 'ON' : 'OFF');
    });
  }

  // Orb or orbShell click → barge-in stop
  const orb = document.getElementById('orbShell') || document.getElementById('orbCore');
  if (orb) orb.addEventListener('click', () => { if (ttsAudioEl) ttsStop(); });
}, { once: false });


const fileInput = document.getElementById('fileInput');
const attachBtn = document.getElementById('attachBtn');
// Prevyu elementlarini JS-ga bog'laymiz
const imagePreviewContainer = document.getElementById('image-preview-container');
const imagePreview = document.getElementById('image-preview');
const removeImageBtn = document.getElementById('remove-image-btn');

if (attachBtn) {
    attachBtn.addEventListener('click', () => {
        fileInput.click();
    });
}

if (fileInput) {
    fileInput.addEventListener('change', () => {
        const file = fileInput.files[0];
        if (file) {
            console.log("Rasm tanlandi:", file.name);
            
            const reader = new FileReader();
            reader.onload = (e) => {
                // 1. Rasmni prevyu elementiga joylash
                if (imagePreview) imagePreview.src = e.target.result;
                
                // 2. Prevyu panelini ko'rsatish
                if (imagePreviewContainer) {
                    imagePreviewContainer.style.display = 'block';
                }
                
                // 3. Klip belgisini yashil qilish
                if (attachBtn) attachBtn.style.color = "#4CAF50";
            };
            reader.readAsDataURL(file);
        }
    });
}

// 4. "X" tugmasini bossa rasmni o'chirish logikasi
if (removeImageBtn) {
    removeImageBtn.addEventListener('click', () => {
        fileInput.value = ""; // Faylni tozalash
        if (imagePreviewContainer) imagePreviewContainer.style.display = 'none';
        if (attachBtn) attachBtn.style.color = ""; // Rangni qaytarish
    });
}

// logging (oldingi <pre id="log"> ichiga yozadi)
const logEl = $("#log");
const log = (m) => {
  if (!logEl) return;
  logEl.textContent = (m ? m + "\n" : "") + logEl.textContent;
};

const sendBtn = $("#send");
const clearBtn = $("#clear");
const textEl = $("#text");
const userIdEl = $("#userId") || $("#uid"); // HTMLda qaysi id bo'lsa olib qo'yamiz

// =====================================================
// ✅ APP OPENING (MVP: URL allowlist) + Voice-First Intent
// =====================================================
const APP_REGISTRY = [
  {
    id: "chrome",
    title: "Chrome / Google",
    aliases: ["chrome", "xrom", "google", "gugl", "brauzer"],
    url: "https://www.google.com",
  },
  {
    id: "instagram",
    title: "Instagram",
    aliases: ["instagram", "insta", "ig"],
    url: "https://www.instagram.com",
  },
  {
    id: "telegram",
    title: "Telegram Web",
    aliases: ["telegram", "tgram", "tg", "tele"],
    url: "https://web.telegram.org",
  },
  {
    id: "yandex_music",
    title: "Yandex Music",
    aliases: ["yandex music", "yandex", "ya music", "yamusic", "yandex musik"],
    url: "https://music.yandex.ru",
  },
];

// string normalizatsiya
const norm = (s) =>
  (s || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

// =====================================================
// ✅ Voice-First: short utterance + confirm state
// =====================================================
window.__SHERZ__ = window.__SHERZ__ || {};
window.__SHERZ__.pendingAction = window.__SHERZ__.pendingAction || null;

function isYesText(t) {
  const s = norm(t);
  return /^(ha|xa|hа|ok|okay|mayli|xop|xo?p|hop|bo?pti|yes|yep|да|ага|okey)$/i.test(
    s
  );
}

function isNoText(t) {
  const s = norm(t);
  return /^(yo?q|yoq|yo‘q|yo'q|no|nah|emas|kerakmas|shartmas|нет|не)$/i.test(s);
}

// app + trigger qaytaradi: short_only | imperative | mention
function resolveAppMatchFromText(text) {
  const t = norm(text);
  if (!t) return null;

  const tokens = t.split(" ").filter(Boolean);

  // Common “open” verbs
  const openVerbs = ["och", "open", "start", "launch", "открой", "запусти"];
  const hasOpenVerb = openVerbs.some((w) => tokens.includes(w) || t.includes(w));

  // Uzbek suffixes (instagramni / instagramda / instagramga / instagramdan / instagramning)
  const suffixes = ["ni", "da", "ga", "dan", "ning"];

  for (const app of APP_REGISTRY) {
    for (const aliasRaw of app.aliases) {
      const alias = norm(aliasRaw);
      if (!alias) continue;

      // alias topildimi?
      if (!t.includes(alias)) continue;

      // token alias variant: instagram / instagramni / instagramda ...
      const tokenIsAliasVariant = (tok) => {
        if (tok === alias) return true;
        if (tok.startsWith(alias)) {
          const rest = tok.slice(alias.length);
          return rest === "" || suffixes.includes(rest);
        }
        return false;
      };

      // short utterance:
      // 1 token => instagram / instagramni / instagramda
      // 2 token => (och + instagram) yoki (instagram + och) yoki (aliasVariant + aliasVariant)
      let shortOnly = false;
      if (tokens.length === 1) {
        shortOnly = tokenIsAliasVariant(tokens[0]);
      } else if (tokens.length === 2) {
        const [a, b] = tokens;
        const isVerb = (x) => openVerbs.includes(x);
        shortOnly =
          (tokenIsAliasVariant(a) && isVerb(b)) ||
          (tokenIsAliasVariant(b) && isVerb(a)) ||
          (tokenIsAliasVariant(a) && tokenIsAliasVariant(b));
      }

      const trigger = hasOpenVerb ? "imperative" : shortOnly ? "short_only" : "mention";
      return { app, trigger };
    }
  }
  return null;
}

function openAppSafely(app) {
  try {
    // popup blocked bo‘lsa window.open null qaytarishi mumkin
    const w = window.open(app.url, "_blank", "noopener,noreferrer");
    if (!w) {
      // fallback same-tab (popup block holatida ham ishlaydi)
      window.location.href = app.url;
    }
    return { ok: true, msg: `${app.title} ochildi ✅` };
  } catch (e) {
    return { ok: false, msg: `❌ Ocholmadim: ${(e?.message || e || "").toString()}` };
  }
}

/**
 * Text buyruqni tekshiradi (Voice-First):
 * - "Instagram" (yolg‘iz) -> ochadi (short_only)
 * - "instagramni och" -> ochadi (imperative)
 * - "men instagramda ..." -> confirm so‘raydi (mention)
 *
 * Return:
 * - handled: local skillga tegishlimi
 * - ok: bajarildimi (yoki confirm bosqichida false bo‘lishi mumkin)
 * - msg: SHERZ javobi
 */
function openAppFromCommand(text) {
  text = String(text || "").trim();
  const m = resolveAppMatchFromText(text);
  if (!m) return { handled: false };

  const { app, trigger } = m;

  // 1) Explicit open intent OR short-only -> open immediately
  if (trigger === "imperative" || trigger === "short_only") {
    const r = openAppSafely(app);
    return { handled: true, ok: r.ok, msg: r.msg, action: "opened", trigger };
  }

  // 2) Mention inside sentence -> confirm required
  window.__SHERZ__.pendingAction = {
    type: "open_app",
    appId: app.id,
    createdAt: Date.now(),
    sourceText: String(text || ""),
  };

  return {
    handled: true,
    ok: false,
    msg: `${app.title} ni ochaymi? (Ha/Yo‘q)`,
    action: "confirm",
    trigger,
  };
}

// =====================================================
// ✅ Chat render (UI)
// =====================================================
const chatEl = $("#chat");
const seenIds = new Set();

/**
 * Chat bubble renderer:
 * - role: 'user' | 'assistant'
 * - text: string
 * - meta: object (proactive bo‘lsa badge qo‘yish mumkin)
 */
function addBubble(role, text, meta = {}) {
  if (!chatEl) return;

  const wrap = document.createElement("div");
  wrap.className = `bubble ${role === "user" ? "me" : "bot"}`;
  wrap.textContent = text || "";

  // Proactive badge (ixtiyoriy)
  if (meta?.proactive) {
    const m = document.createElement("div");
    m.className = "meta";
    const tone = meta?.tone ? `tone=${meta.tone}` : "";
    m.textContent = `proactive ${tone}`.trim();
    wrap.appendChild(m);
  }

  chatEl.appendChild(wrap);
  chatEl.scrollTop = chatEl.scrollHeight;
}

// UI clear helper (DOMni tozalash)
function clearChatUI() {
  if (!chatEl) return;
  chatEl.innerHTML = "";
}

// =====================================================
// ✅ Chat persistence (localStorage) — ASOSIY QISM
// =====================================================
const CHAT_KEY = (uid) =>
  `sherz_chat_v1:${String(uid || "LOCAL_USER").trim() || "LOCAL_USER"}`;

function loadChat(uid) {
  try {
    const raw = localStorage.getItem(CHAT_KEY(uid));
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveChat(uid, arr) {
  try {
    localStorage.setItem(CHAT_KEY(uid), JSON.stringify(arr || []));
  } catch (e) {
    log("storage save error: " + (e?.message || e));
  }
}

function clearChatStorage(uid) {
  try {
    localStorage.removeItem(CHAT_KEY(uid));
  } catch {}
}

// Saqlanadigan message list
let MESSAGES = [];

// Yagona id generator
function makeMsgId(role, createdAt, content) {
  const safe = String(content || "").slice(0, 60);
  return `${role || "assistant"}:${createdAt || Date.now()}:${safe}`;
}

// ✅ storage’ga yozish (seenIds bilan dublikatni to‘xtatamiz)
function persistMessage(role, content, meta = {}, createdAt = null, id = null) {
  const uid = getCurrentUserId(); // ✅ FIX: use JWT-backed userId, not dead HTML input
  const ts = createdAt || Date.now();
  const msgId = id || makeMsgId(role, ts, content);

  if (seenIds.has(msgId)) return null;
  seenIds.add(msgId);

  const msg = {
    id: msgId,
    role: role || "assistant",
    content: String(content || ""),
    createdAt: ts,
    meta: meta || {},
  };

  MESSAGES.push(msg);

  // limit
  if (MESSAGES.length > 250) MESSAGES = MESSAGES.slice(-250);

  saveChat(uid, MESSAGES);
  return msg;
}

// ✅ Storage’dan tiklash va UI’ga chizish
function restoreChatFromStorage() {
  const uid = getCurrentUserId(); // ✅ FIX: use JWT-backed userId
  MESSAGES = loadChat(uid);

  clearChatUI();
  if (typeof seenIds.clear === "function") seenIds.clear();

  if (!MESSAGES?.length) return;

  for (const m of MESSAGES) {
    const id = m?.id || makeMsgId(m?.role, m?.createdAt, m?.content);
    seenIds.add(id);
    addBubble(m.role || "assistant", m.content || "", m.meta || {});
  }

  log(`✅ restored ${MESSAGES.length} msgs from localStorage (${uid})`);
}

// =====================================================
// ✅ SSE (Proactive / realtime) — YANGI QISM
// =====================================================
let __sse = null;

function getCurrentUserId() {
  // ✅ FIX: read userId from the stored JWT user object, not a dead HTML input
  try {
    const raw = localStorage.getItem('sherz_user') || localStorage.getItem('user');
    if (raw) {
      const u = JSON.parse(raw);
      if (u?.id && u.id !== 'anonymous') return u.id;
    }
  } catch {}
  // Dev fallback: if dev-token endpoint set token but not user object, decode it
  const token = getToken();
  if (token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (payload?.id && payload.id !== 'anonymous') return payload.id;
    } catch {}
  }
  return 'u1'; // last-resort dev fallback
}

function closeSSE() {
  try {
    if (__sse) {
      __sse.close();
      __sse = null;
      log("🛑 SSE closed");
    }
  } catch {}
}

/**
 * Serverdan keladigan payload formatlari har xil bo‘lishi mumkin.
 * Biz robust parse qilamiz:
 * - role: 'assistant' default
 * - content/text/message/reply -> text
 * - id -> unique key
 * - createdAt -> timestamp/iso
 * - meta -> extra
 */
function normalizeIncomingSsePayload(data) {
  if (!data || typeof data !== "object") return null;

  const role = data.role || data.sender || "assistant";

  const content =
    data.content ??
    data.text ??
    data.message ??
    data.reply ??
    data.preview ??
    "";

  // createdAt: ISO bo‘lsa Date.parse qilamiz, number bo‘lsa ishlatamiz
  let createdAt = data.createdAt ?? data.ts ?? data.time ?? null;
  if (typeof createdAt === "string") {
    const t = Date.parse(createdAt);
    createdAt = Number.isNaN(t) ? Date.now() : t;
  } else if (typeof createdAt !== "number") {
    createdAt = Date.now();
  }

  // meta
  const meta = {
    ...(data.meta || {}),
    proactive:
      Boolean(data.meta?.proactive) ||
      Boolean(data.proactive) ||
      Boolean(data.isProactive),
    tone: data.tone || data.meta?.tone,
    source: "sse",
    event: data.eventName || data.event || "message",
  };

  // id bo‘lmasa deterministic id yasab olamiz
  const id =
    data.id ||
    data.msgId ||
    data.messageId ||
    makeMsgId(role, createdAt, content);

  return { id, role, content: String(content || ""), createdAt, meta };
}

function startSSE() {
  // eski SSE bo‘lsa yopamiz
  closeSSE();

  const uid = getCurrentUserId();
  const url = `/api/stream?userId=${encodeURIComponent(uid)}`;

  try {
    __sse = new EventSource(url);
  } catch (e) {
    log("⚠️ SSE init error: " + (e?.message || e));
    __sse = null;
    return;
  }

  log("✅ SSE connecting: " + url);

  __sse.addEventListener("open", () => {
    log("✅ SSE connected");
  });

  // Default event "message"
  __sse.addEventListener("message", (ev) => {
    try {
      const raw = ev?.data;
      if (!raw) return;

      const parsed = JSON.parse(raw);
      const n = normalizeIncomingSsePayload(parsed);
      if (!n) return; 

      // ✅ UI + storage
      if (n.content) {
        addBubble(n.role, n.content, n.meta);
        persistMessage(n.role, n.content, n.meta, n.createdAt, n.id);
      }
    } catch (e) {
      log("⚠️ SSE parse error: " + (e?.message || e));
    }
  });

  // Agar server custom event yuborsa ham ushlab qolamiz:
const customEvents = ["proactive", "ping", "notify", "update"];
customEvents.forEach((evt) => {
  __sse.addEventListener(evt, (ev) => {
    try {
      const parsed = JSON.parse(ev.data);
      
      // ✅ Proactive runnerdan kelayotgan ma'lumotni to'g'ri formatga o'tkazish
      const n = normalizeIncomingSsePayload({
        ...parsed,
        role: 'assistant',  // Proactive xabarlar har doim botdan keladi
        event: evt,
        proactive: evt === "proactive"
      });

      if (n && n.content) {
        // UI ga chiqarish
        addBubble(n.role, n.content, n.meta);
        // Brauzer xotirasiga saqlash (sahifa yangilanganda yo'qolmasligi uchun)
        persistMessage(n.role, n.content, n.meta, n.createdAt, n.id);
        
        console.log(`🚀 Sherzdan ${evt} xabari qabul qilindi va UI ga qo'shildi.`);
      }
    } catch (e) {
      log(`⚠️ SSE ${evt} parse error: ` + (e?.message || e));
    }
  });
});

  __sse.addEventListener("error", () => {
    log("⚠️ SSE error (auto-retry)");
  });
}

// =====================================================
// ✅ LOCAL COMMAND HANDLER (open-app) — UI + storage bilan
// =====================================================
function handleLocalCommand(text) {
  const userId = getCurrentUserId();
  const now = Date.now();
  const input = String(text || "").trim();
  if (!input) return false;

  // ---------------------------
  // 0) CONFIRM FLOW (pendingAction)
  // ---------------------------
  if (window.__SHERZ__.pendingAction) {
    // Timeout (optional): 20s
    const age = Date.now() - (window.__SHERZ__.pendingAction.createdAt || 0);
    if (age > 20000) {
      window.__SHERZ__.pendingAction = null;
      // continue normal processing
    } else {
      // user message UI + storage
      addBubble("user", input, {});
      persistMessage("user", input, { from: "ui", confirm: true }, now);

      if (isYesText(input)) {
        const act = window.__SHERZ__.pendingAction;
        window.__SHERZ__.pendingAction = null;

        if (act.type === "open_app") {
          const app = APP_REGISTRY.find((a) => a.id === act.appId);
          if (!app) {
            const msg = "❌ App topilmadi (registry).";
            addBubble("assistant", msg, { from: "local/confirm" });
            persistMessage(
              "assistant",
              msg,
              { from: "local/confirm", ok: false },
              Date.now()
            );
            return true;
          }

          const r2 = openAppSafely(app);
          addBubble("assistant", r2.msg, { from: "local/confirm" });
          persistMessage(
            "assistant",
            r2.msg,
            { from: "local/confirm", ok: Boolean(r2.ok) },
            Date.now()
          );
          log(
            `🧩 confirm(open_app): ok=${Boolean(r2.ok)} | ${r2.msg} | uid=${userId}`
          );
          return true;
        }
      }

      if (isNoText(input)) {
        window.__SHERZ__.pendingAction = null;
        const msg = "Xo‘p, ochmayman ✅";
        addBubble("assistant", msg, { from: "local/confirm" });
        persistMessage(
          "assistant",
          msg,
          { from: "local/confirm", ok: true },
          Date.now()
        );
        log(`🧩 confirm(cancel): ${msg} | uid=${userId}`);
        return true;
      }

      // Not a yes/no -> let it go to normal chat (LLM)
      // (pendingAction saqlanib turadi)
      return false;
    }
  }

  // ---------------------------
  // 1) NORMAL LOCAL SKILL (voice-first open-app)
  // ---------------------------
  const r = openAppFromCommand(input);
  if (!r?.handled) return false;

  // user message’ni UI + storage
  addBubble("user", input, {});
  persistMessage(
    "user",
    input,
    { from: "ui", localSkill: "open_app", trigger: r.trigger || "n/a" },
    now
  );

  // assistant reply’ni UI + storage
  addBubble("assistant", r.msg, { from: "local/open_app" });
  persistMessage(
    "assistant",
    r.msg,
    {
      from: "local/open_app",
      ok: Boolean(r.ok),
      action: r.action || "n/a",
      trigger: r.trigger || "n/a",
    },
    Date.now()
  );

  log(
    `🧩 local(open_app): action=${r.action || "n/a"} ok=${
      r.ok ? "true" : "false"
    } trigger=${r.trigger || "n/a"} | ${r.msg} | uid=${userId}`
  );
  return true;
}

// =====================================================
// Clear button
// =====================================================
if (clearBtn) {
  clearBtn.addEventListener("click", () => {
    if (logEl) logEl.textContent = "";
    if (textEl) textEl.value = "";

    const uid = getCurrentUserId();
    MESSAGES = [];
    if (typeof seenIds.clear === "function") seenIds.clear();
    clearChatUI();
    clearChatStorage(uid);

    // pending confirm ham tozalanadi
    window.__SHERZ__.pendingAction = null;

    log(`🧹 cleared chat storage (${uid})`);
  });
}

// =====================================================
// ✅ Send flow (POST /api/chat)
// =====================================================
async function postChatFlow() {
    // ✅ FIX: look up the element live every call instead of relying on the
    // top-level `textEl` const (captured once at script-load time, line 172).
    // If the DOM wasn't fully ready when that const ran, or the element gets
    // re-rendered, `textEl` goes stale and this alert fires forever —
    // including every time the mic's onend handler calls postChatFlow().
    const textEl = document.getElementById('text');
    if (!textEl) return alert("Text element topilmadi");

    const userId = getCurrentUserId();
    const text = (textEl.value || "").trim();

    // 1. Tanlangan rasmni olish
    const file = (typeof fileInput !== 'undefined' && fileInput.files) ? fileInput.files[0] : null;
    let imageData = null;

    if (file) {
        imageData = await toBase64(file);
    }

    if (!text && !imageData) return;

    try {
        sendBtn?.setAttribute("disabled", "");

        // User xabarini UI ga chiqarish
        addBubble("user", text || "Rasm yuborildi", {});
        persistMessage("user", text || "", { from: "ui" }, Date.now());

        textEl.value = ""; 
        log("-> /api/chat ...");

        // 2. Serverga yuborish
        const r = await fetch("/api/chat", {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({
                userId,
                message: text,
                image: imageData,
                locale: "uz",
                temperature: 0.6,
            }),
        });

        // Tanlangan fayllarni tozalash
        if (typeof fileInput !== 'undefined') fileInput.value = "";
        if (typeof attachBtn !== 'undefined') attachBtn.style.color = "";

        const j = await r.json().catch(() => ({ ok: false, error: "chat json parse error" }));
        log("<- " + JSON.stringify(j, null, 2));

        if (j?.ok) {
            // ✅ FIX: also check j.said (handle-intent returns { said }, /api/chat proxies to { reply })
            const reply = String(j.reply || j.said || "").trim();
            if (reply) {
                addBubble("assistant", reply, { from: "api/chat" });
                persistMessage("assistant", reply, { from: "api/chat" }, Date.now());
                // ✅ TTS: fire after UI update, don't await so UI isn't blocked
                speak(reply).catch(e => console.warn('[tts] speak failed:', e.message));
            } else {
                console.warn('[postChatFlow] j.ok=true but reply is empty. Full response:', j);
            }
        } else {
            const errText = j?.error || "chat failed";
            console.warn('[postChatFlow] server error:', errText, j);
            addBubble("assistant", "❌ " + errText, { error: true });
        }
    } catch (e) {
        log("! Error: " + e.message);
        addBubble("assistant", "❌ Xatolik: " + e.message, { error: true });
    } finally {
        sendBtn?.removeAttribute("disabled");
    }
}
if (sendBtn) sendBtn.addEventListener("click", postChatFlow);

// ✅ Enter bosganda yuborish (Shift+Enter = newline)
if (textEl) {
  textEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      postChatFlow();
    }
  });
}

// 1. Rasmni Base64 formatiga o'tkazuvchi funksiya
function toBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}

// ✅ FIX: duplicate postChatFlow removed (was overwriting the full-featured version above)

// =====================================================
// 🎤 Mic (Chrome Web Speech API) — voice-first local skill
// =====================================================
// ── Audio context unlocker ─────────────────────────────────────────────────
// Browser policy: audio can only play after a user gesture. The mic button
// click IS a user gesture, so we unlock the AudioContext there — before the
// async TTS chain fires — so the very first SHERZ reply always plays.
// Called once from startRec() and also wired to first click/keydown on doc.
let _audioUnlocked = false;
function unlockAudio() {
  if (_audioUnlocked) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    // Resume the context (needed in some Chrome versions)
    if (ctx.state === 'suspended') ctx.resume();
    // Play a zero-duration silent buffer — this is the canonical unlock trick
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
    src.onended = () => ctx.close();
    _audioUnlocked = true;
    console.log('[audio] AudioContext unlocked by user gesture');
  } catch (e) {
    console.warn('[audio] unlock failed (non-fatal):', e.message);
  }
}
// Also unlock on any first interaction, as a safety net
['click', 'keydown', 'touchstart'].forEach(evt =>
  document.addEventListener(evt, unlockAudio, { once: true, passive: true })
);

// ═══════════════════════════════════════════════════════════════════════════
// 🎤 MIC — Web Speech API with persistent recognizer + graceful error handling
// ✅ FIX: Single recognizer instance (no rapid start/stop), lang fallback,
//    human-readable network error messages, auto-send on result
// ═══════════════════════════════════════════════════════════════════════════
(function setupMic() {
  const micBtn  = document.getElementById('mic')  || document.getElementById('mic2');
  const stopBtn = document.getElementById('micStop');
  if (!micBtn) return;

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    micBtn.disabled = true;
    micBtn.title    = "SpeechRecognition yo'q — Chrome ishlatib ko'ring";
    console.warn('[mic] SpeechRecognition not supported');
    return;
  }

  // ✅ Single persistent instance — avoids rapid start/stop race conditions
  const rec = new SR();
  rec.lang            = 'uz-UZ'; // Chrome Speech API — requires internet
  rec.interimResults  = true;    // show partial results in textarea
  rec.continuous      = false;
  rec.maxAlternatives = 1;

  let isListening  = false;
  let networkRetry = 0;         // counts consecutive 'network' errors
  const MAX_NETWORK_RETRY = 3;  // stop auto-retrying after this many attempts
  let retryTimer = null;        // holds the setTimeout reference so we can cancel it

  const setListening = (on) => {
    isListening = on;
    micBtn.style.color       = on ? '#4ade80' : '';
    micBtn.style.borderColor = on ? 'rgba(74,222,128,0.5)' : '';
    if (stopBtn) stopBtn.style.display = on ? 'inline-flex' : 'none';
  };

  // ── Start recognition (shared by click handler + auto-retry) ──────────────
  function startRec() {
    if (isListening) return;
    unlockAudio(); // ✅ user gesture is here — warm AudioContext before async TTS fires
    try {
      rec.start();
    } catch (e) {
      // "already started" race — ignore silently; the current session is fine
      if (!String(e.message).includes('already started')) {
        console.warn('[mic] start() error:', e.message);
        log('🎤 Mic xatosi: ' + e.message);
        setListening(false);
      }
    }
  }

  micBtn.addEventListener('click', () => {
    // Manual click: reset retry counter so the user always gets a fresh attempt
    clearTimeout(retryTimer);
    networkRetry = 0;
    if (isListening) {
      try { rec.stop(); } catch {}
    } else {
      startRec();
    }
  });

  if (stopBtn) stopBtn.addEventListener('click', () => {
    clearTimeout(retryTimer);
    networkRetry = 0;
    try { rec.stop(); } catch {}
  });

  rec.onstart = () => { setListening(true); log('🎤 Tinglayapman...'); };

  rec.onresult = (e) => {
    // A successful result resets the network-error counter
    networkRetry = 0;
    const taEl = document.getElementById('text');
    if (!taEl) return;
    let interim = '', final = '';
    for (const result of e.results) {
      if (result.isFinal) final += result[0].transcript;
      else interim += result[0].transcript;
    }
    taEl.value = (final || interim).trim();
    log('🎤 ' + (final ? '✅ ' : '⏳ ') + taEl.value);
  };

  rec.onend = () => {
    setListening(false);
    const taEl = document.getElementById('text');
    if (taEl && taEl.value.trim()) {
      const transcript = taEl.value.trim();
      if (!handleLocalCommand(transcript)) {
        postChatFlow();
      } else {
        taEl.value = '';
      }
    }
  };

  rec.onerror = (e) => {
    setListening(false);

    // ── 'network' — auto-retry with exponential backoff ──────────────────────
    // The Web Speech API throws 'network' transiently on localhost when Chrome's
    // speech service hiccups. Most of the time a retry 1–2 seconds later succeeds.
    // We retry up to MAX_NETWORK_RETRY times, then surface a human-readable message.
    if (e.error === 'network') {
      networkRetry += 1;
      if (networkRetry <= MAX_NETWORK_RETRY) {
        const delay = networkRetry * 1200; // 1.2s, 2.4s, 3.6s
        log(`🎤 Tarmoq xatosi — ${delay / 1000}s dan so'ng qayta uriniladi (${networkRetry}/${MAX_NETWORK_RETRY})...`);
        console.warn(`[mic] network error — retry ${networkRetry}/${MAX_NETWORK_RETRY} in ${delay}ms`);
        retryTimer = setTimeout(() => {
          if (!isListening) startRec();
        }, delay);
        return; // don't show the error message yet — try silently first
      }
      // All retries exhausted — now tell the user
      networkRetry = 0;
      log(
        "🎤 Mic xatosi: tarmoq muammosi (Google Speech API localhost'da ba'zida ishlamaydi). " +
        "VPN tekshiring yoki Chrome'da chrome://flags/#unsafely-treat-insecure-origin-as-secure ni yoqing."
      );
      console.warn('[mic] network error — all retries exhausted');
      return;
    }

    // ── All other errors — show immediately, no retry ────────────────────────
    const ERRORS = {
      'not-allowed':
        '🎤 Mic ruxsati rad etildi — brauzer sozlamalarida mikrofonga ruxsat bering',
      'no-speech':
        "🎤 Ovoz aniqlanmadi — qayta urinib ko'ring",
      'audio-capture':
        "🎤 Mikrofon topilmadi — qurilma ulanganligini tekshiring",
      'aborted':
        null, // silent — usually caused by our own rec.stop() call
      'language-not-supported':
        "🎤 uz-UZ qo'llab-quvvatlanmaydi — ru-RU ga o'tkazilmoqda...",
    };

    const msg = ERRORS[e.error] !== undefined
      ? ERRORS[e.error]
      : ('🎤 Mic xatosi: ' + e.error);

    if (msg) log(msg);
    console.warn('[mic] SpeechRecognition error:', e.error, e.message || '');

    if (e.error === 'language-not-supported') {
      rec.lang = 'ru-RU';
      log("🎤 uz-UZ -> ru-RU ga o'zgartirildi, qayta bosing");
    }
  };
})();

// =====================================================
// Page load: storage’dan tiklash + SSE start
// =====================================================
document.addEventListener("DOMContentLoaded", () => {
  // ✅ storage restore
  restoreChatFromStorage();

  // ✅ SSE start (proactive realtime)
  startSSE();

  // userId o‘zgarsa: storage + SSE qayta
  if (userIdEl) {
    userIdEl.addEventListener("change", () => {
      restoreChatFromStorage();
      startSSE();
    });
  }
});

// Sahifa yopilganda SSE ni toza yopamiz
window.addEventListener("beforeunload", () => {
  closeSSE();
});

// ===============================
// FORCE SEND → postChatFlow
// ===============================
(function () {
  const oldBtn = document.querySelector("#send");
  if (!oldBtn) return;

  const newBtn = oldBtn.cloneNode(true);
  oldBtn.parentNode.replaceChild(newBtn, oldBtn);

  newBtn.onclick = null;

  newBtn.addEventListener(
    "click",
    function (e) {
      e.preventDefault();
      e.stopPropagation();
      postChatFlow();
    },
    true
  );

  console.log("✅ send rebound to postChatFlow only");

const fileInput = document.getElementById("fileInput");
const attachBtn = document.getElementById("attachBtn");
const previewContainer = document.getElementById("image-preview-container");
const previewImage = document.getElementById("image-preview");
const removeBtn = document.getElementById("remove-image-btn");

attachBtn.addEventListener("click", () => {
  fileInput.click();
});

fileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];

  if (file) {
    const url = URL.createObjectURL(file);
    previewImage.src = url;
    previewContainer.style.display = "block";
  }
});

removeBtn.addEventListener("click", () => {
  previewImage.src = "";
  previewContainer.style.display = "none";
  fileInput.value = "";
});
// ── Google OAuth: catch ?token= from redirect ─────────────────────────────
(function catchOAuthRedirect() {
  const params = new URLSearchParams(window.location.search);
  const oauthToken = params.get('token');
  const authError  = params.get('auth_error');
  if (oauthToken) {
    localStorage.setItem('token', oauthToken);
    // Decode user from JWT payload and store for getCurrentUserId()
    try {
      const payload = JSON.parse(atob(oauthToken.split('.')[1]));
      localStorage.setItem('sherz_user', JSON.stringify({ id: payload.id, email: payload.email, name: payload.name }));
      console.log('✅ Google login successful, user:', payload.name || payload.email);
    } catch {}
    // Clean URL without reloading
    window.history.replaceState({}, document.title, window.location.pathname);
  }
  if (authError) {
    console.error('❌ Google auth error:', decodeURIComponent(authError));
    window.history.replaceState({}, document.title, window.location.pathname);
  }
})();

async function ensureToken() {
  // Already have a valid token
  if (getToken()) return true;
  try {
    const res  = await fetch('/api/auth/dev-token', { method: 'POST' });
    const data = await res.json();
    if (data.token) {
      localStorage.setItem('token', data.token);
      // Store user object so getCurrentUserId() works immediately
      if (data.user) localStorage.setItem('sherz_user', JSON.stringify(data.user));
      console.log('🔒 Dev-token acquired for user:', data.user?.id || 'u1');
      window.location.reload();
    }
  } catch (err) {
    console.error('Token olishda xatolik:', err);
  }
}
document.addEventListener('DOMContentLoaded', ensureToken);
})();

// ✅ TTS engine moved to top of file — see speak(), ttsStop(), updateTtsButton() above

// ══════════════════════════════════════════════════════════════════
// ✅ GOOGLE AUTH UI CONTROLLER
// Manages: Google login button, user display pill, logout
// Works with: catchOAuthRedirect() + ensureToken() already in file
// ══════════════════════════════════════════════════════════════════
function getStoredUser() {
  try {
    const raw = localStorage.getItem('sherz_user') || localStorage.getItem('user');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function renderAuthUI() {
  const user        = getStoredUser();
  const token       = getToken();
  const isLoggedIn  = !!(token && user && user.id && user.id !== 'anonymous');

  // Drawer elements
  const guestView   = document.getElementById('guestView');
  const userView    = document.getElementById('userView');
  const userName    = document.getElementById('userName');
  const userEmail   = document.getElementById('userEmail');

  if (!guestView || !userView) return; // HTML not loaded yet

  if (isLoggedIn) {
    guestView.style.display = 'none';
    userView.style.display  = 'block';
    if (userName)  userName.textContent  = user.name  || 'User';
    if (userEmail) userEmail.textContent = user.email || '';
  } else {
    guestView.style.display = 'block';
    userView.style.display  = 'none';
  }
}

function handleGoogleLogin() {
  // Redirect to the backend Google OAuth route
  window.location.href = '/api/auth/google';
}

function handleLogout() {
  // Clear all auth state from localStorage
  localStorage.removeItem('token');
  localStorage.removeItem('sherz_user');
  localStorage.removeItem('user');
  // Stop SSE — it uses the old userId
  closeSSE();
  // Re-render auth UI to show guest view
  renderAuthUI();
  // Get a new dev token so the app keeps working immediately
  ensureToken().then(() => {
    restoreChatFromStorage();
    startSSE();
    renderAuthUI();
    console.log('✅ Logged out, new dev session started');
  });
}

// Wire up buttons once DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  // Render initial auth state
  renderAuthUI();

  // Google login button
  const googleBtn = document.getElementById('googleLoginBtn');
  if (googleBtn) googleBtn.addEventListener('click', handleGoogleLogin);

  // Logout button
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

});
// ══════════════════════════════════════════════════════════════════
// ✅ MOBILE PLATFORM LAYER — iOS/Android detection + safe-area + keyboard
// ══════════════════════════════════════════════════════════════════
(function setupMobilePlatform() {
  const ua = navigator.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
  const isAndroid = /Android/.test(ua);
  const isMobile = isIOS || isAndroid;

  window.__SHERZ_PLATFORM__ = { isIOS, isAndroid, isMobile };

  if (isMobile) document.documentElement.classList.add('platform-mobile');
  if (isIOS)    document.documentElement.classList.add('platform-ios');
  if (isAndroid) document.documentElement.classList.add('platform-android');

  if (!isMobile || !window.visualViewport) return;

  const vv = window.visualViewport;
  const app = document.querySelector('.app');

  function getScrollTarget() {
    return document.querySelector('.feed') || document.getElementById('log');
  }

  function scrollToBottom() {
    const el = getScrollTarget();
    if (el) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }

 function onViewportResize() {
    if (isIOS) {
      // iOS: shrink height AND compensate for Safari's scroll-on-focus offset
      if (app) {
        app.style.height = vv.height + 'px';
        app.style.transform = `translateY(${vv.offsetTop}px)`;
      }
    } else if (isAndroid) {
      // Android: viewport stays same, content resizes underneath —
      // push composer up by the keyboard height via CSS var
      const kbHeight = Math.max(0, window.innerHeight - vv.height);
      document.documentElement.style.setProperty('--kb-offset', kbHeight + 'px');
    }
    scrollToBottom();
  }

  vv.addEventListener('resize', onViewportResize);
  vv.addEventListener('scroll', onViewportResize);
  onViewportResize();

  // Orientation change — iOS needs a beat before dimensions settle
  window.addEventListener('orientationchange', () => {
    setTimeout(() => {
      if (app) app.style.height = '100dvh';
      scrollToBottom();
    }, 150);
  });

  console.log('[mobile] platform layer active:', { isIOS, isAndroid });
})();