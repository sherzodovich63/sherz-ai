# SHERZ Helper + file tools

The model can now propose file actions on YOUR computer. Nothing runs until you press **Approve & Execute**,
and the work is done by a small program you start yourself, limited to ONE folder.

## Install (server)
1. Copy the files in this ZIP over your project (same paths). NOTE: `server.js` and `brain/expertTurn.js`
   are the full versions from the previous Agent Gate delivery plus the helper wiring — if you edited those two
   files yourself since then, tell me and I'll merge instead of you overwriting.
2. Append the `HelperDevice` model from `prisma/AgentAction.prisma.txt` to `prisma/schema.prisma`, then `npx prisma db push`.
   (If you already added `AgentAction`, only add the new model.)
3. Deploy / restart. No new npm packages.

## Run the helper (your PC, Node 18+)
1. In SHERZ chat type `/helper` → you get a one-time code (valid 10 min) and the exact command.
2. In a terminal (folder with `helper/sherz-helper.mjs`):
   `node helper/sherz-helper.mjs --server https://sherz-ai.onrender.com --folder "C:\SherzFiles" --code ABCD-1234`
   The pairing is saved in `~/.sherz-helper.json`; next time just `node helper/sherz-helper.mjs`
   (`--forget` removes the pairing). Ctrl+C stops it — the server then refuses file plans.
3. Try: `/agent list the files in my folder`, `/agent read notes.txt`, `/agent create a folder called ideas and write plan.md in it`.

## Tools
| tool | risk | note |
|---|---|---|
| files.list / files.read / files.mkdir | low | read ≤100 KB, list ≤500 entries |
| files.write | medium | overwrite only if `overwrite:true`; old copy goes to trash |
| files.move | medium | never overwrites |
| files.delete | medium | moves to `<folder>/.sherz-trash/<time>/…` — recoverable |

## Safety
- The helper only connects OUT to your server (no open ports). Revoke any time (`DELETE /api/helper/devices/:id`).
- All paths are relative to the one folder; `..`, absolute paths, symlink escapes, drive roots and `.sherz-trash` are refused — enforced by the helper itself, not just the server.
- Server checks too: exact plan hash, 30-min expiry, kill switch, first failure stops the plan; helper offline → approval is refused and the plan stays pending.

## Known limits
- File contents/listings appear on the plan card; they are NOT yet fed back to the model for follow-up reasoning.
- Pairing codes are single-use; device token is stored only as a sha256 hash.
- Tests: `node --test tests/*.test.mjs`.
