/**
 * Route parameter schemas.
 *
 * Validating params matters more than it looks: an unvalidated `:id` reaches
 * Mongoose, which throws a `CastError` that has to be translated back into a
 * friendly message by the error handler. Rejecting it at the edge keeps the
 * error specific ("not a valid id") and keeps the database layer out of the
 * business of shape-checking input.
 */

import { z } from 'zod';

import { objectId } from './common.js';

/** `/:id` */
export const idParam = z.object({ id: objectId });

/** `/:id` where the id refers to a subject, for readable field names in errors. */
export const subjectIdParam = z.object({ id: objectId });
