import { describe, expect, it } from 'vitest';

import { EVENT, IDLE_GAP_MS, SEGMENT, SESSION_STATUS } from './constants.js';
import { deriveSessionStats, foldTimeline, normaliseEvents } from './timeline.js';

/** Build an event log from minute offsets relative to a base instant. */
const T0 = Date.parse('2026-03-02T09:00:00.000Z');
const at = (minutes, seconds = 0) => new Date(T0 + minutes * 60_000 + seconds * 1000).toISOString();
const ev = (type, minutes, extra = {}) => ({ type, at: at(minutes), ...extra });

describe('normaliseEvents', () => {
  it('orders by instant and is independent of input order for events sharing an instant', () => {
    const shuffled = [
      { type: EVENT.END, at: at(10) },
      { type: EVENT.RESUME, at: at(5) },
      { type: EVENT.START, at: at(0) },
      { type: EVENT.PAUSE, at: at(5) },
      { type: EVENT.HEARTBEAT, at: at(5) },
    ];
    const forward = normaliseEvents(shuffled).map((e) => e.type);
    const reversed = normaliseEvents([...shuffled].reverse()).map((e) => e.type);
    // Same answer whatever order the log arrived in — pause before resume, and
    // end strictly last.
    expect(forward).toEqual([EVENT.START, EVENT.PAUSE, EVENT.RESUME, EVENT.HEARTBEAT, EVENT.END]);
    expect(reversed).toEqual(forward);
  });

  it('orders a same-instant breakEnd ahead of a following breakStart', () => {
    const events = normaliseEvents([
      { type: EVENT.BREAK_START, at: at(5) },
      { type: EVENT.BREAK_END, at: at(5) },
      { type: EVENT.START, at: at(0) },
    ]);
    expect(events.map((e) => e.type)).toEqual([EVENT.START, EVENT.BREAK_END, EVENT.BREAK_START]);
  });

  it('collapses exact duplicates so a retried request cannot double-count', () => {
    const events = normaliseEvents([ev(EVENT.START, 0), ev(EVENT.START, 0), ev(EVENT.PAUSE, 5), ev(EVENT.PAUSE, 5)]);
    expect(events).toHaveLength(2);
  });

  it('drops unparseable entries instead of producing NaN durations', () => {
    const events = normaliseEvents([{ type: EVENT.START, at: 'not-a-date' }, ev(EVENT.START, 0), { at: at(1) }]);
    expect(events).toHaveLength(1);
  });
});

describe('foldTimeline', () => {
  it('produces one open focus segment for a freshly started session', () => {
    const { segments, state } = foldTimeline(normaliseEvents([ev(EVENT.START, 0)]), T0 + 5 * 60_000);
    expect(state).toBe('focus');
    expect(segments).toEqual([{ kind: SEGMENT.FOCUS, from: T0, to: T0 + 5 * 60_000 }]);
  });

  it('splits focus around a break and never counts the break as focus', () => {
    const events = normaliseEvents([
      ev(EVENT.START, 0),
      ev(EVENT.BREAK_START, 25),
      ev(EVENT.BREAK_END, 30),
      ev(EVENT.RESUME, 30),
      ev(EVENT.END, 55),
    ]);
    const { segments } = foldTimeline(events, at(55));
    expect(segments.map((s) => s.kind)).toEqual([SEGMENT.FOCUS, SEGMENT.BREAK, SEGMENT.FOCUS]);
    expect(segments[0]).toMatchObject({ from: T0, to: T0 + 25 * 60_000 });
    expect(segments[1]).toMatchObject({ from: T0 + 25 * 60_000, to: T0 + 30 * 60_000 });
  });

  it('returns to paused after a break rather than assuming auto-resume', () => {
    const events = normaliseEvents([ev(EVENT.START, 0), ev(EVENT.BREAK_START, 10), ev(EVENT.BREAK_END, 15)]);
    const { state } = foldTimeline(events, at(20));
    expect(state).toBe('paused');
  });

  it('closes the break before resuming when both land on the same instant', () => {
    const events = normaliseEvents([ev(EVENT.START, 0), ev(EVENT.BREAK_START, 10), ev(EVENT.BREAK_END, 15), ev(EVENT.RESUME, 15), ev(EVENT.END, 20)]);
    const stats = deriveSessionStats({ events });
    expect(stats.focusedSeconds).toBe(15 * 60);
    expect(stats.breakSeconds).toBe(5 * 60);
    expect(stats.pausedSeconds).toBe(0);
  });

  it('treats a duplicate start as idempotent so the longest block stays intact', () => {
    const events = normaliseEvents([ev(EVENT.START, 0), ev(EVENT.START, 3), ev(EVENT.END, 10)]);
    const { segments } = foldTimeline(events, at(10));
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ kind: SEGMENT.FOCUS, from: T0, to: T0 + 10 * 60_000 });
  });

  it('still starts a fresh block after a session was ended', () => {
    const events = normaliseEvents([ev(EVENT.START, 0), ev(EVENT.END, 5), ev(EVENT.START, 6), ev(EVENT.END, 10)]);
    const { segments } = foldTimeline(events, at(10));
    expect(segments.filter((s) => s.kind === SEGMENT.FOCUS)).toHaveLength(2);
  });

  it('treats a same-instant pause and resume as a no-op', () => {
    const events = normaliseEvents([ev(EVENT.START, 0), ev(EVENT.RESUME, 10), ev(EVENT.PAUSE, 10), ev(EVENT.END, 40)]);
    const stats = deriveSessionStats({ events });
    expect(stats.focusedSeconds).toBe(40 * 60);
    expect(stats.pauseCount).toBe(1);
  });

  it('ignores pause when not focusing', () => {
    const events = normaliseEvents([ev(EVENT.START, 0), ev(EVENT.PAUSE, 5), ev(EVENT.PAUSE, 6), ev(EVENT.RESUME, 8)]);
    const { segments } = foldTimeline(events, at(10));
    expect(segments.filter((s) => s.kind === SEGMENT.FOCUS)).toHaveLength(2);
  });
});

describe('idle detection (laptop sleep / frozen tab)', () => {
  it('reclassifies a silent gap longer than the tolerance as idle, not focus', () => {
    // Heartbeat every minute for 5 minutes, then the lid closes for 4 hours.
    const events = [ev(EVENT.START, 0)];
    for (let m = 1; m <= 5; m += 1) events.push(ev(EVENT.HEARTBEAT, m));
    events.push(ev(EVENT.HEARTBEAT, 245)); // machine wakes
    events.push(ev(EVENT.END, 245));

    const stats = deriveSessionStats({ events: normaliseEvents(events), status: SESSION_STATUS.INTERRUPTED, plannedDuration: 1500 });
    expect(stats.focusedSeconds).toBe(5 * 60);
    expect(stats.idleSeconds).toBe(240 * 60);
    expect(stats.focusedSeconds + stats.idleSeconds).toBe(245 * 60);
  });

  it('never penalises a session that simply sent no heartbeats', () => {
    // Absence of evidence is not evidence of absence: a 45 minute session with
    // only start and end must count as 45 minutes of focus.
    const stats = deriveSessionStats({
      events: normaliseEvents([ev(EVENT.START, 0), ev(EVENT.END, 45)]),
      status: SESSION_STATUS.COMPLETED,
    });
    expect(stats.focusedSeconds).toBe(45 * 60);
    expect(stats.idleSeconds).toBe(0);
  });

  it('tolerates browser background-throttled heartbeats', () => {
    // Worst documented intensive throttling is one tick every five minutes.
    const events = [ev(EVENT.START, 0)];
    for (let m = 5; m <= 60; m += 5) events.push(ev(EVENT.HEARTBEAT, m));
    events.push(ev(EVENT.END, 60));
    const stats = deriveSessionStats({ events: normaliseEvents(events) });
    expect(stats.idleSeconds).toBe(0);
    expect(stats.focusedSeconds).toBe(60 * 60);
  });

  it('does not flag idle when heartbeats are merely a little late', () => {
    const events = [ev(EVENT.START, 0), ev(EVENT.HEARTBEAT, 2), ev(EVENT.HEARTBEAT, 4), ev(EVENT.END, 6)];
    const stats = deriveSessionStats({ events: normaliseEvents(events) });
    expect(stats.idleSeconds).toBe(0);
    expect(stats.focusedSeconds).toBe(6 * 60);
  });

  it('catches a sleep mid-session while preserving the work done before it', () => {
    const events = [ev(EVENT.START, 0)];
    for (let m = 5; m <= 30; m += 5) events.push(ev(EVENT.HEARTBEAT, m));
    events.push(ev(EVENT.HEARTBEAT, 300));
    events.push(ev(EVENT.END, 300));
    const stats = deriveSessionStats({ events: normaliseEvents(events) });
    expect(stats.focusedSeconds).toBe(30 * 60);
    expect(stats.idleSeconds).toBe(270 * 60);
  });

  it('tolerates exactly the documented gap', () => {
    const gapMs = IDLE_GAP_MS;
    const events = [
      { type: EVENT.START, at: T0 },
      { type: EVENT.END, at: T0 + gapMs },
    ];
    expect(deriveSessionStats({ events }).idleSeconds).toBe(0);
  });
});

describe('deriveSessionStats', () => {
  it('separates focused, break, paused, idle and wall time exactly', () => {
    const events = normaliseEvents([
      ev(EVENT.START, 0),
      ev(EVENT.PAUSE, 10), // 10 min focus
      ev(EVENT.RESUME, 12), // 2 min paused
      ev(EVENT.BREAK_START, 22), // 10 min focus
      ev(EVENT.BREAK_END, 27), // 5 min break
      ev(EVENT.RESUME, 27),
      ev(EVENT.DISTRACTION, 30, { kind: 'youtube' }),
      ev(EVENT.END, 37), // 10 min focus
    ]);
    const stats = deriveSessionStats({ events, status: SESSION_STATUS.COMPLETED, plannedDuration: 30 * 60 });

    expect(stats.focusedSeconds).toBe(30 * 60);
    expect(stats.breakSeconds).toBe(5 * 60);
    expect(stats.pausedSeconds).toBe(2 * 60);
    expect(stats.idleSeconds).toBe(0);
    expect(stats.wallSeconds).toBe(37 * 60);
    expect(stats.focusedSeconds + stats.breakSeconds + stats.pausedSeconds + stats.idleSeconds).toBe(stats.wallSeconds);
    expect(stats.pauseCount).toBe(1);
    expect(stats.breakCount).toBe(1);
    expect(stats.distractionCount).toBe(1);
    expect(stats.remainingSeconds).toBe(0);
    expect(stats.progress).toBe(1);
  });

  it('reports a live session against the supplied now rather than wall clock', () => {
    const events = normaliseEvents([ev(EVENT.START, 0)]);
    const stats = deriveSessionStats({ events, plannedDuration: 45 * 60 }, { now: at(42, 18) });
    expect(stats.focusedSeconds).toBe(42 * 60 + 18);
    expect(stats.isOpen).toBe(true);
    expect(stats.remainingSeconds).toBe(45 * 60 - (42 * 60 + 18));
    expect(stats.progress).toBeCloseTo(0.94, 2);
  });

  it('is zero-safe for a session with no events', () => {
    const stats = deriveSessionStats({ plannedDuration: 1500 });
    expect(stats.focusedSeconds).toBe(0);
    expect(stats.wallSeconds).toBe(0);
    expect(stats.progress).toBe(0);
    expect(stats.distractionsPerHour).toBe(0);
    expect(Number.isNaN(stats.distractionsPerHour)).toBe(false);
  });

  it('computes a rate-based distraction density', () => {
    const events = normaliseEvents([
      ev(EVENT.START, 0),
      ev(EVENT.DISTRACTION, 15, { kind: 'phone' }),
      ev(EVENT.DISTRACTION, 30, { kind: 'phone' }),
      ev(EVENT.DISTRACTION, 45, { kind: 'phone' }),
      ev(EVENT.DISTRACTION, 55, { kind: 'phone' }),
      ev(EVENT.END, 60),
    ]);
    const stats = deriveSessionStats({ events });
    expect(stats.distractionCount).toBe(4);
    expect(stats.distractionsPerHour).toBeCloseTo(4, 5);
  });

  it('tracks the longest unbroken focus block', () => {
    const events = normaliseEvents([
      ev(EVENT.START, 0),
      ev(EVENT.PAUSE, 10),
      ev(EVENT.RESUME, 10),
      ev(EVENT.END, 40),
    ]);
    const stats = deriveSessionStats({ events });
    expect(stats.longestFocusStreakSeconds).toBe(30 * 60);
  });
});
