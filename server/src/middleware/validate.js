/**
 * Request validation.
 *
 * Parsed, coerced, stripped results are attached to `req.validated` rather than
 * overwriting `req.body` / `req.query`. Two reasons:
 *
 *   1. In Express 4 `req.query` is a prototype getter, so assigning to it either
 *      throws (ES modules are strict mode) or silently does nothing depending on
 *      the version. Writing somewhere we own removes that class of bug entirely.
 *   2. It makes the trust boundary explicit and greppable. A controller reading
 *      `req.validated.body` is guaranteed to be holding schema-checked data,
 *      whereas `req.body` is whatever the client sent.
 */

import { ApiError } from '../utils/ApiError.js';

/**
 * Turn a ZodError into the field-level detail the client renders inline.
 * @param {import('zod').ZodError} error
 */
function formatIssues(error) {
  return error.issues.map((issue) => ({
    // Zod prefixes nested paths; keep them readable for a form field lookup.
    field: issue.path.length > 0 ? issue.path.join('.') : '(root)',
    message: issue.message,
    code: issue.code,
  }));
}

/**
 * @param {{body?: import('zod').ZodTypeAny, query?: import('zod').ZodTypeAny, params?: import('zod').ZodTypeAny}} schemas
 * @returns {import('express').RequestHandler}
 */
export function validate(schemas) {
  return (req, _res, next) => {
    /** @type {{body?: unknown, query?: unknown, params?: unknown}} */
    const validated = {};
    /** @type {Array<{field:string,message:string,code:string}>} */
    const allIssues = [];

    for (const key of /** @type {const} */ (['body', 'query', 'params'])) {
      const schema = schemas[key];
      if (!schema) {
        if (key === 'body') validated.body = req.body ?? {};
        else if (key === 'query') validated.query = req.query ?? {};
        else validated.params = req.params ?? {};
        continue;
      }

      const source = key === 'body' ? req.body ?? {} : key === 'query' ? req.query ?? {} : req.params ?? {};
      const result = schema.safeParse(source);

      if (result.success) {
        validated[key] = result.data;
      } else {
        validated[key] = source;
        for (const issue of formatIssues(result.error)) {
          allIssues.push({ ...issue, field: `${key}.${issue.field}` });
        }
      }
    }

    if (allIssues.length > 0) {
      return next(ApiError.validation('Some of the values sent were not valid.', allIssues));
    }

    // @ts-expect-error - augmenting the request with validated data
    req.validated = validated;
    return next();
  };
}

/**
 * Body-only shorthand for the common case, keeping route files readable.
 * @param {import('zod').ZodTypeAny} schema
 * @returns {import('express').RequestHandler}
 */
export function validateBody(schema) {
  return validate({ body: schema });
}
