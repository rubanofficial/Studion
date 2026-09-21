import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EVENT, SESSION_STATUS } from '@focusforge/core';

import { FocusSession } from '../src/models/FocusSession.js';
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

describe('session lifecycle', () => {
  it('starts a new focus session and records initial start event', async () => {
    const user = await registerUser();
    const subject = await createSubject(user.authed, 'Systems Programming');
    const cId = clientId('s1');

    const response = await user.authed
      .post('/api/sessions')
      .send({
        clientId: cId,
        subjectId: subject._id,
        plannedDuration: 1500,
        timeZone: 'UTC',
      })
      .expect(201);

    expect(response.body.data.created).toBe(true);
    expect(response.body.data.adopted).toBe(false);
    expect(response.body.data.idempotent).toBe(false);

    const session = response.body.data.session;
    expect(session.clientId).toBe(cId);
    expect(session.subjectId).toBe(subject._id);
    expect(session.status).toBe(SESSION_STATUS.RUNNING);
    expect(session.plannedDuration).toBe(1500);

    const stored = await FocusSession.findOne({ clientId: cId });
    expect(stored).not.toBeNull();
    expect(stored.events.length).toBe(1);
    expect(stored.events[0].type).toBe(EVENT.START);
  });

  it('handles idempotent replays with the same clientId', async () => {
    const user = await registerUser();
    const subject = await createSubject(user.authed, 'Database Internals');
    const cId = clientId('idem');

    const first = await user.authed
      .post('/api/sessions')
      .send({
        clientId: cId,
        subjectId: subject._id,
        plannedDuration: 1800,
        timeZone: 'UTC',
      })
      .expect(201);

    expect(first.body.data.created).toBe(true);

    const second = await user.authed
      .post('/api/sessions')
      .send({
        clientId: cId,
        subjectId: subject._id,
        plannedDuration: 1800,
        timeZone: 'UTC',
      })
      .expect(200);

    expect(second.body.data.idempotent).toBe(true);
    expect(second.body.data.session.id).toBe(first.body.data.session.id);
  });

  it('adopts an existing open session when starting another on a different client', async () => {
    const user = await registerUser();
    const subject = await createSubject(user.authed, 'Network Protocols');

    const sessionA = await user.authed
      .post('/api/sessions')
      .send({
        clientId: clientId('client_a'),
        subjectId: subject._id,
        plannedDuration: 2400,
        timeZone: 'UTC',
      })
      .expect(201);

    const sessionB = await user.authed
      .post('/api/sessions')
      .send({
        clientId: clientId('client_b'),
        subjectId: subject._id,
        plannedDuration: 1800,
        timeZone: 'UTC',
      })
      .expect(200);

    expect(sessionB.body.data.adopted).toBe(true);
    expect(sessionB.body.data.session.id).toBe(sessionA.body.data.session.id);
  });

  it('tracks pause, resume, break, and end break transitions', async () => {
    const user = await registerUser();
    const subject = await createSubject(user.authed, 'Algorithms');

    const created = await user.authed
      .post('/api/sessions')
      .send({
        clientId: clientId('trans'),
        subjectId: subject._id,
        plannedDuration: 1500,
        timeZone: 'UTC',
      })
      .expect(201);

    const sessionId = created.body.data.session.id;

    // Pause
    const paused = await user.authed.post(`/api/sessions/${sessionId}/pause`).send({}).expect(200);
    expect(paused.body.data.session.status).toBe(SESSION_STATUS.PAUSED);

    // Resume
    const resumed = await user.authed.post(`/api/sessions/${sessionId}/resume`).send({}).expect(200);
    expect(resumed.body.data.session.status).toBe(SESSION_STATUS.RUNNING);

    // Break
    const onBreak = await user.authed.post(`/api/sessions/${sessionId}/break`).send({}).expect(200);
    expect(onBreak.body.data.session.status).toBe(SESSION_STATUS.RUNNING);

    // Break end
    const offBreak = await user.authed.post(`/api/sessions/${sessionId}/break/end`).send({}).expect(200);
    expect(offBreak.body.data.session.status).toBe(SESSION_STATUS.RUNNING);

    const stored = await FocusSession.findById(sessionId);
    const eventTypes = stored.events.map((e) => e.type);
    expect(eventTypes).toContain(EVENT.PAUSE);
    expect(eventTypes).toContain(EVENT.RESUME);
    expect(eventTypes).toContain(EVENT.BREAK_START);
    expect(eventTypes).toContain(EVENT.BREAK_END);
  });

  it('records heartbeats and distractions', async () => {
    const user = await registerUser();
    const subject = await createSubject(user.authed, 'Operating Systems');

    const created = await user.authed
      .post('/api/sessions')
      .send({
        clientId: clientId('hb'),
        subjectId: subject._id,
        plannedDuration: 1500,
        timeZone: 'UTC',
      })
      .expect(201);

    const sessionId = created.body.data.session.id;

    // Heartbeat
    const beat = await user.authed.post(`/api/sessions/${sessionId}/heartbeat`).send({}).expect(200);
    expect(beat.body.data.added).toBe(1);

    // Distraction
    const distracted = await user.authed
      .post(`/api/sessions/${sessionId}/distractions`)
      .send({ kind: 'phone' })
      .expect(200);
    expect(distracted.body.data.session.distractionCount).toBe(1);
  });

  it('extends session duration', async () => {
    const user = await registerUser();
    const subject = await createSubject(user.authed, 'Compilers');

    const created = await user.authed
      .post('/api/sessions')
      .send({
        clientId: clientId('ext'),
        subjectId: subject._id,
        plannedDuration: 1500,
        timeZone: 'UTC',
      })
      .expect(201);

    const sessionId = created.body.data.session.id;

    const extended = await user.authed
      .post(`/api/sessions/${sessionId}/extend`)
      .send({ minutes: 10 })
      .expect(200);

    expect(extended.body.data.addedMinutes).toBe(10);
    expect(extended.body.data.session.plannedDuration).toBe(2100);
  });

  it('completes session with reflection and derives duration', async () => {
    const user = await registerUser();
    const subject = await createSubject(user.authed, 'Machine Learning');

    const startMs = Date.now() - 1600 * 1000;
    const startIso = new Date(startMs).toISOString();

    const created = await user.authed
      .post('/api/sessions')
      .send({
        clientId: clientId('complete'),
        subjectId: subject._id,
        plannedDuration: 1500,
        timeZone: 'UTC',
        startTime: startIso,
      })
      .expect(201);

    const sessionId = created.body.data.session.id;

    const completed = await user.authed
      .post(`/api/sessions/${sessionId}/complete`)
      .send({
        status: SESSION_STATUS.COMPLETED,
        endedAt: new Date().toISOString(),
        reflection: 'Finished chapter 4 exercises.',
      })
      .expect(200);

    expect(completed.body.data.closed).toBe(true);
    expect(completed.body.data.alreadyClosed).toBe(false);
    expect(completed.body.data.session.status).toBe(SESSION_STATUS.COMPLETED);
    expect(completed.body.data.session.reflection).toBe('Finished chapter 4 exercises.');
    expect(completed.body.data.session.focusedSeconds).toBeGreaterThanOrEqual(1500);

    // Completing already-closed session is a safe no-op
    const replay = await user.authed
      .post(`/api/sessions/${sessionId}/complete`)
      .send({
        status: SESSION_STATUS.COMPLETED,
        endedAt: new Date().toISOString(),
      })
      .expect(200);

    expect(replay.body.data.closed).toBe(false);
    expect(replay.body.data.alreadyClosed).toBe(true);
  });
});
