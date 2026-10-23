// lib/docs/intent.js — does this message ask for an Excel / Word FILE?
// Tools (and therefore plan cards) only exist in Expert Mode, which used to need the "/agent" prefix. A request for a
// spreadsheet or document file switches Expert Mode on by itself, so the model is given docs.create_xlsx / docs.create_docx.
// Excel, Word, PDF and PowerPoint. Deliberately about FILES, not tables: "show a table" stays a normal chat reply. The model still only PROPOSES; the user approves.
const B = '(?<![\\p{L}\\p{N}_])', E = '(?![\\p{L}\\p{N}_])';          // \b is ASCII-only; these also work for Cyrillic
const rx = (src, f = 'iu') => new RegExp(src.replace(/<B>/g, B).replace(/<E>/g, E), f);
const FILE_EXT = rx('\\.(xlsx|xls|docx|doc|pdf|pptx|ppt|txt|md)<E>');
const EXCEL = rx('<B>(excel|excelga|excelni|excelda|excell|exel|eksel|ekxel|exsel|ecxel|xclx|xlx|xlsx|xlsm|xls|spreadsheet|электронн\\p{L}* таблиц\\p{L}*|эксель|ексель)<E>');
const DOCN = '(file|fayl\\p{L}*|doc|docs|hujjat\\p{L}*|document\\p{L}*|файл\\p{L}*|документ\\p{L}*)';
const WORD_DOC = rx('<B>(word|ворд)[\\s-]*' + DOCN + '<E>|<B>' + DOCN + '[\\s-]*(word|ворд)<E>|<B>docx<E>|<B>word<E>.*<B>(yarat|yoz|tayyorla|qil|make|create|write|generate|сдела|созда)');
const MAKE = rx('<B>(make|create|build|generate|write|prepare|export|save|send|give|need|want|yarat\\p{L}*|yoz\\p{L}*|tayyorla\\p{L}*|tuz\\p{L}*|qil\\p{L}*|ber\\p{L}*|kerak|chiqar\\p{L}*|hosil\\p{L}*|jo[\'ʻ’]?nat\\p{L}*|yubor\\p{L}*|сдела\\p{L}*|созда\\p{L}*|подготов\\p{L}*|нужен|нужна|хочу)<E>');
const STRONG = rx('<B>(make|create|build|generate|export|write|prepare|yarat\\p{L}*|yoz\\p{L}*|tuz\\p{L}*|tayyorla\\p{L}*|qil\\p{L}*|chiqar\\p{L}*|сдела\\p{L}*|созда\\p{L}*|подготов\\p{L}*)<E>');
const PDF = rx("<B>pdf(?:['ʻ’]?(?:da|ga|ni|dan))?<E>");
const DECK = rx('<B>(powerpoint|power point|pptx|ppt|slides|slide deck|taqdimot\\p{L}*|prezentatsiya\\p{L}*|презентаци\\p{L}*|пауэрпоинт|павер\\s?поинт)<E>');
const PRESENTATION = rx('<B>presentation<E>');
const TXT = rx('<B>(txt|markdown|text file|matn fayl\\p{L}*|matnli fayl\\p{L}*|текстов\\p{L}* файл\\p{L}*)<E>');
// ── short follow-ups in a file conversation: "excel ham", "wordda ham", "pdf ham", "yana pdf", "also as pdf" ──
// A format name (with its Uzbek endings: excelda, wordga, pdf'ni …) + an "also" word, in a very short message with no question in it.
// ("wordpress", "pdfkit", "Excel ham o'rganmoqchiman?" and "Excel nima?" do not match.)
const FMT = rx("<B>(excel|excell|exel|eksel|ekxel|exsel|ecxel|xclx|xlx|xlsx|xls|word|docx|pdf|pptx|powerpoint|txt|markdown|эксель|ворд|пдф)(?:['ʻ’]?(?:da|ga|ni|dan))?<E>");
const ALSO = rx('<B>(ham|yana|also|too|as well|тоже|еще|ещё)<E>');
const QUESTIONY = rx("[?？]|<B>(nima|qanday|qanaqa|nega|how|what|why|o['ʻ’]?rgan\\p{L}*|learn|study|что|как)<E>");
export function isFormatFollowUp(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 60 || t.startsWith('/')) return false;
  if (t.split(/\s+/).length > 6) return false;
  return FMT.test(t) && ALSO.test(t) && !QUESTIONY.test(t);
}
// "endi shuni pdfga aylantir", "wordga o'tkaz", "convert this to pdf": a format name + a conversion verb
const CONVERT = rx("<B>(aylantir\\p{L}*|o['ʻ’]?tkaz\\p{L}*|convert\\p{L}*|export\\p{L}*|конвертир\\p{L}*|преобраз\\p{L}*|перевед\\p{L}*)<E>");
export function wantsDocFile(text) {
  const t = String(text || '').slice(0, 2000);
  if (!t.trim() || t.startsWith('/')) return false;
  if (isFormatFollowUp(t)) return true;
  if (FMT.test(t) && CONVERT.test(t) && !QUESTIONY.test(t)) return true;
  if (FILE_EXT.test(t)) return MAKE.test(t) || rx('<B>(file|fayl|файл)<E>').test(t);
  if (PDF.test(t) && STRONG.test(t)) return true;
  if (TXT.test(t) && MAKE.test(t)) return true;
  if ((DECK.test(t) && MAKE.test(t)) || (PRESENTATION.test(t) && STRONG.test(t))) return true;
  return (EXCEL.test(t) || WORD_DOC.test(t)) && MAKE.test(t);
}

// ── pictures: "Rasm chizib ber", "Yangi logo yarat", "draw a cat", "нарисуй логотип" ──
// Deliberately needs BOTH a picture word and a making word, so "bu rasmni tushuntir" (analysing a picture they sent) is not a request to draw.
const PIC = rx('<B>(rasm\\p{L}*|surat\\p{L}*|tasvir\\p{L}*|logo\\p{L}*|logotip\\p{L}*|illyustratsiya\\p{L}*|plakat\\p{L}*|poster|banner|ikonka|icon|avatar|image|picture|photo|illustration|artwork|drawing|картинк\\p{L}*|изображени\\p{L}*|рисунок|рисунк\\p{L}*|лого\\p{L}*|иллюстраци\\p{L}*|постер\\p{L}*)<E>');
const DRAW = rx('<B>(chiz\\p{L}*|yarat\\p{L}*|yasa\\p{L}*|tayyorla\\p{L}*|generat\\p{L}*|creat\\p{L}*|make|draw|design|paint|render|kerak|need|want|istayman|нарисуй\\p{L}*|сгенерируй\\p{L}*|созда\\p{L}*|сдела\\p{L}*|нужен|нужна|нужно|хочу)<E>');
const DRAW_ALONE = rx('<B>(draw|paint|sketch|нарисуй\\p{L}*)<E>');
const NOT_DRAW = rx('<B>(tushuntir\\p{L}*|tahlil\\p{L}*|analy[sz]e|describe|explain|nima\\s+(bu|yozilgan)|what\\s+is|что\\s+на|опиши|объясни)<E>');
export function wantsImage(text) {
  const t = String(text || '').slice(0, 2000);
  if (!t.trim() || t.startsWith('/')) return false;
  if (!((PIC.test(t) && DRAW.test(t)) || DRAW_ALONE.test(t))) return false;
  return !NOT_DRAW.test(t);
}
/** a file OR a picture */
export const wantsFile = (text) => wantsDocFile(text) || wantsImage(text);
