// Middleware/limits.js
import rateLimit from 'express-rate-limit';

// 1 daqiqada 100 so‘rov limit
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Limit oshib ketdi, keyinroq urinib ko‘ring' }
});
