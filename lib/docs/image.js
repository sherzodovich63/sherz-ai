// lib/docs/image.js — the picture provider behind docs.create_image.
// Only the user's own prompt text leaves the server (to OpenAI, the same provider that answers the chat); the picture comes back as bytes
// and is stored in the user's SHERZ file area like any other file. Model is configurable: IMAGE_MODEL (default "dall-e-3"; "gpt-image-1" also works).
// Tests (and other providers) plug in through setImageProvider().
const SIZES = {
  dalle: { square: '1024x1024', portrait: '1024x1792', landscape: '1792x1024' },
  gpt: { square: '1024x1024', portrait: '1024x1536', landscape: '1536x1024' },
};
const FRIENDLY = (code, msg) => {
  if (/content_policy|safety|moderation/i.test(`${code} ${msg}`)) return 'The image service refused this request (safety rules). Try different wording.';
  if (/billing|quota|insufficient/i.test(`${code} ${msg}`)) return 'The image service has no credit left (billing). Ask the owner to check the OpenAI account.';
  if (/rate_limit/i.test(`${code} ${msg}`)) return 'The image service is busy right now. Try again in a minute.';
  if (/model.*(not found|does not exist|access)|must be verified/i.test(msg)) return 'This image model is not available for the account. Set IMAGE_MODEL to one you can use (dall-e-3 or gpt-image-1).';
  return 'The image service could not draw this picture. Try again or change the description.';
};

export async function openaiImageProvider({ prompt, size = 'square' }, { fetchImpl = globalThis.fetch, env = process.env } = {}) {
  const key = env.OPENAI_API_KEY; if (!key) throw new Error('Image generation is not configured (OPENAI_API_KEY is missing).');
  const model = env.IMAGE_MODEL || 'dall-e-3', gpt = /^gpt-image/i.test(model);
  const body = { model, prompt, n: 1, size: (gpt ? SIZES.gpt : SIZES.dalle)[size] || '1024x1024' };
  if (gpt) body.quality = env.IMAGE_QUALITY || 'medium'; else { body.response_format = 'b64_json'; body.quality = 'standard'; }
  let r;
  try {
    r = await fetchImpl('https://api.openai.com/v1/images/generations', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(110000),
    });
  } catch (e) { throw new Error(e && e.name === 'TimeoutError' ? 'The image took too long (over 110 s). Try a simpler description.' : 'Could not reach the image service. Check the internet connection.'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { console.warn('[image] provider error', r.status, j?.error?.code, j?.error?.message); throw new Error(FRIENDLY(j?.error?.code || '', j?.error?.message || '')); }
  const b64 = j?.data?.[0]?.b64_json; if (!b64) throw new Error('The image service returned no picture.');
  return { bytes: Buffer.from(b64, 'base64'), mime: 'image/png', revisedPrompt: j?.data?.[0]?.revised_prompt || null };
}

let provider = openaiImageProvider;
export const getImageProvider = () => provider;
export const setImageProvider = (fn) => { provider = fn || openaiImageProvider; return provider; };
