import { ZodError } from 'zod';

export function notFound(req, res) {
  res.status(404).json({ error: `No route for ${req.method} ${req.originalUrl}` });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: err.issues[0]?.message || 'That input looks wrong.',
      field: err.issues[0]?.path?.join('.'),
    });
  }
  if (err?.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || 'value';
    return res.status(409).json({ error: `That ${field} is already taken.`, field });
  }
  if (err?.name === 'ValidationError') {
    const first = Object.values(err.errors)[0];
    return res.status(400).json({ error: first?.message || 'Invalid data.' });
  }
  // `code` is for the client to branch on. Matching on the message text works
  // right up until someone rewords it, so anything the UI must react to
  // differently — rather than merely display — carries a stable code.
  if (err?.status)
    return res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });

  console.error('  error    ', err);
  res.status(500).json({ error: 'Something broke on our side.' });
}

export const httpError = (status, message, extra = {}) =>
  Object.assign(new Error(message), { status, ...extra });
