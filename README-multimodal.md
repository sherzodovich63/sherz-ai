# SHERZ AI — multimodal fix (image + text in one message)

## Install
1. `npm install multer`   (the only new dependency)
2. Copy over your project, keeping folders:
   - `server.js`  (project root)
   - `lib/chatImage.js`, `lib/messages.js`  (new `lib/` folder next to server.js)
   - `public/index.html`, `public/script.js`, `public/sherz-modern.css`
3. Restart `node server.js`. No database migration.

> `server.js` here includes the Projects + message-delete work. If you hand-edited server.js,
> don't overwrite it — run `node apply_server_patch_multimodal.mjs server.js` instead (idempotent, makes a backup).

## What was wrong
The live send path is `sendToServer()` in index.html (not `sendMessage` in script.js). It only ever posted JSON text,
so the attached picture was never read. An old handler in script.js also fired a second send; it is now disabled.

## What changed
- Send now builds `FormData` (`image` + `message` + `userId` + `conversationId`) when a picture is attached, JSON otherwise.
- Big photos are shrunk to max 1600px JPEG before upload.
- Preview + textarea clear only after the server accepts the request; if it rejects (400/413/415) the error shows and the picture stays for retry.
- Image-only messages work.
- Server: multer (memory, 10 MB cap in lib/chatImage.js), type checked by magic bytes, passed to the vision model as a data URL.
- Prisma stores text only: history keeps `📷 [image]` + your text (shown as a small "Rasm" chip after reload). Image bytes are not stored.

Tests: `node --test tests/*.test.mjs`

## Hotfix (preview + req.user)
- Preview showed only "Prevyu": the server's CSP `img-src` had no `blob:`, so the object-URL thumbnail was blocked. Preview and chat thumbnail now use `data:` URLs (script.js, index.html), and `blob:` was added to `img-src` in server.js.
- `TypeError … reading 'id'` (server.js:526): in dev (`NODE_ENV` != production) the global `/api` guard skipped auth completely, so `req.user` was never set. It now runs `optionalAuth` (decodes the token if sent), and the 4 routes that used `req.user.id` directly (`/api/facts/:userId`, `/api/daily-briefing`, `POST /api/todo`, `GET /api/todos`) fall back to the dev user id; in production they still require the JWT.

## Hotfix 2 (reply never arrives after an image)
- `brain/brain.js`: the image was attached to the message *before* the context analyzer ran, which turned it into "[object Object]" in recent-messages. Now attached right before the model call.
- `server.js`: logs `[chat-stream] image turn …` / `reply ready …` so you can see in the terminal where an image turn stops.
- `public/index.html`: 45 s watchdog (server pings every 15 s) — if nothing arrives, the dots are removed and an error is shown instead of spinning forever.

## Hotfix 3 (image answered in the terminal but never shown)
`server.js` /api/chat-stream used `req.on('close')` to detect a disconnected client. After a multipart upload (multer) that event fires as soon as the body is read, so `closed` became true and every chunk/ping/done was dropped. It now listens on `res`.
