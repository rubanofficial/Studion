import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_STATUS } from '@focusforge/core';

import {
  bootstrap,
  clientId,
  createSubject,
  registerUser,
  resetDatabase,
  teardown,
} from './helpers.js';

beforeAll(bootstrap);
afterAll(teardown);
beforeEach(resetDatabase);

describe('analytics and reviews', () => {
  it('aggregates completed sessions into daily and period statistics', async () => {
    const user = await registerUser();
    const subject = await createSubject(user.authed, 'Distributed Systems');

    // Overview before sessions
    const initOverview = await user.authed.get('/api/analytics/stats/overview').expect(200);
    expect(initOverview.body.data.today.focusedSeconds).toBe(0);

    // Create and complete a session
    const startMs = Date.now() - 1800 * 1000;
    const sessionRes = await user.authed
      .post('/api/sessions')
      .send({
        clientId: clientId('stats_test'),
        subjectId: subject._id,
        plannedDuration: 1800,
        timeZone: 'UTC',
        startTime: new Date(startMs).toISOString(),
      })
      .expect(201);

    const sessionId = sessionRes.body.data.session.id;

    await user.authed
      .post(`/api/sessions/${sessionId}/complete`)
      .send({
        status: SESSION_STATUS.COMPLETED,
        endedAt: new Date().toISOString(),
        reflection: 'Learned Raft consensus algorithm',
      })
      .expect(200);

    // Overview after session
    const overview = await user.authed.get('/api/analytics/stats/overview').expect(200);
    expect(overview.body.data.today.focusedSeconds).toBeGreaterThanOrEqual(1800);
    expect(overview.body.data.today.sessionCount).toBe(1);

    // Day detail
    const dayRes = await user.authed.get('/api/analytics/day').expect(200);
    expect(dayRes.body.data.sessions.length).toBe(1);
    expect(dayRes.body.data.sessions[0].subjectName).toBe('Distributed Systems');

    // Calendar & Heatmap
    const calRes = await user.authed.get('/api/analytics/calendar').expect(200);
    expect(calRes.body.data.days.length).toBeGreaterThan(0);

    const heatRes = await user.authed.get('/api/analytics/heatmap?days=30').expect(200);
    expect(heatRes.body.data.cells.length).toBeGreaterThan(0);

    // Daily and weekly review
    const dailyReview = await user.authed.get('/api/analytics/review/daily').expect(200);
    expect(dailyReview.body.data.observations).toBeDefined();

    const weeklyReview = await user.authed.get('/api/analytics/review/weekly').expect(200);
    expect(weeklyReview.body.data.summary).toBeDefined();

    // Main analytics endpoint (used by /insights)
    const analyticsRes = await user.authed.get('/api/analytics').expect(200);
    expect(analyticsRes.body.data.period).toBeDefined();
    expect(analyticsRes.body.data.summary).toBeDefined();
    expect(analyticsRes.body.data.summary.sessionCount).toBe(1);
    expect(analyticsRes.body.data.insights).toBeDefined();

    // Spurious 'undefined' query parameters sent by client URLSearchParams
    const analyticsUndefinedRes = await user.authed
      .get('/api/analytics?period=week&anchor=undefined&subjectId=undefined')
      .expect(200);
    expect(analyticsUndefinedRes.body.data.period).toBeDefined();

    // Filter by subject and with anchor date
    const analyticsSubjectRes = await user.authed
      .get(`/api/analytics?period=month&anchor=2026-03-15&subjectId=${subject._id}`)
      .expect(200);
    expect(analyticsSubjectRes.body.data.period.kind).toBe('month');

    // Achievements
    const achRes = await user.authed.get('/api/analytics/achievements').expect(200);
    expect(achRes.body.data.unlocked.length).toBeGreaterThan(0);

    // Mark achievements seen
    const seenRes = await user.authed.post('/api/analytics/achievements/seen').send({}).expect(200);
    expect(seenRes.body.data.marked).toBeGreaterThanOrEqual(0);
  });

  it('exports user data losslessly in json and csv formats', async () => {
    const user = await registerUser();
    const subject = await createSubject(user.authed, 'Database Systems');

    const jsonExport = await user.authed
      .get('/api/export?format=json&dataset=all')
      .expect(200);

    expect(jsonExport.headers['content-type']).toContain('application/json');
    expect(jsonExport.body.subjects).toBeDefined();
    expect(jsonExport.body.sessions).toBeDefined();

    const csvExport = await user.authed
      .get('/api/export?format=csv&dataset=sessions')
      .expect(200);

    expect(csvExport.headers['content-type']).toContain('text/csv');
  });

  it('exposes privacy data statement and system capabilities', async () => {
    const user = await registerUser();

    const capabilities = await user.authed.get('/api/capabilities').expect(200);
    expect(capabilities.body.data.capabilities).toBeDefined();

    const statement = await user.authed.get('/api/privacy/data-statement').expect(200);
    expect(statement.body.data.statement.length).toBeGreaterThan(0);
  });
});
