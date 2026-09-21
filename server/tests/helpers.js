/**
 * Test harness.
 *
 * Tests run against the real Express app and a real MongoDB engine (in-memory),
 * never a mock. That trades a few seconds of startup for the ability to verify
 * the things that actually break in production: unique-index behaviour, atomic
 * upserts, Mongoose casting, and the exact JSON a client receives.
 *
 * Each test file owns its own database lifecycle. `resetDatabase` runs between
 * cases so tests cannot leak state into one another through a shared index.
 */

import request from 'supertest';

import { createApp } from '../src/app.js';
import { clearDatabase, connectDatabase, disconnectDatabase, syncIndexes } from '../src/db/connect.js';

let app = null;

/** Build the app once per test file, connected to a fresh in-memory database. */
export async function bootstrap() {
  await connectDatabase();
  await syncIndexes();
  app = createApp();
}

export async function teardown() {
  await disconnectDatabase();
  app = null;
}

/** Wipe all data but keep the connection and indexes. */
export async function resetDatabase() {
  await clearDatabase();
}

/** @returns {import('express').Express} */
export function getApp() {
  if (!app) throw new Error('bootstrap() must be called before getApp().');
  return app;
}

export const DEFAULT_PASSWORD = 'correct-horse-battery';

let counter = 0;

export function uniqueEmail(prefix = 'user') {
  counter += 1;
  return `${prefix}-${counter}-${Date.now()}@example.test`;
}

/**
 * Register a user and return their credentials plus a pre-authenticated request
 * builder, so tests read as intent rather than as plumbing.
 *
 * @param {{email?: string, password?: string, name?: string, timeZone?: string}} [overrides]
 */
export async function registerUser(overrides = {}) {
  const email = overrides.email ?? uniqueEmail();
  const password = overrides.password ?? DEFAULT_PASSWORD;

  const response = await request(getApp())
    .post('/api/auth/register')
    .send({ email, password, name: overrides.name ?? 'Test Student', ...(overrides.timeZone ? { timeZone: overrides.timeZone } : {}) })
    .expect(201);

  const body = response.body.data;
  const refreshCookie = extractRefreshCookie(response);

  return {
    email,
    password,
    id: body.user.id,
    token: body.accessToken,
    refreshCookie,
    /** `authed.get(...)` etc. — attaches the bearer token automatically. */
    authed: authedRequest(body.accessToken),
    /** The raw register response, for assertions about its shape. */
    response,
  };
}

/**
 * A supertest wrapper that attaches the bearer token to every request.
 * @param {string} token
 */
export function authedRequest(token) {
  const api = request(getApp());
  const auth = (/** @type {any} */ test) => test.set('Authorization', `Bearer ${token}`);
  return {
    get: (url) => auth(api.get(url)),
    post: (url) => auth(api.post(url)),
    patch: (url) => auth(api.patch(url)),
    put: (url) => auth(api.put(url)),
    delete: (url) => auth(api.delete(url)),
    raw: api,
  };
}

/**
 * Pull the refresh cookie out of a response that set it.
 * @param {import('supertest').Response} response
 */
export function extractRefreshCookie(response) {
  const cookies = response.headers['set-cookie'] ?? [];
  const found = cookies.find((cookie) => cookie.startsWith('ff_refresh='));
  return found ? found.split(';')[0] : null;
}

/**
 * Sign in and return a fresh session, used to test rotation and multi-device.
 * @param {string} email
 * @param {string} password
 */
export async function login(email, password) {
  const response = await request(getApp()).post('/api/auth/login').send({ email, password });
  return { response, cookie: extractRefreshCookie(response), body: response.body };
}

/**
 * Create a subject directly through the API and return its id.
 * @param {ReturnType<typeof authedRequest>} authed
 * @param {string} name
 * @param {Record<string, unknown>} [extra]
 */
export async function createSubject(authed, name, extra = {}) {
  const response = await authed.post('/api/subjects').send({ name, ...extra }).expect(201);
  return response.body.data.subject;
}

/**
 * A client id that satisfies the API's alphabet and length constraints.
 * @param {string} [suffix]
 */
export function clientId(suffix = Math.random().toString(36).slice(2, 10)) {
  return `testclient_${suffix}_${Date.now().toString(36)}`;
}

/**
 * Assert the standard error envelope. Centralised so every test checks the same
 * contract, and so a change to the envelope fails loudly in one place.
 * @param {import('supertest').Response} response
 * @param {{status: number, code: string}} expected
 */
export function expectError(response, expected) {
  if (response.status !== expected.status) {
    throw new Error(`Expected status ${expected.status} but got ${response.status}: ${JSON.stringify(response.body)}`);
  }
  if (response.body?.error?.code !== expected.code) {
    throw new Error(`Expected code ${expected.code} but got ${response.body?.error?.code}: ${JSON.stringify(response.body)}`);
  }
  return response.body.error;
}
