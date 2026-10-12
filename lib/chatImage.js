// lib/chatImage.js — one picture + text per chat turn, sent as multipart/form-data.
//
//   POST /api/chat-stream   (or /api/chat)      Content-Type: multipart/form-data
//     fields:  message, userId, conversationId, expertMode (all text)
//     file:    image            (jpeg / png / webp / gif, max 10 MB)
//
// The middleware turns the uploaded file into a data URL on req.body.image, which is exactly what
// runBrain()/runExpertTurn() already hand to the vision model — so everything downstream is unchanged.
// The type is decided by the file's real bytes (never by the client's filename / Content-Type), and
// only data URLs are ever forwarded to the model (a client cannot make the server fetch a URL).
import multer from 'multer';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const IMAGE_MARK = '📷 [image]';                       // what is saved in the chat history for a turn that had a picture
export const IMAGE_ONLY_PROMPT = 'The user sent a picture without any text. Look at it and reply naturally: say what you see and what seems most relevant or useful to them.';

/** Real image type from the first bytes, or null. */
export function sniffImageType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  const head = buf.subarray(0, 6).toString('latin1');
  if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

export const toDataUrl = (buf, mime) => `data:${mime};base64,${buf.toString('base64')}`;

/** Accepts only a well-formed base64 image data URL of an allowed type & size; anything else → null. */
export function normalizeImage(value) {
  if (typeof value !== 'string' || value.length < 30 || value.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 64) return null;
  const m = /^data:image\/(?:jpeg|jpg|png|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!m) return null;
  const buf = Buffer.from(m[1], 'base64');
  if (!buf.length || buf.length > MAX_IMAGE_BYTES) return null;
  const real = sniffImageType(buf);
  return real ? toDataUrl(buf, real) : null;
}

/** What gets stored as the user's message when the turn had a picture (the bytes themselves are not stored). */
export const chatImageNote = (text) => IMAGE_MARK + (text ? '\n' + text : '');

const parseBool = (v) => v === true || v === 'true' || v === '1';

/** Express middleware: multipart → req.body.{fields…, image: dataURL}; JSON requests pass through (image validated). */
export function chatImageMiddleware() {
  const one = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 20, fieldSize: 200 * 1024, parts: 25 },
  }).single('image');

  return (req, res, next) => {
    if (!req.is('multipart/form-data')) {                       // classic JSON body: keep working, but only trust a real image data URL
      if (req.body && 'image' in req.body) req.body.image = normalizeImage(req.body.image) || undefined;
      return next();
    }
    one(req, res, (err) => {
      if (err) {
        const tooBig = err.code === 'LIMIT_FILE_SIZE';
        const unexpected = err.code === 'LIMIT_UNEXPECTED_FILE';
        return res.status(tooBig ? 413 : 400).json({
          ok: false,
          error: tooBig ? `Image is too large (max ${MAX_IMAGE_BYTES / 1024 / 1024} MB).` : (unexpected ? 'Send the picture in a field named "image".' : 'Could not read the upload.'),
        });
      }
      req.body = req.body || {};
      const f = req.file;
      if (f) {
        const real = sniffImageType(f.buffer);
        if (!real) return res.status(415).json({ ok: false, error: 'Unsupported image. Use JPEG, PNG, WEBP or GIF.' });
        req.body.image = toDataUrl(f.buffer, real);
        req.imageInfo = { mime: real, bytes: f.size };
      } else {
        delete req.body.image;
      }
      if ('expertMode' in req.body) req.body.expertMode = parseBool(req.body.expertMode);
      next();
    });
  };
}
