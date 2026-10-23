// lib/docs/followup.js — two small guards around file creation.
//
// 1) isDocFollowUp(): the user asked for a file ("manga excel jadval qilib ber"), SHERZ asked a clarifying question
//    ("Qanaqa jadval kerak?"), and the user answered in a few words ("Xarajatlar haqida"). That answer belongs to the
//    file task. Without this, the word "haqida" sent it to the web-lookup skill and the file task was lost.
// 2) hasFakeFileLink() / stripFakeFileLinks(): the model sometimes writes a made-up download link such as
//    [Excel](sandbox:/Xarajatlar_Jadvali.xlsx). Real downloads only ever come from the file tool (/api/files/<id>/download).
import { wantsFile } from './intent.js';

const CANCEL = /(?<![\p{L}\p{N}_])(yo['ʻ’]?q|kerak emas|kerakmas|bekor|cancel|stop|nevermind|never mind|не надо|отмена|нет)(?![\p{L}\p{N}_])/iu;
const wordCount = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;
const textOf = (m) => (typeof m?.content === 'string' ? m.content : typeof m?.text === 'string' ? m.text : Array.isArray(m?.content) ? m.content.map((p) => p?.text || '').join(' ') : '');
const REAL_DOWNLOAD = /\/api\/files\/[^\s)]+\/download/;

/**
 * @param history  earlier messages of THIS conversation, oldest first: [{ role, content|text }]
 * @param text     the new user message
 * @returns the original file request (string) when `text` answers a clarifying question about it, else null
 */
export function docFollowUpRequest({ history = [], text = '', maxWords = 25 } = {}) {
  const t = String(text || '').trim();
  if (!t || t.startsWith('/') || wordCount(t) > maxWords || CANCEL.test(t)) return null;
  const h = (history || []).filter((m) => m && (m.role === 'user' || m.role === 'assistant') && textOf(m).trim());
  const last = h[h.length - 1];
  if (!last || last.role !== 'assistant') return null;
  const lastText = textOf(last);
  if (REAL_DOWNLOAD.test(lastText)) return null;                                   // that file was already made; this is a new topic
  if (!/[?？]\s*(["'»”)\]]|\p{Extended_Pictographic}|\s)*$/u.test(lastText.trim().slice(-160))) return null;   // SHERZ did not end by asking something
  // the file request must be one of the last few user messages (nothing unrelated in between)
  const users = h.filter((m) => m.role === 'user').slice(-3).reverse();
  for (const u of users) { const ut = textOf(u); if (wantsFile(ut)) return ut.slice(0, 600); }
  return null;
}
export const isDocFollowUp = (a) => !!docFollowUpRequest(a);

const EXT = '(?:xlsx|xls|docx|doc|pdf|pptx|ppt|csv)';
const EXT_SOFT = '(?:txt|md|png|jpe?g|webp|gif)';          // real web links to these exist, so only local-looking targets count as made up
// [text](target) where target is sandbox:/file:/a bare file name/a path to a document — anything but our own download route
const MD_LINK = /!?\[([^\]\n]{0,200})\]\(\s*<?([^)\s>]+)>?\s*(?:"[^"]*")?\)/g;
const isFakeTarget = (t) => {
  if (REAL_DOWNLOAD.test(t)) return false;
  if (/^(sandbox|file|attachment|blob|data):/i.test(t)) return true;
  if (new RegExp(`\\.${EXT}(?:[?#].*)?$`, 'i').test(t)) return true;
  return !/^(https?:)?\/\//i.test(t) && new RegExp(`\\.${EXT_SOFT}(?:[?#].*)?$`, 'i').test(t);
};
export function hasFakeFileLink(text) {
  const s = String(text || ''); let m; MD_LINK.lastIndex = 0;
  while ((m = MD_LINK.exec(s))) if (isFakeTarget(m[2])) return true;
  return false;
}
/** removes made-up download links, keeping the link text */
export function stripFakeFileLinks(text) {
  return String(text || '').replace(MD_LINK, (all, label, target) => (isFakeTarget(target) ? label : all));
}

// ── "I made it" claims without a tool call ──
// A file exists only after a docs.create_* plan ran. If the model says it made one but proposed no plan, that sentence is false.
const B = '(?<![\\p{L}\\p{N}_])', E = '(?![\\p{L}\\p{N}_])';
const DONE = new RegExp(B + "(tayyorlab\\s+bo['ʻ’]?ldim|tayyorladim|tayyor\\s+qildim|tayyor\\s+bo['ʻ’]?ldi|yaratdim|yaratib\\s+(bo['ʻ’]?ldim|berdim)|yaratildi|tuzdim|saqladim|yozib\\s+bo['ʻ’]?ldim|yuklab\\s+olishingiz\\s+mumkin|have\\s+(created|made|prepared|generated)|(i|we)\\s+(created|made|prepared|generated|built)|i['’]?ve\\s+(created|made|prepared|generated)|(is|are)\\s+(ready|created)|here\\s+(is|are)\\s+your|download\\s+(it|them|the)|создал\\p{L}*|сделал\\p{L}*|подготовил\\p{L}*|готов\\p{L}*)" + E, 'iu');
const NOUN = new RegExp(B + "(excel|excell|exel|eksel|xclx|xlx|xlsx|xls|word|pdf|pptx|powerpoint|docx|xlsx|fayl\\p{L}*|file\\p{L}*|jadval\\p{L}*|hujjat\\p{L}*|taqdimot\\p{L}*|spreadsheet|document|slides?|rasm\\p{L}*|logo\\p{L}*|picture|image|файл\\p{L}*|таблиц\\p{L}*|документ\\p{L}*)" + E + "|\\.(xlsx|docx|pdf|pptx|txt|md|png)" + E, 'iu');
const NOT_YET = /hali\s+yaratilmadi|yaratilmadi|yarata\s+olmadim|not\s+(been\s+)?created|couldn['’]?t|cannot|can['’]?t|haven['’]?t|не\s+созда/i;
// also a PROMISE with no action behind it: "PDF formatga o'tkazib beraman. Fayl bir zumda tayyor bo'ladi."
const PROMISE = new RegExp(B + "(beraman|yarataman|tayyorlayman|tayyorlab\\s+beraman|o['ʻ’]?tkazaman|qilaman|bir\\s+zumda|yaratmoqdaman|tayyorlanmoqda|yaratilmoqda|will\\s+(create|make|generate|prepare|convert)|i['’]?ll\\s+(create|make|generate|prepare|convert)|i\\s+am\\s+(creating|making|generating|converting)|сейчас\\s+(создам|сделаю))" + E, 'iu');
export const hasFileCreationClaim = (text) => {
  const t = String(text || ''); if (!t || NOT_YET.test(t) || !NOUN.test(t)) return false;
  if (DONE.test(t)) return true;
  return PROMISE.test(t) && !/[?？]/.test(t);         // a question back to the user ("Qaysi ustunlar kerak? …yarataman") is fine
};
export const FILE_NOT_CREATED_NOTE = '\n\n⚠️ Aslida fayl hali yaratilmadi — hech qanday vosita ishga tushmadi. Yaratish uchun yozing: «Excel fayl yaratib ber: …» — tayyor bo‘lganda haqiqiy yuklab olish tugmasi chiqadi.';
