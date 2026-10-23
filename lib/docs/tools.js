// lib/docs/tools.js — registers the document tools into the agent registry (called once from registry.js).
//   docs.create_xlsx / _docx / _pdf / _pptx / _text / _image   state-changing → ALWAYS go through the Approval Gate (risk low, reversible: delete in /files)
//   docs.list / docs.read                 read-only "observe" tools for files the user created or uploaded (results are untrusted data)
// None of them touch the user's computer or the network; they only write to / read from the user's own file store.
import { cleanXlsxSpec, describeXlsx, cleanDocxSpec, describeDocx, cleanPdfSpec, describePdf, cleanPptxSpec, describePptx, cleanTextSpec, describeText, cleanImageSpec, describeImage, MIME } from './spec.js';
import { getImageProvider } from './image.js';
import { buildXlsx, parseXlsx } from './xlsx.js';
import { buildDocx, parseDocx } from './docx.js';
import { buildPdf, parsePdf } from './pdf.js';
import { buildPptx, parsePptx } from './pptx.js';
import { getFileStore } from './store.js';

const extOf = (n) => (/\.(xlsx|docx|pdf|pptx|txt|md)$/i.exec(n) || [])[1]?.toLowerCase();
// pictures cost money: a per-user ceiling on top of the Gate's own hourly cap (in memory; resets on restart, which only errs towards allowing)
const IMAGES_PER_HOUR = Math.max(1, Number(process.env.IMAGES_PER_HOUR) || 10);
const imageRuns = new Map();
export function imageBudget(userId, now = Date.now()) {
  const list = (imageRuns.get(userId) || []).filter((t) => now - t < 3600000); imageRuns.set(userId, list);
  return { used: list.length, left: IMAGES_PER_HOUR - list.length, limit: IMAGES_PER_HOUR, take: () => { list.push(now); } };
}
const download = (id) => `/api/files/${id}/download`;

async function createFile(userId, spec, kind) {
  const built = kind === 'xlsx' ? await buildXlsx(spec) : kind === 'pdf' ? await buildPdf(spec) : kind === 'pptx' ? await buildPptx(spec) : await buildDocx(spec);
  const meta = await getFileStore().put(userId, { name: spec.filename, mime: built.mime, bytes: built.buffer, source: 'generated' });
  return { fileId: meta.id, filename: meta.name, bytes: meta.size, mime: meta.mime, download: download(meta.id), ...(kind === 'xlsx' ? { sheets: spec.sheets.map((s) => ({ name: s.name, rows: s.rows.length })) } : kind === 'pptx' ? { slides: spec.slides.length } : { blocks: spec.blocks.length }) };
}

export function registerDocTools(TOOLS) {
  TOOLS['docs.create_xlsx'] = {
    risk: 'low', reversible: true, scope: 'chat',          // effect stays inside the user's own SHERZ file area
    describe: (a) => describeXlsx(a),
    validate: cleanXlsxSpec,
    run: (args, { userId }) => createFile(userId, args, 'xlsx'),
  };
  TOOLS['docs.create_docx'] = {
    risk: 'low', reversible: true, scope: 'chat',          // effect stays inside the user's own SHERZ file area
    describe: (a) => describeDocx(a),
    validate: cleanDocxSpec,
    run: (args, { userId }) => createFile(userId, args, 'docx'),
  };
  TOOLS['docs.create_pdf'] = {
    risk: 'low', reversible: true, scope: 'chat',          // effect stays inside the user's own SHERZ file area
    describe: (a) => describePdf(a),
    validate: cleanPdfSpec,
    run: (args, { userId }) => createFile(userId, args, 'pdf'),
  };
  TOOLS['docs.create_pptx'] = {
    risk: 'low', reversible: true, scope: 'chat',          // effect stays inside the user's own SHERZ file area
    describe: (a) => describePptx(a),
    validate: cleanPptxSpec,
    run: (args, { userId }) => createFile(userId, args, 'pptx'),
  };
  TOOLS['docs.create_text'] = {
    risk: 'low', reversible: true, scope: 'chat',          // a plain .txt / .md file in the user's own file area
    describe: (a) => describeText(a),
    validate: cleanTextSpec,
    async run(args, { userId }) {
      const meta = await getFileStore().put(userId, { name: args.filename, mime: MIME[args.format], bytes: Buffer.from(args.content, 'utf8'), source: 'generated' });
      return { fileId: meta.id, filename: meta.name, bytes: meta.size, mime: meta.mime, download: download(meta.id) };
    },
  };
  TOOLS['docs.create_image'] = {
    // Only the user's own prompt goes out, to the provider that already answers their chat; the picture lands in their own file area.
    risk: 'low', reversible: true, scope: 'chat',
    describe: (a) => describeImage(a),
    validate: cleanImageSpec,
    async run(args, { userId }) {
      const b = imageBudget(userId);
      if (b.left <= 0) throw new Error(`picture limit reached (${b.limit} per hour) — try again later`);
      b.take();
      let img;
      try { img = await getImageProvider()({ prompt: args.prompt, size: args.size }); }
      catch (e) { const l = imageRuns.get(userId); if (l) l.pop(); throw e; }        // a failed attempt does not use up the allowance
      const ext = img.mime === 'image/jpeg' ? 'jpg' : img.mime === 'image/webp' ? 'webp' : 'png';
      const name = args.filename.replace(/\.png$/i, '') + '.' + ext;
      const meta = await getFileStore().put(userId, { name, mime: MIME[ext], bytes: img.bytes, source: 'generated' });
      return { fileId: meta.id, filename: meta.name, bytes: meta.size, mime: meta.mime, download: download(meta.id), image: true };
    },
  };
  TOOLS['docs.list'] = {
    risk: 'low', reversible: true, observe: true,
    describe: () => 'List your generated and uploaded files',
    validate(a) { if (a && typeof a === 'object' && Object.keys(a).length) throw new Error('this action takes no arguments'); return {}; },
    async run(_a, { userId }) { return { files: (await getFileStore().list(userId)).slice(0, 40).map((f) => ({ id: f.id, name: f.name, size: f.size, source: f.source })) }; },
  };
  TOOLS['docs.read'] = {
    risk: 'low', reversible: true, observe: true,
    describe: (a) => `Read your file "${a.name || a.id}"`,
    validate(a) {
      a = a && typeof a === 'object' ? a : {};
      const id = a.id === undefined ? '' : String(a.id), name = a.name === undefined ? '' : String(a.name);
      if (!id && !name) throw new Error('give the file id or name (see docs.list)');
      if (id.length > 40 || name.length > 120) throw new Error('id or name is too long');
      return id ? { id } : { name };
    },
    async run(a, { userId }) {
      const f = a.id ? await getFileStore().get(userId, a.id) : await getFileStore().findByName(userId, a.name);
      if (!f) throw new Error('file not found (use docs.list to see your files)');
      const ext = extOf(f.name);
      if (ext === 'xlsx') return { id: f.id, name: f.name, kind: 'xlsx', source: f.source, ...(await parseXlsx(f.bytes)) };
      if (ext === 'docx') return { id: f.id, name: f.name, kind: 'docx', source: f.source, ...(await parseDocx(f.bytes)) };
      if (ext === 'pdf') return { id: f.id, name: f.name, kind: 'pdf', source: f.source, ...(await parsePdf(f.bytes)) };
      if (ext === 'pptx') return { id: f.id, name: f.name, kind: 'pptx', source: f.source, ...(await parsePptx(f.bytes)) };
      if (ext === 'txt' || ext === 'md') { const t = f.bytes.toString('utf8'); return { id: f.id, name: f.name, kind: ext, source: f.source, text: t.slice(0, 20000), truncated: t.length > 20000 }; }
      throw new Error('only .xlsx, .docx, .pdf, .pptx, .txt and .md files can be read');
    },
  };
  return TOOLS;
}
export { MIME };
