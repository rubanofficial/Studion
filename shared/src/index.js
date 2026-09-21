/**
 * @focusforge/core — the shared, framework-free domain layer.
 *
 * Both the Express API and the React client import from here so that a number
 * computed in the browser and a number computed on the server are produced by
 * literally the same code. This is what makes "the server is authoritative"
 * achievable rather than aspirational: the client's optimistic view is not an
 * approximation of the server's answer, it *is* the server's answer applied to
 * data the client has so far observed.
 */

export * from './constants.js';
export * from './time.js';
export * from './timezone.js';
export * from './periods.js';
export * from './timeline.js';
export * from './focusScore.js';
export * from './analytics.js';
export * from './streaks.js';
export * from './goals.js';
export * from './insights.js';
export * from './achievements.js';
export * from './labels.js';
