// lib/agent/autonomy.js — Phase 3c: the per-tool AUTO-APPROVAL policy.
// Everything is OFF by default. The user turns a tool on in /autonomy; nothing else can.
//
// A plan the assistant proposed may run WITHOUT a click only when ALL of these hold:
//   • every step uses an allowlisted, low-risk, helper tool (files.list · files.read · files.mkdir) — a hard-coded list, not a setting
//   • the user switched that tool to "auto"
//   • the step matches a learned habit with HIGH confidence (tool + folder + file type, approved ≥ 8 times net)
//   • the step's folder is inside a folder the user already allowed SHERZ to read
//   • the user's helper is online, the kill switch is off, and the hourly cap is not used up
// Anything else → the normal Approve button. MEDIUM-confidence habits get an "Approve & always allow" offer instead.
// This module only DECIDES. Execution goes through gate.autoApprove(), which keeps every gate check (hash, expiry, kill switch, preflight).
import { TOOLS } from './registry.js';
import { cleanFolder, covers } from './consent.js';

export const AUTO_ALLOWLIST = Object.freeze(['files.list', 'files.read', 'files.mkdir']);
export const MAX_AUTO_STEPS = 5;
export const DEFAULT_PER_HOUR = 20;
export const MAX_PER_HOUR = 60;
const MODES = new Set(['off', 'auto']);

/** the folder whose consent covers this step (null → not decidable → never auto) */
export function autoFolderOf(step) {
  try {
    const p = step?.args?.path;
    if (step.tool === 'files.list') return cleanFolder(p ?? '.');
    if (step.tool === 'files.read' || step.tool === 'files.mkdir') { const c = cleanFolder(p); const i = c.lastIndexOf('/'); return i < 0 ? '.' : c.slice(0, i); }
  } catch { /* fall through */ }
  return null;
}

export function normalizeSettings(raw) {
  const a = raw && typeof raw === 'object' ? raw : {};
  const tools = {};
  for (const t of AUTO_ALLOWLIST) tools[t] = a.tools && MODES.has(a.tools[t]) ? a.tools[t] : 'off';
  const cap = Number.isFinite(+a.maxPerHour) ? Math.min(MAX_PER_HOUR, Math.max(1, Math.floor(+a.maxPerHour))) : DEFAULT_PER_HOUR;
  return { tools, maxPerHour: cap };
}

export function createAutonomy({ store, consent, trust, helper = null, isHalted = () => false } = {}) {
  if (!store || !consent || !trust) throw new Error('autonomy needs store, consent and trust');
  const read = async (userId) => normalizeSettings((await store.get(userId)).autonomy);
  const write = (userId, s) => store.save(userId, { autonomy: s });

  async function get(userId) { return read(userId); }
  async function setTool(userId, tool, mode) {
    if (!AUTO_ALLOWLIST.includes(tool)) throw new Error(`unknown tool for auto-approval (allowed: ${AUTO_ALLOWLIST.join(', ')})`);
    if (!MODES.has(mode)) throw new Error('mode must be "off" or "auto"');
    const s = await read(userId); s.tools[tool] = mode; await write(userId, s); return s;
  }
  async function setCap(userId, n) {
    if (!Number.isFinite(+n)) throw new Error('maxPerHour must be a number');
    const s = await read(userId); s.maxPerHour = normalizeSettings({ maxPerHour: n }).maxPerHour; await write(userId, s); return s;
  }
  async function disableAll(userId) { const s = await read(userId); for (const t of AUTO_ALLOWLIST) s.tools[t] = 'off'; await write(userId, s); return s; }
  async function anyEnabled(userId) { try { return Object.values((await read(userId)).tools).includes('auto'); } catch { return false; } }

  /**
   * plan: normalized steps [{tool,args,...}] · returns
   *   { decision: 'auto'|'ask', reason, basis:[{tool,level,count}], offer: {tools:[…]}|null }
   * `offer` is set when the plan is made of allowlisted tools that are still OFF and every step has at least a MEDIUM habit.
   */
  async function decide({ userId, plan, source = 'assistant', autoRunsLastHour = 0 }) {
    const ask = (reason, extra = {}) => ({ decision: 'ask', reason, basis: [], offer: null, ...extra });
    try {
      if (!Array.isArray(plan) || !plan.length) return ask('empty plan');
      const bad = plan.find((s) => !AUTO_ALLOWLIST.includes(s.tool) || TOOLS[s.tool]?.risk !== 'low' || TOOLS[s.tool]?.target !== 'helper');
      if (bad) return ask(`${bad.tool} is not an auto-approvable tool`);
      if (plan.length > MAX_AUTO_STEPS) return ask('too many steps for auto-approval');

      const settings = await read(userId);
      const dec = await trust.decorate({ steps: plan }, userId);
      const steps = dec.steps || [];
      const lv = steps.map((s) => s.habit?.level || null);
      const basis = steps.map((s) => ({ tool: s.tool, level: s.habit?.level || null, count: s.habit?.count || 0 }));
      const offerTools = [...new Set(plan.filter((s) => settings.tools[s.tool] !== 'auto').map((s) => s.tool))];
      const offer = offerTools.length && lv.every((l) => l === 'medium' || l === 'high') ? { tools: offerTools } : null;

      if (source !== 'assistant') return ask('plan was not proposed by the assistant', { basis, offer });
      const off = plan.find((s) => settings.tools[s.tool] !== 'auto');
      if (off) return ask(`auto-approval is off for ${off.tool}`, { basis, offer });
      if (!lv.every((l) => l === 'high')) return ask('no High-confidence habit for every step', { basis, offer: null });

      const allowed = await consent.list(userId);
      for (const s of plan) { const f = autoFolderOf(s); if (f === null || !covers(allowed, f)) return ask('folder has not been allowed for reading', { basis }); }

      if (isHalted()) return ask('agent is paused by the administrator', { basis });
      if (!(helper && await helper.online(userId))) return ask('your helper is not connected', { basis });
      if (autoRunsLastHour >= settings.maxPerHour) return ask(`hourly auto-run limit reached (${settings.maxPerHour})`, { basis });
      return { decision: 'auto', reason: 'High-confidence habit · allowed tool · allowed folder', basis, offer: null };
    } catch (e) {
      return ask('policy check failed: ' + String(e.message || e));      // any doubt → the normal approval
    }
  }

  return { get, setTool, setCap, disableAll, anyEnabled, decide };
}
