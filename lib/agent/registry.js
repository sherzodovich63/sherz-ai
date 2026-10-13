// lib/agent/registry.js
// ─────────────────────────────────────────────────────────────────
// SHERZ Agent — ACTION CONTRACT.
// Every tool the agent can ever run is declared here with:
//   risk        'low' | 'medium' | 'high'   (anything undeclared is treated as 'high' and cannot run)
//   reversible  can the effect be undone?
//   validate    strict argument check → returns cleaned args or throws
//   describe    human sentence shown on the plan card
//   run         the only code that touches the outside world
// Phase 1 runs EVERY step only after explicit user approval; the risk level is what Phase 3
// (context-aware autonomy) will later use to decide what may auto-run.
// ─────────────────────────────────────────────────────────────────
import fs from 'node:fs/promises';
import path from 'node:path';

export const RISK_ORDER = { low: 1, medium: 2, high: 3 };
export const MAX_STEPS = 8;

const NOTE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.(md|txt)$/;
const MAX_NOTE_BYTES = 20 * 1024;

export function sandboxRoot() {
  return path.resolve(process.env.SHERZ_AGENT_SANDBOX || path.join(process.cwd(), 'agent_sandbox'));
}

/** <root>/<user>/ — the only place the Phase-1 tools may touch. Throws if the user id is unsafe. */
export function userSandbox(userId) {
  const safe = String(userId || '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
  if (!safe) throw new Error('no user for sandbox');
  const dir = path.join(sandboxRoot(), safe);
  if (path.relative(sandboxRoot(), dir).startsWith('..')) throw new Error('bad sandbox path');
  return dir;
}
function noteFile(userId, filename) {
  const dir = userSandbox(userId);
  const full = path.resolve(dir, filename);
  if (path.dirname(full) !== dir) throw new Error('path escapes sandbox');   // belt and braces over the regex
  return { dir, full };
}
function str(v, name, max) {
  if (typeof v !== 'string') throw new Error(`${name} must be text`);
  if (v.length > max) throw new Error(`${name} is too long (max ${max})`);
  return v;
}
function filenameArg(v) {
  const f = str(v, 'filename', 64).trim();
  if (!NOTE_NAME.test(f)) throw new Error('filename must be like "ideas.md" or "todo.txt" (letters, digits . _ -)');
  return f;
}
function noArgs(a) {
  if (a && typeof a === 'object' && Object.keys(a).length) throw new Error('this action takes no arguments');
  return {};
}

export const TOOLS = {
  'sandbox.list_notes': {
    risk: 'low', reversible: true,
    describe: () => 'List your notes in the agent sandbox folder',
    validate: noArgs,
    async run(_args, { userId }) {
      const dir = userSandbox(userId);
      let names = [];
      try { names = (await fs.readdir(dir)).filter((n) => NOTE_NAME.test(n)).sort(); } catch { /* folder not created yet */ }
      return { files: names };
    },
  },
  'sandbox.write_note': {
    risk: 'low', reversible: true,
    describe: (a) => `Save a note "${a.filename}" (${Buffer.byteLength(a.content || '', 'utf8')} bytes) in the sandbox folder`,
    validate(a) {
      a = a || {};
      return { filename: filenameArg(a.filename), content: str(a.content ?? '', 'content', MAX_NOTE_BYTES) };
    },
    async run({ filename, content }, { userId }) {
      const { dir, full } = noteFile(userId, filename);
      await fs.mkdir(dir, { recursive: true });
      let existed = true;
      try { await fs.access(full); } catch { existed = false; }
      await fs.writeFile(full, content, 'utf8');
      return { filename, bytes: Buffer.byteLength(content, 'utf8'), overwritten: existed };
    },
  },
  'sandbox.delete_note': {
    risk: 'medium', reversible: false,
    describe: (a) => `Permanently delete the note "${a.filename}" from the sandbox folder`,
    validate(a) { return { filename: filenameArg((a || {}).filename) }; },
    async run({ filename }, { userId }) {
      const { full } = noteFile(userId, filename);
      try { await fs.unlink(full); } catch (e) { if (e.code === 'ENOENT') throw new Error('note does not exist'); throw e; }
      return { filename, deleted: true };
    },
  },
};

export function toolMeta() {
  return Object.entries(TOOLS).map(([name, t]) => ({ name, risk: t.risk, reversible: t.reversible }));
}

/** Validate + normalise raw steps from the model or the user. Returns { steps, risk } or throws with a clear message. */
export function normalizePlan(rawSteps) {
  if (!Array.isArray(rawSteps) || !rawSteps.length) throw new Error('a plan needs at least one step');
  if (rawSteps.length > MAX_STEPS) throw new Error(`a plan can have at most ${MAX_STEPS} steps`);
  let risk = 'low';
  const steps = rawSteps.map((s, i) => {
    const tool = TOOLS[s?.tool];
    if (!tool) throw new Error(`step ${i + 1}: unknown action "${s?.tool}" (allowed: ${Object.keys(TOOLS).join(', ')})`);
    let args;
    try { args = tool.validate(s.args && typeof s.args === 'object' ? s.args : {}); }
    catch (e) { throw new Error(`step ${i + 1}: ${e.message}`); }
    if (RISK_ORDER[tool.risk] > RISK_ORDER[risk]) risk = tool.risk;
    return { tool: s.tool, args, risk: tool.risk, reversible: tool.reversible, summary: tool.describe(args) };
  });
  return { steps, risk };
}
