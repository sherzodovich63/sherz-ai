#!/usr/bin/env node
// SHERZ Helper — lets SHERZ AI work with ONE folder on this computer, only after you approved a plan in the chat.
//
//   First run (pairing):  node sherz-helper.mjs --server https://sherz-ai.onrender.com --folder "C:\Users\you\SherzFiles" --code ABCD-1234
//   Later runs:           node sherz-helper.mjs
//
// • Needs Node 18+. No dependencies. Connects OUT to the server (long-polling) — no ports are opened on your PC.
// • Can only touch the shared folder (see fsTools.mjs). Delete/overwrite move the old copy to <folder>/.sherz-trash/.
// • Every action is printed here. Press Ctrl+C to stop; "--forget" removes the saved pairing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openRoot, runAction, HelperError } from './fsTools.mjs';

const CONFIG = process.env.SHERZ_HELPER_CONFIG || path.join(os.homedir(), '.sherz-helper.json');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    if (k === 'forget') out.forget = true;
    else out[k] = argv[++i];
  }
  return out;
}
const loadCfg = () => { try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch { return {}; } };
const saveCfg = (c) => fs.writeFileSync(CONFIG, JSON.stringify(c, null, 2), { mode: 0o600 });
const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(server, p, { method = 'GET', token, body, signal } = {}) {
  const r = await fetch(server.replace(/\/+$/, '') + p, {
    method, signal,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  return { status: r.status, ok: r.ok, json };
}

export async function runHelper({ server, token, root, stop = { stopped: false }, quiet = false }) {
  const say = quiet ? () => {} : log;
  let backoff = 1000;
  while (!stop.stopped) {
    let res;
    try {
      res = await api(server, '/api/helper/d/poll', { token });
      backoff = 1000;
    } catch (e) {
      say(`cannot reach the server (${e.message}) — retrying in ${Math.round(backoff / 1000)}s`);
      await sleep(backoff); backoff = Math.min(backoff * 2, 30000); continue;
    }
    if (res.status === 401) { say('This helper was disconnected (revoked or unknown). Run it again with a new --code. Stopping.'); return 'revoked'; }
    if (res.status === 204 || !res.json || !res.json.job) continue;          // nothing to do — poll again
    const job = res.json.job;
    say(`▶ ${job.tool} ${JSON.stringify(job.args).slice(0, 160)}`);
    let payload;
    try { payload = { jobId: job.id, ok: true, output: await runAction(root, job.tool, job.args) }; }
    catch (e) {
      payload = { jobId: job.id, ok: false, error: e instanceof HelperError ? e.message : `unexpected error: ${e.code || e.message}` };
      say(`✗ refused/failed: ${payload.error}`);
    }
    if (payload.ok) say('✓ done');
    try { await api(server, '/api/helper/d/result', { method: 'POST', token, body: payload }); }
    catch (e) { say(`could not send the result (${e.message})`); }
  }
  return 'stopped';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.forget) { try { fs.unlinkSync(CONFIG); console.log('Pairing removed.'); } catch { console.log('Nothing to remove.'); } return; }
  let cfg = loadCfg();
  const server = args.server || cfg.server;
  const folder = args.folder || cfg.folder;
  if (!server || !folder) {
    console.log('Usage (first time): node sherz-helper.mjs --server https://YOUR-SERVER --folder "/path/to/shared/folder" --code ABCD-1234');
    console.log('In SHERZ chat type  /helper  to get your code.'); process.exit(1);
  }
  const root = await openRoot(folder).catch((e) => { console.error('✗', e.message); process.exit(1); });

  if (args.code) {
    log('pairing…');
    const r = await api(server, '/api/helper/d/pair', { method: 'POST', body: { code: args.code, name: args.name || os.hostname() } });
    if (!r.ok || !r.json?.token) { console.error('✗ pairing failed:', r.json?.error || r.status); process.exit(1); }
    cfg = { server, folder: root, token: r.json.token };
    saveCfg(cfg);
    log('✓ paired. Saved to', CONFIG);
  } else if (!cfg.token) { console.error('✗ not paired yet — add --code from the /helper command in SHERZ chat.'); process.exit(1); }
  else if (args.folder) { cfg.folder = root; saveCfg(cfg); }

  console.log(`\nSHERZ helper is running.\n  server: ${server}\n  folder: ${root}\n  SHERZ can only touch this folder, and only after you approve a plan in the chat. Ctrl+C to stop.\n`);
  const stop = { stopped: false };
  process.on('SIGINT', () => { stop.stopped = true; console.log('\nstopping…'); setTimeout(() => process.exit(0), 300); });
  await runHelper({ server, token: cfg.token, root, stop });
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('sherz-helper.mjs')) main();
