# Message deletion — server step (about 1 minute, no database migration)

1. Extract the ZIP over your project folder. It adds/overwrites:
   - `public/index.html`, `public/script.js`, `public/sherz-modern.css`
   - `lib/messages.js` (new)
   - `apply_server_patch_messages.mjs` (new)
   - `tests/messages.test.mjs` (new, optional)

2. In the project folder run:

       node apply_server_patch_messages.mjs server.js

   It checks every edit first, writes nothing unless all match, and keeps a backup
   (`server.js.bak-<time>`). Safe to run twice.

3. Restart the server (`node server.js`). No `prisma migrate` needed — the `Message` table already exists.

New routes (signed-in owner only; someone else's id behaves like "not found"):

| Method | Path | Body | Result |
|---|---|---|---|
| DELETE | `/api/messages/:id` | – | `{ok:true, deleted:[id]}` or 404 |
| POST | `/api/messages/delete` | `{ids:[…]}` (max 200) | `{ok:true, deleted:[…], count}` |

Deleted rows are removed from Postgres/SQLite and also disappear from what the model sees,
because the chat context is read from the same table.

If the UI shows "Deleting messages needs the server update", this step has not been applied
(or the server was not restarted) — the message reappears in the chat instead of vanishing.

Optional test: `node --test tests/messages.test.mjs` (the HTTP test needs `npm i express`).
