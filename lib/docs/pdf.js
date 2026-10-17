// lib/docs/pdf.js — build a PDF from a VALIDATED document spec (same blocks as Word) and read PDFs back (text only).
// Fonts: DejaVu Sans is bundled (lib/docs/fonts) because the PDF built-in fonts cannot show Uzbek oʻ/gʻ or Cyrillic.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIME } from './spec.js';

const FONT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fonts');
const require = createRequire(import.meta.url);
const loadPdfKit = () => { try { return require('pdfkit'); } catch { throw new Error('PDF support is not installed on the server (run: npm install pdfkit)'); } };
const noEmoji = (t) => String(t).replace(/[\u{1F000}-\u{1FFFF}\u{FE0F}\u{200D}]/gu, '');

/** **bold** / *italic* → segments (nothing else is interpreted: no links, no images) */
export function inlineSegments(text) {
  const out = []; const re = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g; let last = 0, m;
  const push = (t, extra = {}) => { if (t) out.push({ text: t, bold: false, italic: false, ...extra }); };
  while ((m = re.exec(text))) {
    push(text.slice(last, m.index));
    if (m[0].startsWith('**')) push(m[0].slice(2, -2), { bold: true }); else push(m[0].slice(1, -1), { italic: true });
    last = m.index + m[0].length;
  }
  push(text.slice(last));
  return out.length ? out : [{ text: '', bold: false, italic: false }];
}

export async function buildPdf(spec) {
  const PDFDocument = loadPdfKit();
  const letter = spec.pageSize === 'Letter';
  const margin = 56;
  const doc = new PDFDocument({ size: letter ? 'LETTER' : 'A4', margin, bufferPages: true, info: { Title: spec.title || spec.filename.replace(/\.pdf$/i, ''), Producer: 'SHERZ', Creator: 'SHERZ' } });
  const chunks = []; doc.on('data', (c) => chunks.push(c));
  const finished = new Promise((res, rej) => { doc.on('end', res); doc.on('error', rej); });
  const F = { r: 'R', b: 'B', i: 'I', bi: 'BI' };
  doc.registerFont(F.r, path.join(FONT_DIR, 'DejaVuSans.ttf')); doc.registerFont(F.b, path.join(FONT_DIR, 'DejaVuSans-Bold.ttf'));
  doc.registerFont(F.i, path.join(FONT_DIR, 'DejaVuSans-Oblique.ttf')); doc.registerFont(F.bi, path.join(FONT_DIR, 'DejaVuSans-BoldOblique.ttf'));
  const W = () => doc.page.width - margin * 2, bottom = () => doc.page.height - margin - 10;
  const need = (h) => { if (doc.y + h > bottom()) doc.addPage(); };
  const fontOf = (s, base) => (base === 'b' || s.bold) ? ((s.italic) ? F.bi : F.b) : (s.italic ? F.i : F.r);
  const rich = (text, { x = margin, width = W(), size = 11, color = '#222222', align = 'left', base = 'r', gap = 3 } = {}) => {
    const segs = inlineSegments(noEmoji(text)); doc.fillColor(color).fontSize(size);
    segs.forEach((s, k) => { doc.font(fontOf(s, base)); const o = { width, align, lineGap: gap, continued: k < segs.length - 1 }; if (k === 0) doc.text(s.text, x, doc.y, o); else doc.text(s.text, o); });
  };
  const plain = (t, h) => { doc.font(F.r).fontSize(h.size || 11); return doc.heightOfString(noEmoji(t) || ' ', { width: h.width, lineGap: 3 }); };

  if (spec.title) { doc.font(F.b).fontSize(24).fillColor('#111111').text(noEmoji(spec.title), margin, margin, { width: W() }); doc.moveDown(0.2); }
  if (spec.subtitle) { doc.font(F.r).fontSize(12).fillColor('#666666').text(noEmoji(spec.subtitle), { width: W() }); doc.moveDown(0.8); } else if (spec.title) doc.moveDown(0.6);

  for (const b of spec.blocks) {
    if (b.type === 'heading') { const sz = { 1: 17, 2: 14, 3: 12 }[b.level]; need(sz * 3); doc.moveDown(b.level === 1 ? 0.7 : 0.5); rich(b.text, { size: sz, base: 'b', color: '#111111' }); doc.moveDown(0.3); }
    else if (b.type === 'paragraph') { need(30); rich(b.text, { align: b.align === 'justify' ? 'justify' : b.align }); doc.moveDown(0.6); }
    else if (b.type === 'bullets' || b.type === 'numbered') {
      b.items.forEach((it, k) => {
        const mark = b.type === 'bullets' ? '•' : `${k + 1}.`; need(24);
        const y = doc.y; doc.font(F.r).fontSize(11).fillColor('#222222').text(mark, margin + 4, y, { width: 22, lineBreak: false });
        doc.y = y; rich(it, { x: margin + 26, width: W() - 26 }); doc.moveDown(0.25);
      });
      doc.moveDown(0.4);
    }
    else if (b.type === 'pagebreak') doc.addPage();
    else if (b.type === 'table') {
      const cols = Math.max(b.header ? b.header.length : 0, ...b.rows.map((r) => r.length)); const cw = W() / cols, pad = 5, size = 9.5;
      const rowH = (cells, bold) => Math.max(...Array.from({ length: cols }, (_, c) => { doc.font(bold ? F.b : F.r).fontSize(size); return doc.heightOfString(noEmoji(cells[c] ?? '') || ' ', { width: cw - pad * 2, lineGap: 2 }); })) + pad * 2;
      const drawRow = (cells, bold, fill) => {
        const h = rowH(cells, bold); if (doc.y + h > bottom()) { doc.addPage(); if (b.header && !bold) drawRow(b.header, true, '#EEF0F3'); }
        const y = doc.y; if (fill) doc.rect(margin, y, W(), h).fill(fill);
        for (let c = 0; c < cols; c++) { doc.rect(margin + c * cw, y, cw, h).lineWidth(0.5).strokeColor('#C9CED6').stroke(); doc.font(bold ? F.b : F.r).fontSize(size).fillColor('#222222').text(noEmoji(cells[c] ?? ''), margin + c * cw + pad, y + pad, { width: cw - pad * 2, lineGap: 2 }); }
        doc.y = y + h; doc.x = margin;
      };
      if (b.header) drawRow(b.header, true, '#EEF0F3'); b.rows.forEach((r) => drawRow(r, false, null)); doc.moveDown(0.8);
    }
  }
  const range = doc.bufferedPageRange(); const foot = spec.footer ? noEmoji(spec.footer) : '';
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i); const old = doc.page.margins.bottom; doc.page.margins.bottom = 0;
    doc.font(F.r).fontSize(8).fillColor('#888888');
    if (foot) doc.text(foot, margin, doc.page.height - 36, { width: W() - 80, lineBreak: false, align: 'left' });
    doc.text(`${i + 1} / ${range.count}`, doc.page.width - margin - 70, doc.page.height - 36, { width: 70, lineBreak: false, align: 'right' });
    doc.page.margins.bottom = old;
  }
  doc.end(); await finished;
  return { buffer: Buffer.concat(chunks), mime: MIME.pdf };
}

// ── reading ───────────────────────────────────────────
export async function parsePdf(buffer, { maxChars = 7000, maxPages = 30 } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8 || buffer.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('this does not look like a PDF file');
  let pdfjs; try { pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs'); } catch { throw new Error('PDF reading is not installed on the server (run: npm install pdfjs-dist)'); }
  const work = (async () => {
    const task = pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: false, disableFontFace: true, verbosity: 0, stopAtErrors: false });
    let d; try { d = await task.promise; } catch (e) { throw new Error(/password/i.test(String(e?.name || e?.message)) ? 'this PDF is password-protected' : 'this does not look like a valid PDF file'); }
    const out = []; let used = 0, truncated = d.numPages > maxPages;
    for (let p = 1; p <= Math.min(d.numPages, maxPages); p++) {
      const tc = await (await d.getPage(p)).getTextContent(); const lines = []; let line = '', lastY = null;
      for (const it of tc.items) { if (!('str' in it)) continue; const y = it.transform?.[5]; if (lastY !== null && Math.abs(y - lastY) > 2) { lines.push(line); line = ''; } line += it.str; lastY = y; }
      if (line) lines.push(line);
      const text = lines.map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n').replace(/<<<|>>>/g, '');
      if (used + text.length > maxChars) { out.push({ page: p, text: text.slice(0, Math.max(0, maxChars - used)) }); truncated = true; break; }
      used += text.length; out.push({ page: p, text });
    }
    await d.destroy(); return { pages: d.numPages, content: out, truncated, scannedHint: out.every((x) => !x.text.trim()) ? 'no selectable text found (this may be a scanned PDF)' : undefined };
  })();
  return Promise.race([work, new Promise((_, rej) => setTimeout(() => rej(new Error('the PDF took too long to read')), 15000))]);
}
