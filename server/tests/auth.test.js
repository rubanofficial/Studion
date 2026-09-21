import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import { RefreshToken } from '../src/models/RefreshToken.js';
import { User } from '../src/models/User.js';
import {
  DEFAULT_PASSWORD,
  bootstrap,
  expectError,
  extractRefreshCookie,
  getApp,
  login,
  registerUser,
  resetDatabase,
  teardown,
  uniqueEmail,
} from './helpers.js';

beforeAll(bootstrap);
afterAll(teardown);
beforeEach(resetDatabase);

describe('registration', () => {
  it('creates an account, hashes the password, and returns an access token', async () => {
    const user = await registerUser();

    expect(user.response.body.data.user.email).toBe(user.email);
    expect(user.response.body.data.accessToken).toBeTypeOf('string');
    expect(user.refreshCookie).toMatch(/^ff_refresh=/);

    const stored = await User.findOne({ email: user.email }).select('+passwordHash +password');
    expect(stored.passwordHash).toBeTruthy();
    expect(stored.passwordHash.startsWith('$2')).toBe(true);
    // The plaintext must never survive the write.
    expect(stored.password).toBeFalsy();
  });

  it('provisions settings with a usable timezone', async () => {
    const user = await registerUser({ timeZone: 'Asia/Kolkata' });
    const me = await user.authed.get('/api/auth/me').expect(200);
    expect(me.body.data.settings.timeZone).toBe('Asia/Kolkata');
    expect(me.body.data.settings.dailyGoalSeconds).toBeGreaterThan(0);
    expect(me.body.data.settings.focusPresets.length).toBeGreaterThan(0);
  });

  it('never returns the password hash', async () => {
    const user = await registerUser();
    const me = await user.authed.get('/api/auth/me').expect(200);
    expect(JSON.stringify(me.body)).not.toContain('passwordHash');
    expect(me.body.data.user.password).toBeUndefined();
  });

  it('rejects a duplicate email with a conflict rather than a crash', async () => {
    const user = await registerUser();
    const response = await request(getApp())
      .post('/api/auth/register')
      .send({ email: user.email, password: DEFAULT_PASSWORD, name: 'Someone else' });
    expectError(response, { status: 409, code: 'EMAIL_TAKEN' });
  });

  it('normalises email casing so the same address cannot register twice', async () => {
    const email = uniqueEmail('Mixed');
    await request(getApp()).post('/api/auth/register').send({ email: email.toUpperCase(), password: DEFAULT_PASSWORD, name: 'A' }).expect(201);
    const response = await request(getApp()).post('/api/auth/register').send({ email, password: DEFAULT_PASSWORD, name: 'B' });
    expectError(response, { status: 409, code: 'EMAIL_TAKEN' });
  });
});

describe('validation', () => {
  it('rejects a short password with field-level detail', async () => {
    const response = await request(getApp())
      .post('/api/auth/register')
      .send({ email: uniqueEmail(), password: 'short', name: 'Test' });
    const error = expectError(response, { status: 422, code: 'VALIDATION_ERROR' });
    expect(error.details.some((detail) => detail.field === 'body.password')).toBe(true);
  });

  it('rejects a malformed email', async () => {
    const response = await request(getApp())
      .post('/api/auth/register')
      .send({ email: 'not-an-email', password: DEFAULT_PASSWORD, name: 'Test' });
    expectError(response, { status: 422, code: 'VALIDATION_ERROR' });
  });

  it('rejects unexpected fields rather than silently ignoring them', async () => {
    const response = await request(getApp())
      .post('/api/auth/register')
      .send({ email: uniqueEmail(), password: DEFAULT_PASSWORD, name: 'Test', isAdmin: true });
    // An unknown key means client and server disagree about the contract. Better
    // to fail loudly than to let a field be quietly dropped.
    expectError(response, { status: 422, code: 'VALIDATION_ERROR' });
  });

  it('rejects a non-JSON body without a stack trace', async () => {
    const response = await request(getApp())
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": broken');
    expect(response.status).toBe(400);
    expect(response.body.error.message).not.toMatch(/at Object|node_modules/);
  });
});

describe('login', () => {
  it('accepts the right credentials', async () => {
    const user = await registerUser();
    const { response } = await login(user.email, user.password);
    expect(response.status).toBe(200);
    expect(response.body.data.user.id).toBe(user.id);
  });

  it('gives the same answer for a wrong password and an unknown account', async () => {
    const user = await registerUser();
    const wrongPassword = await login(user.email, 'definitely-not-it');
    const unknownUser = await login(uniqueEmail('ghost'), DEFAULT_PASSWORD);

    expect(wrongPassword.response.status).toBe(401);
    expect(unknownUser.response.status).toBe(401);
    // Identical wording, so the endpoint cannot be used to enumerate accounts.
    expect(wrongPassword.body.error.message).toBe(unknownUser.body.error.message);
  });

  it('does not issue a refresh cookie on failure', async () => {
    const user = await registerUser();
    const { cookie } = await login(user.email, 'nope');
    expect(cookie).toBeNull();
  });
});

describe('refresh rotation', () => {
  it('exchanges a refresh cookie for a new access token and rotates the cookie', async () => {
    const user = await registerUser();
    const response = await request(getApp()).post('/api/auth/refresh').set('Cookie', user.refreshCookie).expect(200);

    expect(response.body.data.accessToken).toBeTypeOf('string');
    const rotated = extractRefreshCookie(response);
    expect(rotated).toBeTruthy();
    expect(rotated).not.toBe(user.refreshCookie);

    // The new access token actually works.
    await request(getApp()).get('/api/auth/me').set('Authorization', `Bearer ${response.body.data.accessToken}`).expect(200);
  });

  it('revokes the whole rotation family when a rotated token is replayed', async () => {
    const user = await registerUser();
    const first = await request(getApp()).post('/api/auth/refresh').set('Cookie', user.refreshCookie).expect(200);
    const rotatedCookie = extractRefreshCookie(first);

    // Replaying the *old* token simulates a stolen copy being used after the
    // legitimate client has already exchanged it.
    const replay = await request(getApp()).post('/api/auth/refresh').set('Cookie', user.refreshCookie);
    expectError(replay, { status: 401, code: 'UNAUTHORIZED' });

    // And the legitimate successor is now dead too — safe failure.
    const successor = await request(getApp()).post('/api/auth/refresh').set('Cookie', rotatedCookie);
    expect(successor.status).toBe(401);

    const live = await RefreshToken.countDocuments({ revokedAt: null });
    expect(live).toBe(0);
  });

  it('rejects an unknown refresh token', async () => {
    const response = await request(getApp()).post('/api/auth/refresh').set('Cookie', 'ff_refresh=not-a-real-token');
    expectError(response, { status: 401, code: 'UNAUTHORIZED' });
  });

  it('rejects a refresh with no cookie at all', async () => {
    const response = await request(getApp()).post('/api/auth/refresh');
    expectError(response, { status: 401, code: 'UNAUTHORIZED' });
  });

  it('refuses an expired token', async () => {
    const user = await registerUser();
    await RefreshToken.updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const response = await request(getApp()).post('/api/auth/refresh').set('Cookie', user.refreshCookie);
    expectError(response, { status: 401, code: 'UNAUTHORIZED' });
  });
});

describe('protected routes', () => {
  it('rejects a request with no token', async () => {
    const response = await request(getApp()).get('/api/sessions/current');
    expectError(response, { status: 401, code: 'UNAUTHORIZED' });
  });

  it('rejects a malformed token', async () => {
    const response = await request(getApp()).get('/api/sessions/current').set('Authorization', 'Bearer not.a.jwt');
    expectError(response, { status: 401, code: 'UNAUTHORIZED' });
  });

  it('rejects a token signed with the wrong secret', async () => {
    const user = await registerUser();
    const forged = `${user.token.split('.').slice(0, 2).join('.')}.tampered`;
    const response = await request(getApp()).get('/api/sessions/current').set('Authorization', `Bearer ${forged}`);
    expect(response.status).toBe(401);
  });

  it('accepts a token regardless of bearer casing', async () => {
    const user = await registerUser();
    await request(getApp()).get('/api/auth/me').set('Authorization', `bearer ${user.token}`).expect(200);
  });
});

describe('logout', () => {
  it('revokes the refresh token and clears the cookie', async () => {
    const user = await registerUser();
    const response = await request(getApp()).post('/api/auth/logout').set('Cookie', user.refreshCookie).expect(204);
    const cleared = (response.headers['set-cookie'] ?? []).join(';');
    expect(cleared).toContain('ff_refresh=');

    const after = await request(getApp()).post('/api/auth/refresh').set('Cookie', user.refreshCookie);
    expect(after.status).toBe(401);
  });

  it('signs out every device on request', async () => {
    const user = await registerUser();
    const second = await login(user.email, user.password);

    await user.authed.post('/api/auth/logout-all').expect(200);

    const firstDevice = await request(getApp()).post('/api/auth/refresh').set('Cookie', user.refreshCookie);
    const secondDevice = await request(getApp()).post('/api/auth/refresh').set('Cookie', second.cookie);
    expect(firstDevice.status).toBe(401);
    expect(secondDevice.status).toBe(401);
  });
});

describe('password change', () => {
  it('requires the current password', async () => {
    const user = await registerUser();
    const response = await user.authed
      .post('/api/auth/change-password')
      .send({ currentPassword: 'wrong-password', newPassword: 'a-new-longer-password' });
    expectError(response, { status: 400, code: 'BAD_REQUEST' });
  });

  it('changes the password and invalidates other sessions', async () => {
    const user = await registerUser();
    const otherDevice = await login(user.email, user.password);

    await user.authed
      .post('/api/auth/change-password')
      .send({ currentPassword: user.password, newPassword: 'a-brand-new-password' })
      .expect(200);

    // The old password no longer works...
    const oldLogin = await login(user.email, user.password);
    expect(oldLogin.response.status).toBe(401);

    // ...the new one does...
    const newLogin = await login(user.email, 'a-brand-new-password');
    expect(newLogin.response.status).toBe(200);

    // ...and the other device was signed out.
    const stale = await request(getApp()).post('/api/auth/refresh').set('Cookie', otherDevice.cookie);
    expect(stale.status).toBe(401);
  });

  it('rejects reusing the same password', async () => {
    const user = await registerUser();
    const response = await user.authed
      .post('/api/auth/change-password')
      .send({ currentPassword: user.password, newPassword: user.password });
    expectError(response, { status: 400, code: 'BAD_REQUEST' });
  });
});

describe('account deletion', () => {
  it('requires the password and an explicit confirmation', async () => {
    const user = await registerUser();
    await user.authed.post('/api/auth/delete-account').send({ password: user.password, confirm: 'delete' }).expect(422);
    await user.authed.post('/api/auth/delete-account').send({ password: 'wrong', confirm: 'DELETE' }).expect(400);
  });

  it('removes the account and everything it owns', async () => {
    const user = await registerUser();
    const subject = await user.authed.post('/api/subjects').send({ name: 'DSA' }).expect(201);
    await user.authed.post('/api/tasks').send({ subjectId: subject.body.data.subject.id, title: 'Graphs' }).expect(201);

    await user.authed.post('/api/auth/delete-account').send({ password: user.password, confirm: 'DELETE' }).expect(200);

    expect(await User.countDocuments()).toBe(0);
    const { Subject } = await import('../src/models/Subject.js');
    const { Task } = await import('../src/models/Task.js');
    expect(await Subject.countDocuments()).toBe(0);
    expect(await Task.countDocuments()).toBe(0);

    const stale = await user.authed.get('/api/auth/me');
    expect(stale.status).toBe(401);
  });
});

describe('onboarding', () => {
  it('creates the chosen subjects and a daily goal', async () => {
    const user = await registerUser();
    const response = await user.authed
      .post('/api/auth/onboarding')
      .send({ subjectNames: ['DSA', 'DSA', 'Java'], dailyGoalSeconds: 3 * 3600, successThresholdSeconds: 1800 })
      .expect(200);

    expect(response.body.data.onboarded).toBe(true);
    // Case-insensitive de-duplication protects the live-name unique index.
    expect(response.body.data.subjects).toHaveLength(2);
    expect(response.body.data.settings.dailyGoalSeconds).toBe(3 * 3600);

    const me = await user.authed.get('/api/auth/me').expect(200);
    expect(me.body.data.user.onboarded).toBe(true);

    const goals = await user.authed.get('/api/goals').expect(200);
    expect(goals.body.data.goals.some((goal) => goal.period === 'daily')).toBe(true);
  });

  it('exposes the starter options publicly', async () => {
    const response = await request(getApp()).get('/api/auth/onboarding/options').expect(200);
    expect(response.body.data.options.length).toBeGreaterThan(3);
  });
});

describe('health and meta', () => {
  it('reports health without authentication', async () => {
    const response = await request(getApp()).get('/api/health').expect(200);
    expect(response.body.data.status).toBe('ok');
  });

  it('publishes the focus score formula so it is inspectable, not a black box', async () => {
    const response = await request(getApp()).get('/api/meta/focus-score').expect(200);
    expect(response.body.data.formula).toMatch(/Focus Score/);
    expect(response.body.data.weights.completion).toBeCloseTo(0.3, 5);
    const total = Object.values(response.body.data.weights).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 5);
  });

  it('returns a JSON 404 for unknown routes', async () => {
    const response = await request(getApp()).get('/api/does-not-exist');
    expectError(response, { status: 404, code: 'NOT_FOUND' });
  });
});
