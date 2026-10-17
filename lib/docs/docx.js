// lib/docs/docx.js — build a Word document from a VALIDATED spec and read documents back (text only).
import { MIME } from './spec.js';
import { assertSafeZip } from './zipguard.js';

const loadDocx = async () => { try { return await import('docx'); } catch { throw new Error('Word support is not installed on the server (run: npm install docx)'); } };

/** tiny inline markup: **bold**, *italic* — nothing else (no links, no images) */
export function inlineRuns(text, TextRun, base = {}) {
  const out = []; const re = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g; let last = 0, m;
  const push = (t, extra = {}) => { if (t) out.push(new TextRun({ text: t, ...base, ...extra })); };
  while ((m = re.exec(text))) {
    push(text.slice(last, m.index));
    if (m[0].startsWith('**')) push(m[0].slice(2, -2), { bold: true }); else push(m[0].slice(1, -1), { italics: true });
    last = m.index + m[0].length;
  }
  push(text.slice(last));
  return out.length ? out : [new TextRun({ text: '', ...base })];
}

export async function buildDocx(spec) {
  const D = await loadDocx();
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType, PageBreak, Footer, PageNumber, LevelFormat, BorderStyle, ShadingType } = D;
  const A = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED };
  const H = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3 };
  const letter = spec.pageSize === 'Letter';
  const page = letter ? { width: 12240, height: 15840 } : { width: 11906, height: 16838 };
  const margin = 1134;                                     // 2 cm
  const contentWidth = page.width - margin * 2;
  const children = [];
  if (spec.title) children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: spec.title })], spacing: { after: 120 } }));
  if (spec.subtitle) children.push(new Paragraph({ children: [new TextRun({ text: spec.subtitle, color: '666666', size: 26 })], spacing: { after: 240 } }));
  let numRef = 0; const numberings = [];
  for (const b of spec.blocks) {
    if (b.type === 'heading') children.push(new Paragraph({ heading: H[b.level], children: [new TextRun({ text: b.text })], spacing: { before: 240, after: 120 } }));
    else if (b.type === 'paragraph') for (const part of b.text.split(/\n{2,}/)) children.push(new Paragraph({ alignment: A[b.align], children: inlineRuns(part.replace(/\n/g, ' '), TextRun), spacing: { after: 120, line: 276 } }));
    else if (b.type === 'bullets') for (const it of b.items) children.push(new Paragraph({ numbering: { reference: 'bullets', level: 0 }, children: inlineRuns(it, TextRun), spacing: { after: 60 } }));
    else if (b.type === 'numbered') {
      const ref = 'num' + (++numRef); numberings.push({ reference: ref, levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] });
      for (const it of b.items) children.push(new Paragraph({ numbering: { reference: ref, level: 0 }, children: inlineRuns(it, TextRun), spacing: { after: 60 } }));
    } else if (b.type === 'pagebreak') children.push(new Paragraph({ children: [new PageBreak()] }));
    else if (b.type === 'table') {
      const cols = Math.max(b.header ? b.header.length : 0, ...b.rows.map((r) => r.length));
      const w = Math.floor(contentWidth / cols); const line = { style: BorderStyle.SINGLE, size: 4, color: 'BBBBBB' }; const borders = { top: line, bottom: line, left: line, right: line };
      const cell = (text, head) => new TableCell({ width: { size: w, type: WidthType.DXA }, borders, margins: { top: 60, bottom: 60, left: 100, right: 100 },
        shading: head ? { fill: '3B3F8F', type: ShadingType.CLEAR, color: 'auto' } : undefined,
        children: [new Paragraph({ children: inlineRuns(String(text ?? ''), TextRun, head ? { bold: true, color: 'FFFFFF' } : {}) })] });
      const pad = (r) => Array.from({ length: cols }, (_, i) => r[i] ?? '');
      const rows = [...(b.header ? [new TableRow({ tableHeader: true, children: pad(b.header).map((t) => cell(t, true)) })] : []), ...b.rows.map((r) => new TableRow({ children: pad(r).map((t) => cell(t, false)) }))];
      children.push(new Table({ width: { size: w * cols, type: WidthType.DXA }, columnWidths: Array(cols).fill(w), rows }));
      children.push(new Paragraph({ children: [], spacing: { after: 120 } }));
    }
  }
  const footerKids = [];
  if (spec.footer) footerKids.push(new TextRun({ text: spec.footer + '   ·   ', color: '888888', size: 18 }));
  footerKids.push(new TextRun({ children: ['Page ', PageNumber.CURRENT], color: '888888', size: 18 }));
  const doc = new Document({
    creator: 'SHERZ AI', title: spec.title || spec.filename,
    styles: {
      default: { document: { run: { font: 'Calibri', size: 22 } } },
      paragraphStyles: [
        { id: 'Title', name: 'Title', basedOn: 'Normal', run: { size: 52, bold: true, color: '2B2F6E', font: 'Calibri' }, paragraph: { spacing: { after: 120 } } },
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 34, bold: true, color: '2B2F6E', font: 'Calibri' }, paragraph: { spacing: { before: 280, after: 120 }, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 28, bold: true, color: '3B3F8F', font: 'Calibri' }, paragraph: { spacing: { before: 220, after: 100 }, outlineLevel: 1 } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 24, bold: true, color: '444444', font: 'Calibri' }, paragraph: { spacing: { before: 180, after: 80 }, outlineLevel: 2 } },
      ],
    },
    numbering: { config: [{ reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] }, ...numberings] },
    sections: [{ properties: { page: { size: page, margin: { top: margin, bottom: margin, left: margin, right: margin } } }, footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: footerKids })] }) }, children }],
  });
  const buf = Buffer.from(await Packer.toBuffer(doc));
  if (buf.length > 5 * 1024 * 1024) throw new Error('the generated file is larger than 5 MB');
  return { buffer: buf, mime: MIME.docx };
}

const unesc = (s) => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const text = (h) => unesc(h.replace(/<[^>]+>/g, '')).replace(/<<<|>>>/g, '').replace(/\s+/g, ' ').trim();
/** structure (headings, paragraphs, lists, tables) as plain text blocks; images, links and styling are dropped */
export async function parseDocx(buffer, { maxChars = 7000 } = {}) {
  await assertSafeZip(buffer);
  let mammoth; try { mammoth = (await import('mammoth')).default; } catch { throw new Error('Word reading is not installed on the server (run: npm install mammoth)'); }
  let html; try { html = (await mammoth.convertToHtml({ buffer }, { ignoreEmptyParagraphs: true })).value; } catch { throw new Error('this does not look like a valid .docx file'); }
  const blocks = []; let used = 0, truncated = false;
  const add = (b, len) => { if (used + len > maxChars) { truncated = true; return false; } used += len; blocks.push(b); return true; };
  const re = /<(h[1-6]|p|ul|ol|table)\b[^>]*>([\s\S]*?)<\/\1>/g; let m;
  while ((m = re.exec(html))) {
    const tag = m[1], inner = m[2];
    if (/^h[1-6]$/.test(tag)) { const t = text(inner); if (t && !add({ type: 'heading', level: +tag[1], text: t }, t.length)) break; }
    else if (tag === 'p') { const t = text(inner); if (t && !add({ type: 'paragraph', text: t }, t.length)) break; }
    else if (tag === 'ul' || tag === 'ol') { const items = [...inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((x) => text(x[1])).filter(Boolean); if (items.length && !add({ type: tag === 'ul' ? 'bullets' : 'numbered', items }, items.join('').length)) break; }
    else if (tag === 'table') { const rows = [...inner.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].slice(0, 60).map((r) => [...r[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => text(c[1]).slice(0, 200))); if (rows.length && !add({ type: 'table', rows }, rows.flat().join('').length)) break; }
  }
  return { blocks, truncated };
}
