// lib/docs/spec.js — strict validation of what the model may ask for. Pure functions, no I/O.
// The model supplies STRUCTURED JSON only; our code builds the file. Nothing here can embed macros, links, external
// references, images or scripts, and every size is capped so a plan can never produce a bomb.
export const LIMITS = {
  xlsx: { sheets: 10, rowsTotal: 5000, cols: 40, cellsTotal: 100000, text: 2000, sheetName: 31, formula: 300 },
  docx: { blocks: 400, chars: 120000, tableRows: 300, tableCols: 12, listItems: 100, text: 6000 },
  pptx: { slides: 40, bullets: 12, text: 1500, tableRows: 12, tableCols: 6, notes: 1500, title: 140 },
  filename: 80,
  argsBytes: 400 * 1024,           // a plan is stored, hashed and shown to the user: keep it reviewable
};
export const MIME = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

const ctl = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
const clean = (v, max, name) => {
  const s = String(v ?? '').replace(/\r\n?/g, '\n').replace(ctl, '').replace(/<<<|>>>/g, '');
  if (s.length > max) throw new Error(`${name} is too long (max ${max} characters)`);
  return s;
};
const oneLine = (v, max, name) => clean(v, max, name).replace(/\s*\n\s*/g, ' ').trim();

export function cleanFilename(v, ext) {
  let s = String(v ?? '').trim().replace(/\.(xlsx|docx|pdf|pptx)$/i, '');
  s = s.replace(/[^\p{L}\p{N} ._()-]/gu, '').replace(/\s+/g, ' ').replace(/^[. ]+|[. ]+$/g, '');
  if (!s) throw new Error('filename is required (letters, digits, spaces, . _ - ( ) )');
  if (s.length > LIMITS.filename) throw new Error(`filename is too long (max ${LIMITS.filename})`);
  return `${s}.${ext}`;
}
const checkSize = (a) => { if (Buffer.byteLength(JSON.stringify(a ?? {}), 'utf8') > LIMITS.argsBytes) throw new Error('the file content is too large for one step (max 400 KB of content) — split it into several files'); };

// ── formulas ─────────────────────────────────────────
// Only plain arithmetic/lookup/text functions. No external workbooks, no URLs, no functions that reach outside the sheet.
export const FORMULA_FUNCTIONS = new Set(('SUM AVERAGE MIN MAX COUNT COUNTA COUNTBLANK ROUND ROUNDUP ROUNDDOWN ABS INT MOD POWER SQRT PRODUCT SUMPRODUCT MEDIAN ' +
  'IF IFS AND OR NOT IFERROR SUMIF SUMIFS COUNTIF COUNTIFS AVERAGEIF AVERAGEIFS VLOOKUP HLOOKUP INDEX MATCH LEFT RIGHT MID LEN UPPER LOWER TRIM CONCATENATE TEXT ' +
  'DATE YEAR MONTH DAY TODAY EDATE EOMONTH WEEKDAY DAYS NETWORKDAYS').split(' '));
export function validateFormula(f, sheetNames = []) {
  const s = String(f ?? '').trim();
  if (!s.startsWith('=')) throw new Error('a formula must start with "="');
  if (s.length > LIMITS.xlsx.formula) throw new Error(`formula is too long (max ${LIMITS.xlsx.formula})`);
  if (ctl.test(s)) throw new Error('formula has control characters');
  const bare = s.replace(/"(?:[^"]|"")*"/g, '""');                       // string literals can say anything; they are only text
  if (/[\[\]{}\\@#|]|https?:|\/\/|\bfile:/i.test(bare)) throw new Error('formula may not reference other files, links or arrays');
  for (const m of bare.matchAll(/([A-Za-z_][A-Za-z0-9_.]*)\s*\(/g)) {
    if (!FORMULA_FUNCTIONS.has(m[1].toUpperCase())) throw new Error(`formula function ${m[1].toUpperCase()} is not allowed`);
  }
  const names = new Set(sheetNames.map((n) => n.toLowerCase()));
  if ((bare.match(/!/g) || []).length !== [...bare.matchAll(/(?:'(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.]*)!/g)].length) throw new Error('formula has a malformed sheet reference');
  for (const m of bare.matchAll(/(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_.]*))!/g)) {
    const n = (m[1] || m[2]).replace(/''/g, "'").toLowerCase();
    if (!names.has(n)) throw new Error(`formula refers to a sheet that does not exist: ${m[1] || m[2]}`);
  }
  return s;
}

// ── XLSX ─────────────────────────────────────────────
const FORMATS = new Set(['text', 'number', 'integer', 'currency', 'percent', 'date']);
const BAD_SHEET = /[\[\]:*?\/\\]/;
function cleanCell(v, sheetNames, where) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw new Error(`${where}: number is not finite`); return v; }
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return clean(v, LIMITS.xlsx.text, where);
  if (typeof v === 'object' && !Array.isArray(v)) {
    if (v.f !== undefined) return { f: validateFormula(v.f, sheetNames) };
    if (v.d !== undefined) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v.d));
      if (!m) throw new Error(`${where}: date must look like 2026-10-16`);
      const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
      if (d.getUTCMonth() !== +m[2] - 1) throw new Error(`${where}: not a real date`);
      return { d: String(v.d) };
    }
  }
  throw new Error(`${where}: a cell must be text, a number, true/false, {"f":"=SUM(A1:A3)"} or {"d":"2026-10-16"}`);
}
export function cleanXlsxSpec(a) {
  a = a && typeof a === 'object' ? a : {};
  checkSize(a);
  if (!Array.isArray(a.sheets) || !a.sheets.length) throw new Error('at least one sheet is required');
  if (a.sheets.length > LIMITS.xlsx.sheets) throw new Error(`at most ${LIMITS.xlsx.sheets} sheets`);
  const names = a.sheets.map((s, i) => oneLine(s?.name ?? `Sheet${i + 1}`, 60, `sheet ${i + 1} name`));
  names.forEach((n, i) => {
    if (!n || n.length > LIMITS.xlsx.sheetName || BAD_SHEET.test(n) || n.startsWith("'") || n.endsWith("'")) throw new Error(`sheet ${i + 1}: name must be 1-31 characters without [ ] : * ? / \\`);
    if (names.findIndex((x) => x.toLowerCase() === n.toLowerCase()) !== i) throw new Error(`sheet name "${n}" is used twice`);
  });
  let rowsTotal = 0, cellsTotal = 0;
  const sheets = a.sheets.map((s, i) => {
    const where = `sheet "${names[i]}"`;
    const columns = s.columns === undefined ? [] : s.columns;
    if (!Array.isArray(columns) || columns.length > LIMITS.xlsx.cols) throw new Error(`${where}: columns must be a list of at most ${LIMITS.xlsx.cols}`);
    const cols = columns.map((c, k) => {
      const format = c?.format === undefined ? 'text' : String(c.format);
      if (!FORMATS.has(format)) throw new Error(`${where}: column ${k + 1} format must be one of ${[...FORMATS].join(', ')}`);
      if (c?.currency != null && !/^[A-Z]{3}$/.test(String(c.currency))) throw new Error(`${where}: currency must be a 3-letter code like USD`);
      const width = c?.width == null ? null : Number(c.width);
      if (width !== null && !(width >= 4 && width <= 80)) throw new Error(`${where}: column width must be between 4 and 80`);
      return { header: oneLine(c?.header ?? '', 100, `${where} header`), format, currency: c?.currency ? String(c.currency) : null, width };
    });
    if (!Array.isArray(s.rows)) throw new Error(`${where}: rows must be a list of rows`);
    rowsTotal += s.rows.length; if (rowsTotal > LIMITS.xlsx.rowsTotal) throw new Error(`too many rows (max ${LIMITS.xlsx.rowsTotal} in total)`);
    const rows = s.rows.map((r, ri) => {
      if (!Array.isArray(r)) throw new Error(`${where}: row ${ri + 1} must be a list of cells`);
      if (r.length > LIMITS.xlsx.cols) throw new Error(`${where}: row ${ri + 1} has more than ${LIMITS.xlsx.cols} cells`);
      cellsTotal += r.length; if (cellsTotal > LIMITS.xlsx.cellsTotal) throw new Error('too many cells in total');
      return r.map((c, ci) => cleanCell(c, names, `${where} row ${ri + 1} column ${ci + 1}`));
    });
    return { name: names[i], columns: cols, rows, freezeHeader: s.freezeHeader !== false, autoFilter: s.autoFilter === true };
  });
  return { filename: cleanFilename(a.filename, 'xlsx'), title: a.title ? oneLine(a.title, 120, 'title') : null, sheets };
}
export function describeXlsx(a) {
  const parts = a.sheets.map((s) => `${s.name} (${s.rows.length} row${s.rows.length === 1 ? '' : 's'} × ${Math.max(s.columns.length, ...s.rows.map((r) => r.length), 0)} col)`);
  return `Create the Excel file "${a.filename}": ${parts.join(', ')}`;
}

// ── DOCX ─────────────────────────────────────────────
const ALIGN = new Set(['left', 'center', 'right', 'justify']);
export function cleanDocxSpec(a, ext = 'docx') {
  a = a && typeof a === 'object' ? a : {};
  checkSize(a);
  if (!Array.isArray(a.blocks) || !a.blocks.length) throw new Error('at least one block is required');
  if (a.blocks.length > LIMITS.docx.blocks) throw new Error(`at most ${LIMITS.docx.blocks} blocks`);
  let chars = 0;
  const T = (v, where, max = LIMITS.docx.text) => { const s = clean(v, max, where); chars += s.length; if (chars > LIMITS.docx.chars) throw new Error(`the document is too long (max ${LIMITS.docx.chars} characters)`); return s; };
  const list = (items, where) => {
    if (!Array.isArray(items) || !items.length) throw new Error(`${where}: items must be a non-empty list`);
    if (items.length > LIMITS.docx.listItems) throw new Error(`${where}: at most ${LIMITS.docx.listItems} items`);
    return items.map((x, i) => T(x, `${where} item ${i + 1}`, 1000));
  };
  const blocks = a.blocks.map((b, i) => {
    const where = `block ${i + 1}`;
    switch (b?.type) {
      case 'heading': { const level = Number(b.level ?? 1); if (![1, 2, 3].includes(level)) throw new Error(`${where}: heading level must be 1, 2 or 3`); return { type: 'heading', level, text: T(b.text, where, 300).replace(/\n+/g, ' ').trim() }; }
      case 'paragraph': { if (b.align !== undefined && !ALIGN.has(b.align)) throw new Error(`${where}: align must be left, center, right or justify`); return { type: 'paragraph', text: T(b.text, where), align: b.align || 'left' }; }
      case 'bullets': return { type: 'bullets', items: list(b.items, where) };
      case 'numbered': return { type: 'numbered', items: list(b.items, where) };
      case 'pagebreak': return { type: 'pagebreak' };
      case 'table': {
        if (!Array.isArray(b.rows) || !b.rows.length) throw new Error(`${where}: table needs rows`);
        if (b.rows.length > LIMITS.docx.tableRows) throw new Error(`${where}: at most ${LIMITS.docx.tableRows} table rows`);
        const header = b.header == null ? null : (() => { if (!Array.isArray(b.header)) throw new Error(`${where}: header must be a list`); return b.header.map((h, k) => T(h, `${where} header ${k + 1}`, 200)); })();
        const rows = b.rows.map((r, ri) => { if (!Array.isArray(r)) throw new Error(`${where}: row ${ri + 1} must be a list`); return r.map((c, ci) => T(c, `${where} row ${ri + 1} cell ${ci + 1}`, 1000)); });
        const width = Math.max(header ? header.length : 0, ...rows.map((r) => r.length));
        if (width < 1 || width > LIMITS.docx.tableCols) throw new Error(`${where}: tables can have 1-${LIMITS.docx.tableCols} columns`);
        return { type: 'table', header, rows };
      }
      default: throw new Error(`${where}: type must be heading, paragraph, bullets, numbered, table or pagebreak`);
    }
  });
  const pageSize = a.pageSize === undefined ? 'A4' : String(a.pageSize);
  if (!['A4', 'Letter'].includes(pageSize)) throw new Error('pageSize must be A4 or Letter');
  return {
    filename: cleanFilename(a.filename, ext), title: a.title ? oneLine(a.title, 150, 'title') : null, subtitle: a.subtitle ? oneLine(a.subtitle, 200, 'subtitle') : null,
    footer: a.footer ? oneLine(a.footer, 150, 'footer') : null, pageSize, blocks,
  };
}
export function describeDocx(a) {
  const n = (t) => a.blocks.filter((b) => b.type === t).length;
  const bits = [`${n('heading')} heading${n('heading') === 1 ? '' : 's'}`, `${n('paragraph')} paragraph${n('paragraph') === 1 ? '' : 's'}`];
  if (n('table')) bits.push(`${n('table')} table${n('table') === 1 ? '' : 's'}`);
  if (n('bullets') + n('numbered')) bits.push(`${n('bullets') + n('numbered')} list${n('bullets') + n('numbered') === 1 ? '' : 's'}`);
  return `Create the Word file "${a.filename}": ${bits.join(', ')}`;
}

// ── PDF (same block model as Word, so one validation and one set of limits) ──
export const cleanPdfSpec = (a) => cleanDocxSpec(a, 'pdf');
export function describePdf(a) { return describeDocx(a).replace('Create the Word file', 'Create the PDF file'); }

// ── PPTX ─────────────────────────────────────────────
const SLIDE_LAYOUTS = new Set(['title', 'section', 'bullets', 'text', 'table']);
export function cleanPptxSpec(a) {
  a = a && typeof a === 'object' ? a : {};
  checkSize(a);
  const L = LIMITS.pptx;
  if (!Array.isArray(a.slides) || !a.slides.length) throw new Error('at least one slide is required');
  if (a.slides.length > L.slides) throw new Error(`at most ${L.slides} slides`);
  let chars = 0;
  const T = (v, where, max) => { const s = clean(v, max, where); chars += s.length; if (chars > 100000) throw new Error('the presentation is too long'); return s; };
  const slides = a.slides.map((sl, i) => {
    const where = `slide ${i + 1}`;
    const layout = sl?.layout === undefined || sl?.layout === null ? 'bullets' : String(sl.layout);
    if (!SLIDE_LAYOUTS.has(layout)) throw new Error(`${where}: layout must be title, section, bullets, text or table`);
    const out = { layout, title: oneLine(T(sl?.title ?? '', `${where} title`, L.title), L.title, `${where} title`), subtitle: sl?.subtitle ? oneLine(T(sl.subtitle, `${where} subtitle`, 300), 300, `${where} subtitle`) : null, bullets: null, text: null, table: null, notes: sl?.notes ? T(sl.notes, `${where} notes`, L.notes) : null };
    if (!out.title && layout !== 'text') throw new Error(`${where}: a title is required`);
    if (layout === 'bullets') {
      if (!Array.isArray(sl.bullets) || !sl.bullets.length) throw new Error(`${where}: bullets must be a non-empty list`);
      if (sl.bullets.length > L.bullets) throw new Error(`${where}: at most ${L.bullets} bullets per slide (split it into two slides)`);
      out.bullets = sl.bullets.map((b, k) => oneLine(T(b, `${where} bullet ${k + 1}`, 300), 300, `${where} bullet ${k + 1}`));
    } else if (layout === 'text') {
      out.text = T(sl.text, `${where} text`, L.text); if (!out.text.trim()) throw new Error(`${where}: text is required`);
    } else if (layout === 'table') {
      const t = sl.table;
      if (!t || !Array.isArray(t.rows) || !t.rows.length) throw new Error(`${where}: table needs rows`);
      if (t.rows.length > L.tableRows) throw new Error(`${where}: at most ${L.tableRows} table rows per slide`);
      const header = t.header == null ? null : (() => { if (!Array.isArray(t.header)) throw new Error(`${where}: header must be a list`); return t.header.map((h, k) => oneLine(T(h, `${where} header ${k + 1}`, 100), 100, `${where} header ${k + 1}`)); })();
      const rows = t.rows.map((r, ri) => { if (!Array.isArray(r)) throw new Error(`${where}: row ${ri + 1} must be a list`); return r.map((c, ci) => oneLine(T(c, `${where} row ${ri + 1} cell ${ci + 1}`, 200), 200, `${where} row ${ri + 1} cell ${ci + 1}`)); });
      const width = Math.max(header ? header.length : 0, ...rows.map((r) => r.length));
      if (width < 1 || width > L.tableCols) throw new Error(`${where}: tables can have 1-${L.tableCols} columns`);
      out.table = { header, rows };
    }
    return out;
  });
  return { filename: cleanFilename(a.filename, 'pptx'), title: a.title ? oneLine(a.title, 140, 'title') : null, slides };
}
export function describePptx(a) { return `Create the PowerPoint file "${a.filename}": ${a.slides.length} slide${a.slides.length === 1 ? '' : 's'} (${a.slides.slice(0, 4).map((s) => s.title || s.layout).join(' · ')}${a.slides.length > 4 ? ' …' : ''})`; }
