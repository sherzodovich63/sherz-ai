// lib/docs/intent.js — does this message ask for an Excel / Word FILE?
// Tools (and therefore plan cards) only exist in Expert Mode, which used to need the "/agent" prefix. A request for a
// spreadsheet or document file switches Expert Mode on by itself, so the model is given docs.create_xlsx / docs.create_docx.
// Excel, Word, PDF and PowerPoint. Deliberately about FILES, not tables: "show a table" stays a normal chat reply. The model still only PROPOSES; the user approves.
const B = '(?<![\\p{L}\\p{N}_])', E = '(?![\\p{L}\\p{N}_])';          // \b is ASCII-only; these also work for Cyrillic
const rx = (src, f = 'iu') => new RegExp(src.replace(/<B>/g, B).replace(/<E>/g, E), f);
const FILE_EXT = rx('\\.(xlsx|xls|docx|doc|pdf|pptx|ppt)<E>');
const EXCEL = rx('<B>(excel|excelga|excelni|exel|eksel|xlsx|spreadsheet|электронн\\p{L}* таблиц\\p{L}*|эксель|ексель)<E>');
const DOCN = '(file|fayl\\p{L}*|doc|docs|hujjat\\p{L}*|document\\p{L}*|файл\\p{L}*|документ\\p{L}*)';
const WORD_DOC = rx('<B>(word|ворд)[\\s-]*' + DOCN + '<E>|<B>' + DOCN + '[\\s-]*(word|ворд)<E>|<B>docx<E>|<B>word<E>.*<B>(yarat|yoz|tayyorla|qil|make|create|write|generate|сдела|созда)');
const MAKE = rx('<B>(make|create|build|generate|write|prepare|export|save|send|give|need|want|yarat\\p{L}*|yoz\\p{L}*|tayyorla\\p{L}*|tuz\\p{L}*|qil\\p{L}*|ber\\p{L}*|kerak|chiqar\\p{L}*|hosil\\p{L}*|jo[\'ʻ’]?nat\\p{L}*|yubor\\p{L}*|сдела\\p{L}*|созда\\p{L}*|подготов\\p{L}*|нужен|нужна|хочу)<E>');
const STRONG = rx('<B>(make|create|build|generate|export|write|prepare|yarat\\p{L}*|yoz\\p{L}*|tuz\\p{L}*|tayyorla\\p{L}*|qil\\p{L}*|chiqar\\p{L}*|сдела\\p{L}*|созда\\p{L}*|подготов\\p{L}*)<E>');
const PDF = rx('<B>pdf<E>');
const DECK = rx('<B>(powerpoint|power point|pptx|ppt|slides|slide deck|taqdimot\\p{L}*|prezentatsiya\\p{L}*|презентаци\\p{L}*|пауэрпоинт|павер\\s?поинт)<E>');
const PRESENTATION = rx('<B>presentation<E>');
export function wantsDocFile(text) {
  const t = String(text || '').slice(0, 2000);
  if (!t.trim() || t.startsWith('/')) return false;
  if (FILE_EXT.test(t)) return MAKE.test(t) || rx('<B>(file|fayl|файл)<E>').test(t);
  if (PDF.test(t) && STRONG.test(t)) return true;
  if ((DECK.test(t) && MAKE.test(t)) || (PRESENTATION.test(t) && STRONG.test(t))) return true;
  return (EXCEL.test(t) || WORD_DOC.test(t)) && MAKE.test(t);
}
