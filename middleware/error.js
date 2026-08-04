// Middleware/error.js
export function notFound(req, res, next) {
  res.status(404).json({ ok: false, error: 'API route topilmadi' });
}

export function errorHandler(err, req, res, next) {
  console.error('Middleware error:', err);
  res.status(500).json({ ok: false, error: err.message || 'Server xatosi' });
}
