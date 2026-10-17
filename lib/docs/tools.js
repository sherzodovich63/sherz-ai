// lib/docs/tools.js — registers the document tools into the agent registry (called once from registry.js).
//   docs.create_xlsx / docs.create_docx   state-changing → ALWAYS go through the Approval Gate (risk low, reversible: delete in /files)
//   docs.list / docs.read                 read-only "observe" tools for files the user created or uploaded (results are untrusted data)
// None of them touch the user's computer or the network; they only write to / read from the user's own file store.
import { cleanXlsxSpec, describeXlsx, cleanDocxSpec, describeDocx, cleanPdfSpec, describePdf, cleanPptxSpec, describePptx, MIME } from './spec.js';
import { buildXlsx, parseXlsx } from './xlsx.js';
import { buildDocx, parseDocx } from './docx.js';
import { buildPdf, parsePdf } from './pdf.js';
import { buildPptx, parsePptx } from './pptx.js';
import { getFileStore } from './store.js';

const extOf = (n) => (/\.(xlsx|docx|pdf|pptx)$/i.exec(n) || [])[1]?.toLowerCase();
const download = (id) => `/api/files/${id}/download`;

async function createFile(userId, spec, kind) {
  const built = kind === 'xlsx' ? await buildXlsx(spec) : kind === 'pdf' ? await buildPdf(spec) : kind === 'pptx' ? await buildPptx(spec) : await buildDocx(spec);
  const meta = await getFileStore().put(userId, { name: spec.filename, mime: built.mime, bytes: built.buffer, source: 'generated' });
  return { fileId: meta.id, filename: meta.name, bytes: meta.size, mime: meta.mime, download: download(meta.id), ...(kind === 'xlsx' ? { sheets: spec.sheets.map((s) => ({ name: s.name, rows: s.rows.length })) } : kind === 'pptx' ? { slides: spec.slides.length } : { blocks: spec.blocks.length }) };
}

export function registerDocTools(TOOLS) {
  TOOLS['docs.create_xlsx'] = {
    risk: 'low', reversible: true,
    describe: (a) => describeXlsx(a),
    validate: cleanXlsxSpec,
    run: (args, { userId }) => createFile(userId, args, 'xlsx'),
  };
  TOOLS['docs.create_docx'] = {
    risk: 'low', reversible: true,
    describe: (a) => describeDocx(a),
    validate: cleanDocxSpec,
    run: (args, { userId }) => createFile(userId, args, 'docx'),
  };
  TOOLS['docs.create_pdf'] = {
    risk: 'low', reversible: true,
    describe: (a) => describePdf(a),
    validate: cleanPdfSpec,
    run: (args, { userId }) => createFile(userId, args, 'pdf'),
  };
  TOOLS['docs.create_pptx'] = {
    risk: 'low', reversible: true,
    describe: (a) => describePptx(a),
    validate: cleanPptxSpec,
    run: (args, { userId }) => createFile(userId, args, 'pptx'),
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
      if (ext === 'xlsx') return { id: f.id, name: f.name, kind: 'xlsx', ...(await parseXlsx(f.bytes)) };
      if (ext === 'docx') return { id: f.id, name: f.name, kind: 'docx', ...(await parseDocx(f.bytes)) };
      if (ext === 'pdf') return { id: f.id, name: f.name, kind: 'pdf', ...(await parsePdf(f.bytes)) };
      if (ext === 'pptx') return { id: f.id, name: f.name, kind: 'pptx', ...(await parsePptx(f.bytes)) };
      throw new Error('only .xlsx, .docx, .pdf and .pptx files can be read');
    },
  };
  return TOOLS;
}
export { MIME };
