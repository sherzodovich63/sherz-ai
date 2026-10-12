// Stub model: records the system prompt it was given and echoes a fixed, non-templated-looking reply.
export const openai = { chat: { completions: { create: async ({ messages, model }, opts) => {
  (globalThis.__prompts ??= []).push(messages[0].content);
  (globalThis.__calls ??= []).push({ model, timeout: opts?.timeout });
  const last = messages[messages.length - 1].content;
  const text = typeof last === 'string' ? last : '';
  const content = /yordam|kod/i.test(text) ? 'Mana 1) birinchi qadam, keyin kod yoz. Nima xato?' : 'MODEL_REPLY:' + text;
  return { choices: [{ message: { content } }] };
} } } };
