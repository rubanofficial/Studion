import { describe, expect, it } from 'vitest';
import { EVENT } from '@focusforge/core';
import { FocusTimer, appendEvent, isPlanComplete, snapshotFrom } from './timer';
import type { OutboxEntry, OutboxEvent } from './db';

describe('snapshotFrom', () => {
  it('returns an idle snapshot when session is null', () => {
    const snap = snapshotFrom(null);
    expect(snap.phase).toBe('idle');
    expect(snap.clientId).toBeNull();
    expect(snap.focusedSeconds).toBe(0);
    expect(snap.remainingSeconds).toBe(0);
    expect(snap.isOverrun).toBe(false);
  });

  it('calculates running focus snapshot accurately based on timestamps', () => {
    const start = 1700000000000;
    const now = start + 10 * 60 * 1000; // 10 minutes later

    const session: OutboxEntry = {
      clientId: 'c_test_1',
      serverId: null,
      subjectId: 'sub_1',
      taskId: 'task_1',
      kind: 'focus',
      plannedDuration: 25 * 60, // 25 min
      timeZone: 'UTC',
      device: 'web-desktop',
      startTime: start,
      events: [
        { type: EVENT.START, at: start },
      ],
      close: null,
      createdAt: start,
      updatedAt: start,
      attempts: 0,
      lastError: null,
    };

    const snap = snapshotFrom(session, { now });
    expect(snap.phase).toBe('focus');
    expect(snap.focusedSeconds).toBe(600);
    expect(snap.remainingSeconds).toBe(15 * 60);
    expect(snap.progress).toBeCloseTo(600 / 1500, 2);
    expect(snap.isOverrun).toBe(false);
  });

  it('handles pause and resume without losing elapsed focus time', () => {
    const start = 1700000000000;
    const pauseAt = start + 5 * 60 * 1000; // paused at 5m
    const resumeAt = start + 15 * 60 * 1000; // paused for 10m, resumed at 15m
    const now = start + 20 * 60 * 1000; // 5m after resume = 10m total focus

    const session: OutboxEntry = {
      clientId: 'c_test_2',
      serverId: null,
      subjectId: null,
      taskId: null,
      kind: 'focus',
      plannedDuration: 25 * 60,
      timeZone: 'UTC',
      device: 'web-desktop',
      startTime: start,
      events: [
        { type: EVENT.START, at: start },
        { type: EVENT.PAUSE, at: pauseAt },
        { type: EVENT.RESUME, at: resumeAt },
      ],
      close: null,
      createdAt: start,
      updatedAt: resumeAt,
      attempts: 0,
      lastError: null,
    };

    const snap = snapshotFrom(session, { now });
    expect(snap.phase).toBe('focus');
    expect(snap.focusedSeconds).toBe(600); // 5m before pause + 5m after resume
    expect(snap.pausedSeconds).toBe(600); // 10m paused
    expect(snap.pauseCount).toBe(1);
    expect(snap.remainingSeconds).toBe(15 * 60);
  });

  it('detects overrun when focused time exceeds planned duration', () => {
    const start = 1700000000000;
    const now = start + 30 * 60 * 1000; // 30 minutes into a 25m plan

    const session: OutboxEntry = {
      clientId: 'c_test_3',
      serverId: null,
      subjectId: null,
      taskId: null,
      kind: 'focus',
      plannedDuration: 25 * 60,
      timeZone: 'UTC',
      device: 'web-desktop',
      startTime: start,
      events: [
        { type: EVENT.START, at: start },
      ],
      close: null,
      createdAt: start,
      updatedAt: start,
      attempts: 0,
      lastError: null,
    };

    const snap = snapshotFrom(session, { now });
    expect(snap.focusedSeconds).toBe(1800);
    expect(snap.remainingSeconds).toBe(0);
    expect(snap.isOverrun).toBe(true);
    expect(snap.progress).toBe(1);
    expect(isPlanComplete(snap)).toBe(true);
  });

  it('reflects finished phase when close object is present', () => {
    const start = 1700000000000;
    const end = start + 25 * 60 * 1000;

    const session: OutboxEntry = {
      clientId: 'c_test_4',
      serverId: 'srv_1',
      subjectId: null,
      taskId: null,
      kind: 'focus',
      plannedDuration: 25 * 60,
      timeZone: 'UTC',
      device: 'web-desktop',
      startTime: start,
      events: [
        { type: EVENT.START, at: start },
        { type: EVENT.END, at: end },
      ],
      close: { status: 'completed', reflection: 'Great session', endedAt: end },
      createdAt: start,
      updatedAt: end,
      attempts: 0,
      lastError: null,
    };

    const snap = snapshotFrom(session, { now: end + 5000 });
    expect(snap.phase).toBe('finished');
    expect(snap.focusedSeconds).toBe(1500);
  });
});

describe('appendEvent', () => {
  it('deduplicates exact same event type and timestamp', () => {
    const events = [
      { type: EVENT.START, at: 1000 },
      { type: EVENT.PAUSE, at: 2000 },
    ];
    const duplicate = { type: EVENT.PAUSE, at: 2000 };
    const result = appendEvent(events, duplicate);
    expect(result).toHaveLength(2);
  });

  it('appends and maintains chronological sort order', () => {
    const events = [
      { type: EVENT.START, at: 1000 },
      { type: EVENT.RESUME, at: 3000 },
    ];
    const earlier = { type: EVENT.PAUSE, at: 2000 };
    const result = appendEvent(events, earlier);
    expect(result).toHaveLength(3);
    expect(result.map((e) => e.at)).toEqual([1000, 2000, 3000]);
  });
});

describe('timer timeline resilience', () => {
  it('prevents dropping from 36m to 28m when background heartbeats are preserved', () => {
    const start = 1700000000000;
    const events: OutboxEvent[] = [{ type: EVENT.START, at: start }];

    // Tab emits heartbeats across all 36 minutes (even when backgrounded)
    for (let m = 1; m <= 36; m++) {
      events.push({ type: EVENT.HEARTBEAT, at: start + m * 60 * 1000 });
    }

    const session: OutboxEntry = {
      clientId: 'c_test_bg',
      serverId: 'srv_1',
      subjectId: null,
      taskId: null,
      kind: 'focus',
      plannedDuration: 40 * 60,
      timeZone: 'UTC',
      device: 'web-desktop',
      startTime: start,
      events,
      close: null,
      createdAt: start,
      updatedAt: start + 36 * 60 * 1000,
      attempts: 0,
      lastError: null,
    };

    const snap = snapshotFrom(session, { now: start + 36 * 60 * 1000 });
    // Focused time is full 36 minutes (2160s), never dropped down to 28m
    expect(snap.focusedSeconds).toBe(36 * 60);
    expect(snap.idleSeconds).toBe(0);
  });

  it('demonstrates why 36m dropped to 28m if heartbeats stopped at minute 28', () => {
    const start = 1700000000000;
    const events: OutboxEvent[] = [{ type: EVENT.START, at: start }];

    // Tab emitted heartbeats up to minute 28, then went silent for 8 minutes (e.g. background tab suppressed)
    for (let m = 1; m <= 28; m++) {
      events.push({ type: EVENT.HEARTBEAT, at: start + m * 60 * 1000 });
    }

    const session: OutboxEntry = {
      clientId: 'c_test_silent',
      serverId: 'srv_1',
      subjectId: null,
      taskId: null,
      kind: 'focus',
      plannedDuration: 40 * 60,
      timeZone: 'UTC',
      device: 'web-desktop',
      startTime: start,
      events,
      close: null,
      createdAt: start,
      updatedAt: start + 28 * 60 * 1000,
      attempts: 0,
      lastError: null,
    };

    // At minute 36, 8 minutes of silence exceeds the 6-minute IDLE_GAP_MS tolerance
    const snap = snapshotFrom(session, { now: start + 36 * 60 * 1000 });
    // The 8 minutes between min 28 and min 36 was reclassified as idle, dropping focus to 28m!
    expect(snap.focusedSeconds).toBe(28 * 60);
    expect(snap.idleSeconds).toBe(8 * 60);
  });
});

describe('FocusTimer finish and clear', () => {
  it('resets timer to idle phase on clear()', async () => {
    let now = 1700000000000;
    const timer = new FocusTimer({ now: () => now });

    await timer.start({
      subjectId: 'sub_1',
      taskId: null,
      plannedSeconds: 1500,
      timeZone: 'UTC',
    });

    now += 60000;
    expect(timer.getSnapshot().phase).toBe('focus');

    await timer.clear();
    const idleSnap = timer.getSnapshot();
    expect(idleSnap.phase).toBe('idle');
    expect(idleSnap.focusedSeconds).toBe(0);
    expect(idleSnap.clientId).toBeNull();
  });

  it('flushes and clears if finish() is invoked when session is already closed', async () => {
    let now = 1700000000000;
    const timer = new FocusTimer({ now: () => now });

    await timer.start({
      subjectId: 'sub_1',
      taskId: null,
      plannedSeconds: 1500,
      timeZone: 'UTC',
    });

    now += 60000;
    // Finish session
    await timer.finish({ status: 'completed' });
    // Calling finish again on an already-closed session cleans up and clears to idle
    await timer.finish({ status: 'completed' });

    expect(timer.getSnapshot().phase).toBe('idle');
  });
});

