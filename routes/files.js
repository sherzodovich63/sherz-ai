// routes/files.js — mounted at /api/files (behind the global JWT guard in server.js). Owner-only.
//   GET    /api/files                list my files (+ usage)
//   GET    /api/files/:id/download   the file (attachment, never rendered inline)
//   DELETE /api/files/:id
//   POST   /api/files/upload         raw body (.xlsx / .docx / .pdf / .pptx, max 5 MB), header X-Filename — so the AI can read it with docs.read
import express, { Router } from 'express';
import { getFileStore, QUOTA } from '../lib/docs/store.js';
import { assertSafeZip, MAX_UPLOAD_BYTES } from '../lib/docs/zipguard.js';
import { MIME, cleanFilename } from '../lib/docs/spec.js';

export function filesRouter({ isProd = false, ensureUser = async () => {}, store = null } = {}) {
  const r = Router();
  const st = () => store || getFileStore();
  const uid = (req) => req.user?.id || (!isProd ? String(req.query?.userId || 'u1') : null);
  const wrap = (fn) => async (req, res) => {
    try {
      const userId = uid(req); if (!userId) return res.status(401).json({ ok: false, error: 'login required' });
      await ensureUser(userId); await fn(req, res, userId);
    } catch (e) {
      if (e instanceof RangeError) return res.status(400).json({ ok: false, error: e.message });
      if (/prisma db push/.test(String(e.message))) return res.status(503).json({ ok: false, error: e.message });
      console.error('[files] route error:', e); res.status(500).json({ ok: false, error: 'Files error' });
    }
  };
  r.get('/', wrap(async (_req, res, userId) => res.json({ ok: true, files: await st().list(userId), usage: await st().usage(userId), quota: QUOTA })));
  r.get('/:id/download', wrap(async (req, res, userId) => {
    const f = await st().get(userId, req.params.id); if (!f) return res.status(404).json({ ok: false, error: 'not found' });
    const ascii = f.name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    res.set({ 'Content-Type': f.mime, 'Content-Length': String(f.bytes.length), 'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store', 'Content-Security-Policy': "default-src 'none'; sandbox" });
    res.end(f.bytes);
  }));
  r.delete('/:id', wrap(async (req, res, userId) => (await st().remove(userId, req.params.id)) ? res.json({ ok: true }) : res.status(404).json({ ok: false, error: 'not found' })));
  r.post('/upload', express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }), wrap(async (req, res, userId) => {
    const raw = String(req.headers['x-filename'] || ''); let name; try { name = decodeURIComponent(raw); } catch { name = raw; }
    const ext = (/\.(xlsx|docx|pdf|pptx)$/i.exec(name) || [])[1]?.toLowerCase();
    if (!ext) throw new RangeError('only .xlsx, .docx, .pdf and .pptx files can be uploaded');
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!body.length) throw new RangeError('the file is empty');
    if (ext === 'pdf') { if (body.subarray(0, 5).toString('latin1') !== '%PDF-') throw new RangeError('this does not look like a PDF file'); }
    else { try { await assertSafeZip(body); } catch (e) { throw new RangeError(e.message); } }
    const meta = await st().put(userId, { name: cleanFilename(name, ext), mime: MIME[ext], bytes: body, source: 'uploaded' });
    res.status(201).json({ ok: true, file: meta });
  }));
  // body-parser errors (too large) → clean JSON
  r.use((err, _req, res, next) => (err && err.type === 'entity.too.large' ? res.status(413).json({ ok: false, error: 'file is larger than 5 MB' }) : next(err)));
  return r;
}
