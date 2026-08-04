// middleware/validate.js
// ─────────────────────────────────────────────────────────────────
// SHERZ AI — Zod request body validation middleware
//
// Usage:
//   import { validate } from '../middleware/validate.js';
//   router.post('/register', validate(RegisterSchema), handler);
//
// On failure → 400 JSON with array of readable error messages
// On success → req.body is replaced with the parsed (safe) data
// ─────────────────────────────────────────────────────────────────

/**
 * @param {import('zod').ZodSchema} schema
 * @returns {import('express').RequestHandler}
 */
export function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = result.error.errors.map(e => ({
        field:   e.path.join('.') || 'body',
        message: e.message,
      }));
      return res.status(400).json({ ok: false, errors });
    }
    // Replace req.body with the clean, coerced data from Zod
    req.body = result.data;
    next();
  };
}
