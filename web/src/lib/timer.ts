/**
 * The timer engine.
 *
 * This is the one piece of the client that must be beyond reproach, so it is a
 * plain class rather than a React hook: no render, no closure staleness, no
 * effect-ordering subtleties. React subscribes to it; it does not depend on React.
 *
 * The rules it enforces:
 *
 *   **Time is derived, never counted.** The engine holds an append-only event log
 *   and folds it with `@focusforge/core` on every read. There is no
 *   `setInterval(() => seconds--)` anywhere. That is why a refresh, a throttled
 *   background tab, a sleeping laptop and an offline stretch are all handled by
 *   construction instead of by special cases — the timer recomputes from
 *   timestamps and lands on the right answer regardless of what it missed.
 *
 *   **One tab owns the session.** A running timer in two tabs would double the
 *   heartbeats and could double a distraction record. Leadership is claimed
 *   through a `localStorage` lease that the owner renews; a second tab renders the
 *   same state but never writes. `BroadcastChannel` keeps the tabs' displays in
 *   lockstep.
 *
 *   **Nothing is lost when the network is gone.** Every observed event is written
 *   to IndexedDB before any network call is attempted, and the flush is a single
 *   batched, idempotent request keyed on `clientId`.
 */

import { EVENT, HEARTBEAT_INTERVAL_MS, IDLE_GAP_MS, SESSION_STATUS, deriveSessionStats } from '@focusforge/core';

import type { SessionDto } from './api';
import { api } from './api';
import {
  type OutboxEntry,
  type OutboxEvent,
  deleteOutboxEntry,
  listOutbox,
  putOutboxEntry,
} from './db';

export type TimerPhase = 'idle' | 'focus' | 'break' | 'paused' | 'finished';

export interface TimerSnapshot {
  phase: TimerPhase;
  clientId: string | null;
  serverId: string | null;
  subjectId: string | null;
  taskId: string | null;
  startedAt: number | null;
  plannedSeconds: number;
  focusedSeconds: number;
  breakSeconds: number;
  pausedSeconds: number;
  idleSeconds: number;
  /** Seconds left of the planned duration; never negative. */
  remainingSeconds: number;
  /** 0..1 progression through the planned duration. */
  progress: number;
  /** Planned duration exceeded — the session keeps running, it just reads over. */
  isOverrun: boolean;
  pauseCount: number;
  distractionCount: number;
  eventCount: number;
  /** True when this tab is the one allowed to write. */
  isLeader: boolean;
  synced: boolean;
  pendingEvents: number;
  adopting: boolean;
}

const STORAGE_KEY = 'focusforge.timer';
const LEASE_KEY = 'focusforge.timer.lease';
const CHANNEL_NAME = 'focusforge.timer';
const LEASE_MS = 12_000;

/** Local, serialisable session state. Mirrors the server's outbox shape. */
type LocalSession = OutboxEntry;

function newClientId(): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '')
      : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return `c_${Date.now().toString(36)}_${random}`.slice(0, 64);
}

/** Detect the device class so analytics can distinguish desktop from mobile use. */
export function detectDevice(): string {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent;
  if (/iPad|Tablet/i.test(ua)) return 'web-tablet';
  if (/Android|iPhone|Mobile/i.test(ua)) return 'web-mobile';
  if (/Windows|Macintosh|Linux|CrOS/i.test(ua)) return 'web-desktop';
  return 'unknown';
}

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Append an event, collapsing an exact duplicate.
 *
 * Duplicates are dropped here as well as on the server, so a double-clicked
 * button cannot inflate a pause count even before the request is made.
 */
export function appendEvent(events: OutboxEvent[], event: OutboxEvent): OutboxEvent[] {
  if (events.some((existing) => existing.type === event.type && existing.at === event.at)) return events;
  return [...events, event].sort((a, b) => a.at - b.at);
}

/**
 * Fold a local session into a display snapshot.
 *
 * Exported as a pure function because it is the single most important thing in
 * the client to be able to test without a DOM, a network, or a clock.
 */
export function snapshotFrom(
  session: LocalSession | null,
  options: { now?: number; isLeader?: boolean; pendingEvents?: number; synced?: boolean; adopting?: boolean } = {},
): TimerSnapshot {
  const now = options.now ?? Date.now();

  if (!session) {
    return {
      phase: 'idle',
      clientId: null,
      serverId: null,
      subjectId: null,
      taskId: null,
      startedAt: null,
      plannedSeconds: 0,
      focusedSeconds: 0,
      breakSeconds: 0,
      pausedSeconds: 0,
      idleSeconds: 0,
      remainingSeconds: 0,
      progress: 0,
      isOverrun: false,
      pauseCount: 0,
      distractionCount: 0,
      eventCount: 0,
      isLeader: options.isLeader ?? false,
      synced: true,
      pendingEvents: 0,
      adopting: false,
    };
  }

  const stats = deriveSessionStats(
    {
      events: session.events,
      startTime: session.startTime,
      endTime: session.close ? session.close.endedAt : null,
      status: session.close ? session.close.status : SESSION_STATUS.RUNNING,
      plannedDuration: session.plannedDuration,
    },
    { now, idleGapMs: IDLE_GAP_MS },
  );

  let phase: TimerPhase;
  if (session.close) phase = 'finished';
  else if (stats.state === 'break') phase = 'break';
  else if (stats.state === 'focus') phase = 'focus';
  else if (stats.state === 'paused') phase = 'paused';
  else phase = session.close ? 'finished' : 'idle';

  const progress = session.plannedDuration > 0 ? Math.min(1, stats.focusedSeconds / session.plannedDuration) : 0;

  return {
    phase,
    clientId: session.clientId,
    serverId: session.serverId,
    subjectId: session.subjectId,
    taskId: session.taskId,
    startedAt: session.startTime,
    plannedSeconds: session.plannedDuration,
    focusedSeconds: stats.focusedSeconds,
    breakSeconds: stats.breakSeconds,
    pausedSeconds: stats.pausedSeconds,
    idleSeconds: stats.idleSeconds,
    remainingSeconds: Math.max(0, session.plannedDuration - stats.focusedSeconds),
    progress,
    isOverrun: session.plannedDuration > 0 && stats.focusedSeconds > session.plannedDuration,
    pauseCount: stats.pauseCount,
    distractionCount: stats.distractionCount,
    eventCount: session.events.length,
    isLeader: options.isLeader ?? false,
    synced: options.synced ?? !session.serverId,
    pendingEvents: options.pendingEvents ?? 0,
    adopting: options.adopting ?? false,
  };
}

/** Has the planned duration been reached (ignoring a small grace period)? */
export function isPlanComplete(snapshot: TimerSnapshot, graceSeconds = 1): boolean {
  return snapshot.plannedSeconds > 0 && snapshot.focusedSeconds >= snapshot.plannedSeconds - graceSeconds;
}

export interface FocusTimerDeps {
  /** Injected so tests can drive the engine without a network or a real clock. */
  now?: () => number;
  onSnapshot?: (snapshot: TimerSnapshot) => void;
  onSessionCompleted?: (session: SessionDto, newlyUnlocked: string[]) => void;
  onError?: (message: string) => void;
}

export class FocusTimer {
  private session: LocalSession | null = null;
  private listeners = new Set<(snapshot: TimerSnapshot) => void>();
  private channel: BroadcastChannel | null = null;
  private tickHandle: number | null = null;
  private heartbeatHandle: number | null = null;
  private leaseHandle: number | null = null;
  private flushHandle: number | null = null;
  private pendingFlush = false;
  private isLeader = false;
  private flushedClientId: string | null = null;
  private flushedEventCount = 0;
  private heartbeatWorker: Worker | null = null;
  private heartbeatWorkerBlobUrl: string | null = null;
  private readonly instanceId = newClientId();
  private readonly now: () => number;
  private deps: FocusTimerDeps;

  constructor(deps: FocusTimerDeps = {}) {
    this.deps = deps;
    this.now = deps.now ?? (() => Date.now());
  }

  // ------------------------------------------------------------------ lifecycle

  /** Restore any session left behind by a previous page load. Safe to call twice. */
  async hydrate(): Promise<void> {
    const stored = safeParse<LocalSession>(localStorage.getItem(STORAGE_KEY));
    if (stored) {
      this.session = stored;
      // The tab that had the lease before a reload is almost certainly this one.
      this.claimLeadership(true);
    } else {
      await this.recoverFromOutbox();
    }

    this.openChannel();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', this.handleVisibilityChange);
    }
    this.startTick();
    this.startHeartbeat();
    this.emit();
  }

  /**
   * If localStorage was cleared but IndexedDB still holds an unsynced session —
   * which happens when the browser evicts origin data — adopt the newest one so
   * the user's work is not silently lost.
   */
  private async recoverFromOutbox(): Promise<void> {
    const entries = await listOutbox();
    const open = entries.filter((entry) => !entry.close).sort((a, b) => b.startTime - a.startTime)[0];
    if (open) {
      this.session = open;
      this.persist();
    }
  }

  dispose(): void {
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('focus', this.handleVisibilityChange);
    }
    this.stopTick();
    this.stopHeartbeat();
    this.releaseLeadership();
    this.channel?.close();
    this.channel = null;
    this.listeners.clear();
  }

  subscribe(listener: (snapshot: TimerSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): TimerSnapshot {
    return snapshotFrom(this.session, {
      now: this.now(),
      isLeader: this.isLeader,
      pendingEvents: this.session ? Math.max(0, this.session.events.length - this.flushedEventCount) : 0,
      synced:
        Boolean(this.session?.serverId) &&
        this.flushedClientId === this.session?.clientId &&
        this.flushedEventCount === this.session?.events.length,
    });
  }

  // ------------------------------------------------------------------- commands

  /**
   * Begin a focus block.
   *
   * The local session is created *before* any network call, so pressing start
   * works instantly and offline. If the server is reachable it is told at once;
   * otherwise the session waits in the outbox and syncs later under the same
   * client-generated id.
   */
  async start(input: {
    subjectId: string | null;
    taskId: string | null;
    plannedSeconds: number;
    kind?: string;
    timeZone: string;
  }): Promise<void> {
    if (this.session && !this.session.close) {
      // One session at a time on this device. Adopting is handled by the server.
      return;
    }

    const startedAt = this.now();
    const session: LocalSession = {
      clientId: newClientId(),
      serverId: null,
      subjectId: input.subjectId,
      taskId: input.taskId,
      kind: input.kind ?? 'focus',
      plannedDuration: input.plannedSeconds,
      timeZone: input.timeZone,
      device: detectDevice(),
      startTime: startedAt,
      events: [{ type: EVENT.START, at: startedAt }],
      close: null,
      createdAt: startedAt,
      updatedAt: startedAt,
      attempts: 0,
      lastError: null,
    };

    this.session = session;
    this.flushedClientId = null;
    this.flushedEventCount = 0;
    this.claimLeadership(true);
    this.persist();
    await putOutboxEntry(session).catch(() => {});
    this.startTick();
    this.startHeartbeat();
    this.emit();
    this.broadcast({ type: 'started', clientId: session.clientId });

    await this.pushStart();
  }

  /**
   * Create the session on the server, or adopt the one already open there.
   *
   * Adoption matters for the cross-device promise: pressing start on a phone
   * while a laptop holds a running session must continue that session, not open a
   * second one. When the server reports adoption, this engine discards its empty
   * local session and takes over the server's.
   */
  private async pushStart(): Promise<void> {
    const session = this.session;
    if (!session) return;

    const result = await api.sessions.start({
      clientId: session.clientId,
      subjectId: session.subjectId,
      taskId: session.taskId,
      kind: session.kind,
      plannedDuration: session.plannedDuration,
      timeZone: session.timeZone,
      device: session.device,
      startTime: new Date(session.startTime).toISOString(),
    });

    if (result.ok) {
      const { session: server, adopted } = result.data;

      if (adopted && server.clientId !== session.clientId) {
        // Another device owns a live session: take it over locally.
        this.session = {
          ...session,
          clientId: server.clientId,
          serverId: server.id,
          subjectId: server.subjectId,
          taskId: server.taskId,
          plannedDuration: server.plannedDuration || session.plannedDuration,
          startTime: Date.parse(server.startTime),
          events: (server.events ?? []).map((event) => ({ type: event.type, at: Date.parse(event.at), kind: event.kind })),
        };
        // The abandoned local attempt is not a real session; drop it.
        await deleteOutboxEntry(session.clientId).catch(() => {});
        this.flushedClientId = this.session.clientId;
        this.flushedEventCount = this.session.events.length;
      } else {
        this.session = { ...session, serverId: server.id };
        this.flushedClientId = session.clientId;
        this.flushedEventCount = session.events.length;
      }

      this.persist();
      await putOutboxEntry(this.session).catch(() => {});
      this.emit();
      this.broadcast({ type: 'adopted', clientId: this.session.clientId });
      return;
    }

    // Offline or transient failure: the session lives on locally and will sync.
    if (!result.error.isOffline) {
      this.deps.onError?.(result.error.message);
    }
    this.queueFlush();
  }

  /** @param {string} type an `EVENT` value */
  private async transition(type: string): Promise<void> {
    const session = this.session;
    if (!session || session.close) return;

    // Only the owning tab may write. Followers see the result over the channel.
    if (!this.isLeader) return;

    const at = this.now();
    this.session = { ...session, events: appendEvent(session.events, { type, at }), updatedAt: at };
    this.persist();
    await putOutboxEntry(this.session).catch(() => {});
    this.emit();
    this.broadcast({ type: 'events', clientId: this.session.clientId, events: [{ type, at }] });

    await this.flush();
  }

  async pause(): Promise<void> {
    await this.transition(EVENT.PAUSE);
  }

  async resume(): Promise<void> {
    await this.transition(EVENT.RESUME);
  }

  async startBreak(): Promise<void> {
    await this.transition(EVENT.BREAK_START);
  }

  async endBreak(): Promise<void> {
    await this.transition(EVENT.BREAK_END);
  }

  async recordDistraction(kind: string): Promise<void> {
    const session = this.session;
    if (!session || session.close || !this.isLeader) return;

    const at = this.now();
    this.session = { ...session, events: appendEvent(session.events, { type: EVENT.DISTRACTION, at, kind }), updatedAt: at };
    this.persist();
    await putOutboxEntry(this.session).catch(() => {});
    this.emit();
    this.broadcast({ type: 'events', clientId: this.session.clientId, events: [{ type: EVENT.DISTRACTION, at, kind }] });
    await this.flush();
  }

  /**
   * Add time to the plan. Purely a change of intention: it never touches recorded
   * time, so the score's completion factor is judged against what was actually
   * intended when the session ended.
   */
  async extend(minutes: number): Promise<void> {
    const session = this.session;
    if (!session || session.close) return;

    this.session = { ...session, plannedDuration: session.plannedDuration + minutes * 60, updatedAt: this.now() };
    this.persist();
    await putOutboxEntry(this.session).catch(() => {});
    this.emit();
    this.broadcast({ type: 'extended', clientId: this.session.clientId, seconds: minutes * 60 });
    await this.flush();
  }

  /**
   * End the session.
   *
   * The local close is committed before the request, so the outcome is recorded
   * even if the network has gone away; the flush retries later under the same
   * client id and is idempotent.
   */
  async finish(options: { status?: string; reflection?: string | null; interruptedReason?: string | null } = {}): Promise<void> {
    const session = this.session;
    if (!session) return;
    if (session.close) {
      await this.flush({ force: true });
      await this.clear();
      return;
    }

    const endedAt = this.now();
    const snapshot = snapshotFrom({ ...session, close: null }, { now: endedAt });

    const status =
      options.status ??
      (snapshot.plannedSeconds > 0 && snapshot.focusedSeconds >= snapshot.plannedSeconds * 0.9
        ? SESSION_STATUS.COMPLETED
        : SESSION_STATUS.CANCELLED);

    this.session = {
      ...session,
      events: appendEvent(session.events, { type: EVENT.END, at: endedAt }),
      close: { status, reflection: options.reflection ?? null, endedAt },
      updatedAt: endedAt,
    };

    this.stopHeartbeat();
    this.releaseLeadership();
    this.persist();
    await putOutboxEntry(this.session).catch(() => {});
    this.emit();
    this.broadcast({ type: 'finished', clientId: this.session.clientId });

    const result = await this.flush({ force: true });

    if (result?.ok && result.session) {
      this.deps.onSessionCompleted?.(result.session, result.newlyUnlocked ?? []);
    }
  }

  /**
   * Discard local state for a session that the server has accepted and closed.
   * The engine goes idle and the cockpit refreshes its aggregates.
   */
  async clear(): Promise<void> {
    const clientId = this.session?.clientId ?? null;
    this.session = null;
    this.flushedClientId = null;
    this.flushedEventCount = 0;
    localStorage.removeItem(STORAGE_KEY);
    if (clientId) await deleteOutboxEntry(clientId).catch(() => {});
    this.stopHeartbeat();
    this.emit();
  }

  /** Drop a local session without telling the server. Used when it was never real. */
  async abandon(): Promise<void> {
    await this.clear();
  }

  // --------------------------------------------------------------- synchronising

  /**
   * Push everything observed so far to the server, in one batched, idempotent
   * request. Safe to call often: the server collapses duplicate events.
   */
  async flush(options: { force?: boolean } = {}): Promise<{ ok: boolean; session?: SessionDto; newlyUnlocked?: string[] } | null> {
    const session = this.session;
    if (!session) return null;

    if (!this.isLeader && !session.close) return null;
    if (this.pendingFlush && !options.force) return null;
    this.pendingFlush = true;

    try {
      if (!session.serverId) {
        await this.pushStart();
        if (!this.session?.serverId) return { ok: false };
      }

      const current = this.session;
      if (!current?.serverId) return { ok: false };

      const hasUnpushedEvents =
        this.flushedClientId !== current.clientId ||
        current.events.length > this.flushedEventCount;
      const needsEventPush = hasUnpushedEvents && !current.close;
      if (needsEventPush && current.events.length > 0) {
        const result = await api.sessions.events(
          current.serverId,
          current.events.map((event) => ({
            type: event.type,
            at: new Date(event.at).toISOString(),
            kind: event.kind ?? null,
          })),
        );

        if (!result.ok) {
          if (!result.error.isOffline) {
            // A 409 means the server already closed this session elsewhere. Keep
            // the local record rather than looping on a request that cannot succeed.
            this.deps.onError?.(result.error.message);
          }
          return { ok: false };
        }

        this.flushedClientId = current.clientId;
        this.flushedEventCount = current.events.length;
      }

      if (current.close) {
        const result = await api.sessions.complete(current.serverId, {
          status: current.close.status,
          endedAt: new Date(current.close.endedAt).toISOString(),
          reflection: current.close.reflection,
          events: current.events.map((event) => ({
            type: event.type,
            at: new Date(event.at).toISOString(),
            kind: event.kind ?? null,
          })),
        });

        if (result.ok) {
          await putOutboxEntry({ ...current, attempts: 0, lastError: null }).catch(() => {});
          this.flushedClientId = current.clientId;
          this.flushedEventCount = current.events.length;
          this.emit();
          return { ok: true, session: result.data.session, newlyUnlocked: result.data.newlyUnlocked };
        }

        if (!result.error.isOffline) {
          this.deps.onError?.(result.error.message);
          // The server rejected the close; keep the local record so nothing is lost.
          return { ok: false };
        }
        return { ok: false };
      }

      this.flushedClientId = current.clientId;
      this.flushedEventCount = current.events.length;
      this.persist();
      this.emit();
      return { ok: true };
    } finally {
      this.pendingFlush = false;
    }
  }

  /** Retry the queue after a failure or once the connection returns. */
  queueFlush(delayMs = 4_000): void {
    if (this.flushHandle !== null) return;
    this.flushHandle = setTimeout(() => {
      this.flushHandle = null;
      void this.flush({ force: true });
    }, delayMs) as unknown as number;
  }

  /** Push any *other* sessions the outbox is holding. Called on reconnect. */
  async flushOutbox(): Promise<number> {
    const entries = await listOutbox();
    let flushed = 0;

    for (const entry of entries) {
      if (entry.clientId === this.session?.clientId) continue;

      const start = await api.sessions.start({
        clientId: entry.clientId,
        subjectId: entry.subjectId,
        taskId: entry.taskId,
        kind: entry.kind,
        plannedDuration: entry.plannedDuration,
        timeZone: entry.timeZone,
        device: entry.device,
        startTime: new Date(entry.startTime).toISOString(),
      });
      if (!start.ok) continue;

      const serverId = start.data.session.id;
      const eventsPayload = entry.events.map((event) => ({
        type: event.type,
        at: new Date(event.at).toISOString(),
        kind: event.kind ?? null,
      }));

      if (entry.close) {
        await api.sessions.complete(serverId, {
          status: entry.close.status,
          endedAt: new Date(entry.close.endedAt).toISOString(),
          reflection: entry.close.reflection,
          events: eventsPayload,
        });
      } else {
        await api.sessions.events(serverId, eventsPayload);
      }

      await deleteOutboxEntry(entry.clientId).catch(() => {});
      flushed += 1;
    }

    return flushed;
  }

  // -------------------------------------------------------------------- internals

  private persist(): void {
    if (this.session) localStorage.setItem(STORAGE_KEY, JSON.stringify(this.session));
    else localStorage.removeItem(STORAGE_KEY);
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    this.deps.onSnapshot?.(snapshot);
    for (const listener of this.listeners) listener(snapshot);
  }

  /**
   * Tick once per second.
   *
   * The tick exists only to repaint. It computes nothing: every value comes from
   * folding the event log against the current clock, so a missed tick, a
   * throttled background tab or a suspended laptop produces the correct reading on
   * the next one.
   */
  private startTick(): void {
    if (this.tickHandle !== null) return;
    this.tickHandle = setInterval(() => this.emit(), 1000) as unknown as number;
  }

  private stopTick(): void {
    if (this.tickHandle !== null) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
  }

  private handleVisibilityChange = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      this.ensureLeadership();
      this.onWakeOrVisible();
    }
  };

  private onWakeOrVisible(): void {
    if (!this.session || this.session.close) return;

    const at = this.now();
    const last = [...this.session.events]
      .reverse()
      .find((event) => event.type === EVENT.HEARTBEAT || event.type === EVENT.START);
    const elapsed = last ? at - last.at : 0;

    // If more than a heartbeat interval has elapsed and we haven't crossed the idle tolerance,
    // immediately record a heartbeat so no timing gap accumulates.
    if (elapsed >= HEARTBEAT_INTERVAL_MS && elapsed < IDLE_GAP_MS) {
      this.recordHeartbeat();
    }

    this.emit();
  }

  private ensureLeadership(): boolean {
    if (this.isLeader) return true;
    const readLease = () => safeParse<{ id: string; at: number }>(localStorage.getItem(LEASE_KEY));
    const lease = readLease();
    const now = this.now();

    if (!lease || lease.id === this.instanceId || now - lease.at >= LEASE_MS) {
      this.claimLeadership(true);
      return this.isLeader;
    }
    return false;
  }

  private recordHeartbeat(): void {
    if (!this.session || this.session.close) return;
    if (!this.isLeader && !this.ensureLeadership()) return;

    const at = this.now();
    const last = [...this.session.events].reverse().find((event) => event.type === EVENT.HEARTBEAT);
    if (last && at - last.at < HEARTBEAT_INTERVAL_MS - 5_000) return;

    this.session = { ...this.session, events: appendEvent(this.session.events, { type: EVENT.HEARTBEAT, at }), updatedAt: at };
    this.persist();
    void putOutboxEntry(this.session).catch(() => {});
    void this.flush();
  }

  /**
   * Emit liveness evidence while a session is open.
   *
   * Heartbeats are what let the server distinguish "the user was working" from
   * "the laptop was asleep for four hours": a gap longer than the documented
   * tolerance is reclassified as idle rather than billed as focus. They are also a
   * cheap sync opportunity, so a long session stays durable without extra work.
   */
  private startHeartbeat(): void {
    if (this.heartbeatHandle !== null || this.heartbeatWorker !== null) return;

    // A Web Worker is immune to background tab throttling in Chromium/WebKit browsers,
    // guaranteeing steady heartbeats when working in other windows.
    if (typeof window !== 'undefined' && typeof Worker !== 'undefined' && typeof Blob !== 'undefined') {
      try {
        const workerScript = `
          let timer = null;
          self.onmessage = function(e) {
            if (e.data === 'start') {
              if (timer) clearInterval(timer);
              timer = setInterval(function() { self.postMessage('tick'); }, ${HEARTBEAT_INTERVAL_MS});
            } else if (e.data === 'stop') {
              if (timer) clearInterval(timer);
              timer = null;
            }
          };
        `;
        const blob = new Blob([workerScript], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        const worker = new Worker(url);
        worker.onmessage = (e) => {
          if (e.data === 'tick') this.recordHeartbeat();
        };
        worker.postMessage('start');
        this.heartbeatWorker = worker;
        this.heartbeatWorkerBlobUrl = url;
      } catch {
        this.heartbeatWorker = null;
      }
    }

    // Standard interval fallback if Web Workers are unavailable
    if (!this.heartbeatWorker) {
      this.heartbeatHandle = setInterval(() => {
        this.recordHeartbeat();
      }, HEARTBEAT_INTERVAL_MS) as unknown as number;
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatWorker !== null) {
      try {
        this.heartbeatWorker.postMessage('stop');
        this.heartbeatWorker.terminate();
      } catch {}
      if (this.heartbeatWorkerBlobUrl) {
        try {
          URL.revokeObjectURL(this.heartbeatWorkerBlobUrl);
        } catch {}
        this.heartbeatWorkerBlobUrl = null;
      }
      this.heartbeatWorker = null;
    }

    if (this.heartbeatHandle !== null) {
      clearInterval(this.heartbeatHandle);
      this.heartbeatHandle = null;
    }
  }

  /**
   * Claim the single-writer lease.
   *
   * `localStorage` is used rather than `BroadcastChannel` for the claim itself
   * because it is synchronously readable and atomic enough for this purpose: two
   * tabs racing to write produce one winner, and the loser sees a fresh timestamp
   * and stands down.
   */
  private claimLeadership(force = false): void {
    const readLease = () => safeParse<{ id: string; at: number }>(localStorage.getItem(LEASE_KEY));
    const lease = readLease();
    const now = this.now();

    if (!force && lease && lease.id !== this.instanceId && now - lease.at < LEASE_MS) {
      this.isLeader = false;
      return;
    }

    this.isLeader = true;
    localStorage.setItem(LEASE_KEY, JSON.stringify({ id: this.instanceId, at: now }));

    if (this.leaseHandle === null) {
      this.leaseHandle = setInterval(() => {
        if (!this.isLeader) return;
        localStorage.setItem(LEASE_KEY, JSON.stringify({ id: this.instanceId, at: this.now() }));
      }, Math.floor(LEASE_MS / 3)) as unknown as number;
    }
  }

  private releaseLeadership(): void {
    const lease = safeParse<{ id: string; at: number }>(localStorage.getItem(LEASE_KEY));
    if (lease?.id === this.instanceId) localStorage.removeItem(LEASE_KEY);
    this.isLeader = false;
    if (this.leaseHandle !== null) {
      clearInterval(this.leaseHandle);
      this.leaseHandle = null;
    }
  }

  /**
   * Keep sibling tabs in step.
   *
   * A follower tab applies the leader's events locally so its display matches,
   * but never writes to the network or to the outbox — that is what prevents two
   * tabs from double-recording a distraction.
   */
  private openChannel(): void {
    if (typeof BroadcastChannel === 'undefined' || this.channel) return;

    this.channel = new BroadcastChannel(CHANNEL_NAME);
    this.channel.onmessage = (message) => {
      const data = message.data as
        | { type: string; clientId: string; events?: OutboxEvent[]; seconds?: number }
        | undefined;
      if (!data || data.type === 'ping') return;
      // Ignore our own broadcasts.
      if (data.clientId === this.session?.clientId && this.isLeader) return;

      if (data.type === 'started' || data.type === 'adopted') {
        const stored = safeParse<LocalSession>(localStorage.getItem(STORAGE_KEY));
        if (stored) {
          this.session = stored;
          this.isLeader = false;
          this.startTick();
          this.emit();
        }
        return;
      }

      if (!this.session || this.session.clientId !== data.clientId) return;

      if (data.type === 'events' && data.events) {
        let events = this.session.events;
        for (const event of data.events) events = appendEvent(events, event);
        this.session = { ...this.session, events, updatedAt: this.now() };
        this.emit();
      }

      if (data.type === 'extended' && data.seconds) {
        this.session = { ...this.session, plannedDuration: this.session.plannedDuration + data.seconds };
        this.emit();
      }

      if (data.type === 'finished') {
        const stored = safeParse<LocalSession>(localStorage.getItem(STORAGE_KEY));
        if (stored) this.session = stored;
        this.emit();
      }
    };
  }

  private broadcast(message: Record<string, unknown>): void {
    this.channel?.postMessage(message);
  }
}

/**
 * Reconcile a local session with the server after waking from sleep or coming
 * back online.
 *
 * Returns the refreshed snapshot so the caller can react to a session that the
 * idle guard reaped while the machine was suspended — which is the one case where
 * the local view and the server's view genuinely differ, and the difference is
 * worth telling the user about.
 */
export async function reconcile(timer: FocusTimer): Promise<{ reconciled: SessionDto | null; open: SessionDto | null }> {
  const result = await api.sessions.current();
  if (!result.ok) return { reconciled: null, open: null };

  const { openSession, reconciled } = result.data;

  if (reconciled) {
    // The server closed a session we still thought was running. Adopt its verdict.
    await timer.clear();
  }

  return { reconciled, open: openSession };
}
