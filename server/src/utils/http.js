/**
 * HTTP plumbing shared by every route.
 *
 * Every response body is wrapped in a single envelope:
 *
 *   success: { "data": ... }
 *   failure: { "error": { "code": "...", "message": "...", "retryable": bool } }
 *
 * Having exactly one shape means the client's fetch layer can be written once
 * and can never mistake an error payload for data.
 */

/**
 * Wrap an async route handler so a rejected promise reaches Express's error
 * middleware instead of becoming an unhandled rejection. Express 4 does not do
 * this automatically, and forgetting it once means a hung request.
 *
 * @template {import('express').RequestHandler} T
 * @param {T} handler
 * @returns {import('express').RequestHandler}
 */
export function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

/**
 * @param {import('express').Response} res
 * @param {unknown} data
 * @param {{status?: number, meta?: Record<string, unknown>}} [options]
 */
export function sendData(res, data, options = {}) {
  const { status = 200, meta } = options;
  res.status(status).json(meta ? { data, meta } : { data });
}

/**
 * 201 Created with a `Location` header pointing at the new resource, so the
 * API is self-describing rather than relying on documentation.
 *
 * @param {import('express').Response} res
 * @param {string} location
 * @param {unknown} data
 */
export function sendCreated(res, location, data) {
  res.status(201).location(location).json({ data });
}

/** @param {import('express').Response} res */
export function sendNoContent(res) {
  res.status(204).end();
}

/**
 * Read a bounded integer query parameter. Returns `fallback` for anything
 * missing or unparseable so a hand-typed URL cannot produce `NaN` offsets that
 * silently return the wrong slice.
 *
 * @param {unknown} value
 * @param {{fallback: number, min: number, max: number}} bounds
 * @returns {number}
 */
export function boundedInt(value, bounds) {
  const { fallback, min, max } = bounds;
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
