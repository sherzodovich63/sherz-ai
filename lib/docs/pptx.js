// lib/docs/pptx.js — build a PowerPoint from a VALIDATED slide spec and read decks back (text only).
// No images, links, media, macros or external content: slides are text, bullets and tables.
import { MIME } from './spec.js';
import { assertSafeZip } from './zipguard.js';

const noEmoji = (t) => String(t ?? '').replace(/[\u{1F000}-\u{1FFFF}\u{FE0F}\u{200D}]/gu, '').replace(/\*\*([^*\n]+)\*\*/g, '$1').replace(/\*([^*\n]+)\*/g, '$1');
const FONT = 'Calibri';
const C = { navy: '1F2A44', ink: '222222', grey: '666666', accent: '3B6FD8', light: 'EEF0F3', line: 'C9CED6', white: 'FFFFFF' };

export async function buildPptx(spec) {
  let Pptx; try { Pptx = (await import('pptxgenjs')).default; } catch { throw new Error('PowerPoint support is not installed on the server (run: npm install pptxgenjs)'); }
  const pres = new Pptx(); pres.layout = 'LAYOUT_WIDE';                  // 13.33 x 7.5 in
  pres.title = spec.title || spec.filename.replace(/\.pptx$/i, ''); pres.author = 'SHERZ'; pres.company = 'SHERZ';
  const W = 13.33, M = 0.7;
  for (const s of spec.slides) {
    const sl = pres.addSlide();
    if (s.layout === 'title' || s.layout === 'section') {
      sl.background = { color: s.layout === 'title' ? C.navy : C.accent };
      sl.addText(noEmoji(s.title), { x: M, y: s.layout === 'title' ? 2.4 : 2.9, w: W - 2 * M, h: 1.4, fontFace: FONT, fontSize: s.layout === 'title' ? 44 : 38, bold: true, color: C.white, valign: 'middle', fit: 'shrink' });
      if (s.subtitle) sl.addText(noEmoji(s.subtitle), { x: M, y: s.layout === 'title' ? 3.9 : 4.3, w: W - 2 * M, h: 0.9, fontFace: FONT, fontSize: 20, color: 'D6DCEA', valign: 'top', fit: 'shrink' });
    } else {
      sl.background = { color: C.white };
      if (s.title) sl.addText(noEmoji(s.title), { x: M, y: 0.45, w: W - 2 * M, h: 0.9, fontFace: FONT, fontSize: 30, bold: true, color: C.navy, valign: 'middle', fit: 'shrink' });
      sl.addShape(pres.ShapeType.rect, { x: M, y: 1.4, w: 1.2, h: 0.06, fill: { color: C.accent }, line: { color: C.accent, width: 0 } });
      const body = { x: M, y: 1.7, w: W - 2 * M, h: 5.0 };
      if (s.layout === 'bullets') {
        sl.addText(s.bullets.map((b) => ({ text: noEmoji(b), options: { bullet: { indent: 22 }, breakLine: true, paraSpaceAfter: 10 } })), { ...body, fontFace: FONT, fontSize: s.bullets.length > 8 ? 20 : 24, color: C.ink, valign: 'top', fit: 'shrink' });
      } else if (s.layout === 'text') {
        sl.addText(noEmoji(s.text), { ...body, fontFace: FONT, fontSize: 22, color: C.ink, valign: 'top', fit: 'shrink', paraSpaceAfter: 8 });
      } else if (s.layout === 'table') {
        const rows = []; const cell = (t, o = {}) => ({ text: noEmoji(t), options: { fontFace: FONT, fontSize: 16, color: C.ink, border: { type: 'solid', color: C.line, pt: 0.75 }, ...o } });
        if (s.table.header) rows.push(s.table.header.map((h) => cell(h, { bold: true, fill: { color: C.light } })));
        s.table.rows.forEach((r) => rows.push(r.map((c) => cell(c))));
        sl.addTable(rows, { x: M, y: 1.7, w: W - 2 * M, autoPage: false });
      }
    }
    if (s.notes) sl.addNotes(noEmoji(s.notes));
    if (s.layout !== 'title') sl.slideNumber = { x: W - 1.0, y: 7.0, fontFace: FONT, fontSize: 11, color: C.grey };
  }
  const out = await pres.write({ outputType: 'nodebuffer' });
  return { buffer: Buffer.from(out), mime: MIME.pptx };
}

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&');
export async function parsePptx(buffer, { maxChars = 7000, maxSlides = 60 } = {}) {
  await assertSafeZip(buffer);
  const JSZip = (await import('jszip')).default; let zip;
  try { zip = await JSZip.loadAsync(buffer); } catch { throw new Error('this does not look like a valid .pptx file'); }
  const names = Object.keys(zip.files).map((n) => ({ n, k: /^ppt\/slides\/slide(\d+)\.xml$/.exec(n) })).filter((x) => x.k).sort((a, b) => +a.k[1] - +b.k[1]);
  if (!names.length) throw new Error('this does not look like a valid .pptx file');
  const slides = []; let used = 0, truncated = names.length > maxSlides;
  for (const { n, k } of names.slice(0, maxSlides)) {
    const xml = await zip.file(n).async('string');
    const paras = [...xml.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)].map((p) => decode([...p[1].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((t) => t[1]).join('')).replace(/<<<|>>>/g, '').trim()).filter(Boolean);
    const len = paras.join('').length;
    if (used + len > maxChars) { slides.push({ slide: +k[1], text: paras.join('\n').slice(0, Math.max(0, maxChars - used)) }); truncated = true; break; }
    used += len; slides.push({ slide: +k[1], text: paras.join('\n') });
  }
  return { slides, truncated };
}
