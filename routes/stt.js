// routes/stt.js — POST /api/stt (voice → text). Mounted in server.js BEFORE the old inline route, which stays as dead code (nothing deleted).
// multipart "file" (or JSON "audio" data URL) + optional "hint" (the app language, only used to bias spelling).
import { Router } from 'express';
import { transcribe } from '../lib/stt.js';

export function sttRouter({ upload, getVocab = async () => '', env = process.env, fetchImpl = globalThis.fetch, log = console } = {}) {
  const r = Router();
  r.post('/', upload.single('file'), async (req, res) => {
    try {
      let buffer = null, mime = null, filename = null;
      if (req.file?.buffer) {
        buffer = req.file.buffer; mime = req.file.mimetype || 'audio/webm'; filename = req.file.originalname || `audio.${(mime.split('/')[1] || 'webm').split(';')[0]}`;
      } else if (req.body?.audio) {
        const m = String(req.body.audio).match(/^data:(audio\/[a-z0-9.+-]+);base64,(.+)$/i);
        if (!m) return res.status(400).json({ ok: false, error: 'audio (base64 data URL) noto‘g‘ri format' });
        mime = m[1]; buffer = Buffer.from(m[2], 'base64'); filename = `audio.${mime.split('/')[1] || 'webm'}`;
      } else {
        return res.status(400).json({ ok: false, error: 'Fayl topilmadi: multipart "file" yoki JSON "audio" kerak' });
      }
      const hint = String(req.body?.hint || '').slice(0, 5).toLowerCase();
      const vocab = await getVocab(req.user?.id).catch(() => '');
      const out = await transcribe({ buffer, mime, filename, hint, vocab, env, fetchImpl, log });
      if (out.fellBack) log.warn && log.warn(`[stt] answered by the fallback (${out.provider})`);
      log.log && log.log(`[stt] ${out.provider}${out.model ? '/' + out.model : ''} ${out.ms}ms lang=${out.lang || '?'} "${out.text.slice(0, 60)}"`);
      return res.json({ ok: true, text: out.text.trim(), lang: out.lang, provider: out.provider, ms: out.ms });
    } catch (e) {
      log.error && log.error('[stt] error:', e.message);
      if (e.code === 'unclear') return res.status(422).json({ ok: false, error: 'Gapingiz aniq eshitilmadi — yana bir bor ayting.', unclear: true });
      if (e.status === 501) return res.status(501).json({ ok: false, error: 'STT disabled (API key missing)' });
      return res.status(e.status >= 400 && e.status < 500 ? e.status : 502).json({ ok: false, error: e.message || 'stt failed' });
    }
  });
  return r;
}
