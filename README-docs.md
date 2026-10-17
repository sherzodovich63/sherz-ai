# SHERZ — File tools (Excel & Word) — Phase 5

The AI can now **create Excel (.xlsx) and Word (.docx) files** and **read** files you upload. Every created file goes through the Approval Gate: you see what will be made, approve, then get a Download button. Nothing is made without a click, and these tools are never auto-approved (3c allowlist is files.list/read/mkdir only).

## Install (3 steps)
1. `npm install exceljs docx mammoth jszip pdfkit pptxgenjs pdfjs-dist@4`
2. Add the model from `prisma/Files.prisma.txt` to `schema.prisma` (including `generatedFiles GeneratedFile[]` on `User`), then `npx prisma db push`.
   Without it the server still boots and files live in memory (lost on restart) — a warning is logged.
3. Copy the files in this ZIP over your project (full files; `server.js` has two small additions: the `/api/files` router and the store).

## How it works
- The model only writes **structured JSON**; server code builds the file. No macros, images, links or external references.
- Formulas: allowlisted plain functions only (SUM, AVERAGE, IF, ROUND, VLOOKUP, SUMIF …). `HYPERLINK`, `INDIRECT`, other files, `[ ] { } @ # |` are rejected.
- Limits: xlsx ≤10 sheets, ≤5000 rows, ≤40 columns; docx ≤400 blocks, ≤120k chars; file ≤5 MB; **40 files / 60 MB per user** (you get an error and delete via `/files` — nothing is removed silently).
- Reading: `docs.list` / `docs.read` (observation tools). Text is returned as untrusted data, clipped, with `<<<`/`>>>` stripped; the network tool is switched off once file text is in the run (same exfiltration guard as `files.read`).
- Uploads: `.xlsx/.docx` only, zip-guarded (magic bytes, entry count, unpacked size, macros refused).
- Download: owner-only, `Content-Disposition: attachment`, `nosniff`, sandbox CSP.

## Using it
- Chat: “make an Excel budget for October”, “write a one-page project brief in Word”. In `/agent` mode you get a plan card → **Approve** → **⬇ Download**.
- `/files` shows your files, usage, Upload, Download, Delete.
- “Summarise my file budget.xlsx” → the AI reads it with `docs.read`. To change a file it reads it and makes a new corrected file.

## Tests
`node --test tests/*.test.mjs` → 253 pass (new: `tests/docs.test.mjs`, 12 tests). Browser: `tests/fe/files.e2e.test.mjs` (10 checks). Generated files were also opened in LibreOffice.

## Changed / new files
New: `lib/docs/{spec,zipguard,xlsx,docx,store,tools}.js`, `routes/files.js`, `prisma/Files.prisma.txt`, tests.
Changed: `server.js`, `lib/agent/{registry,react,expertBridge}.js`, `brain/expertTurn.js`, `public/index.html`, two assertion updates in `tests/agent.test.mjs` / `tests/agentLoop.test.mjs`.

## Update: file requests no longer need "/agent"
Tools only exist in Expert Mode. `server.js` now turns Expert Mode on by itself when the message asks for an Excel/Word file
(`lib/docs/intent.js`, e.g. "make an Excel budget", "word fayl tayyorla", "сделай эксель"). A plain "show a table" stays normal chat.

## Update: PDF and PowerPoint
- New tools: `docs.create_pdf` (same blocks as Word: headings, paragraphs, lists, tables, page breaks, footer + page numbers) and `docs.create_pptx` (slides: title, section, bullets, text, table; speaker notes; 16:9; max 40 slides, 12 bullets per slide). Both go through the approval gate like Excel/Word and are never auto-approved.
- `docs.read` and uploads now also accept `.pdf` (text only, first 30 pages, password-protected PDFs refused, 15 s limit) and `.pptx` (text of every slide).
- PDF text uses the bundled DejaVu Sans (`lib/docs/fonts/`, free licence included) so Uzbek oʻ/gʻ and Cyrillic render correctly. Emoji are dropped (the font has none).
- No images, links, scripts, macros or media are ever written into any file.
- Asking for a PDF or a presentation switches Expert Mode on automatically, like Excel/Word.
- Tests: `node --test tests/*.test.mjs` -> 267 pass.

## Troubleshooting: "it printed a Python script instead of making the file"
That means the message was handled as normal chat (no tools). After deploying, a file request must print this line in the server log:
`[docs] file request detected → Expert Mode on (user …)`.
No line => the new `server.js` / `lib/docs/intent.js` are not running yet (restart), or the wording was not recognised (send the exact message).
Line present but still no plan card => Expert Mode itself was refused (`brain/expertModePermissions.js`) or the model did not call the tool.
