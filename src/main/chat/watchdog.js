import { performance } from 'node:perf_hooks';
import { traceError, traceInfo, traceVerbose } from '../trace-log.js';
import {
  EVENT_LOOP_BEAT_MS,
  EVENT_LOOP_LAG_TRACE_MS,
  WATCHDOG_INTERVAL_MS,
  WATCHDOG_MIN_STALL_MS,
  WATCHDOG_STALL_COUNT,
  WATCHDOG_WINDOW_MS,
} from './constants.js';

let lastBeatAt = performance.now();
let longestDelay = 0;

setInterval(() => {
  const now = performance.now();
  longestDelay = Math.max(longestDelay, now - lastBeatAt - EVENT_LOOP_BEAT_MS);
  lastBeatAt = now;
}, EVENT_LOOP_BEAT_MS).unref();

export const watchdogMethods = {
  measureBlocking(conversationId, task) {
    if (this.measuringBlocking) return task();
    this.measuringBlocking = true;
    const startedAt = performance.now();
    try {
      return task();
    } finally {
      this.measuringBlocking = false;
      this.blockingTime.set(
        conversationId,
        (this.blockingTime.get(conversationId) ?? 0) + performance.now() - startedAt,
      );
    }
  },

  watchdogTick() {
    const now = performance.now();
    const lag = now - this.watchdogExpectedAt;
    this.watchdogExpectedAt = now + WATCHDOG_INTERVAL_MS;

    if (longestDelay >= EVENT_LOOP_LAG_TRACE_MS) {
      traceVerbose('chat.event-loop-lag', {
        lag_ms: Math.round(longestDelay),
        concurrent_runs: this.runs.size,
      });
    }
    longestDelay = 0;

    const limit = lag >= WATCHDOG_MIN_STALL_MS ? this.getPreferences().tuning?.eventLoopWatchdogMs ?? 0 : 0;
    if (!limit || lag < limit) {
      if (now - this.watchdogWindowStartedAt >= WATCHDOG_WINDOW_MS) {
        this.blockingTime.clear();
        this.watchdogStalls = 0;
        this.watchdogWindowStartedAt = now;
      }
      return;
    }

    this.watchdogStalls += 1;
    this.watchdogWindowStartedAt = now;
    traceInfo('chat.watchdog-stall', { lag_ms: Math.round(lag), stalls: this.watchdogStalls });
    if (this.watchdogStalls < WATCHDOG_STALL_COUNT) return;

    const [conversationId, blockedMs] = [...this.blockingTime]
      .filter(([id]) => this.runs.has(id))
      .sort((left, right) => right[1] - left[1])[0] ?? [];
    if (!conversationId || blockedMs < limit) return;

    const run = this.runs.get(conversationId);
    run.watchdogError = `Avi stopped this thread because it blocked the app for ${Math.round(blockedMs)} ms `
      + `while the app stopped responding ${this.watchdogStalls} times for more than ${limit} ms.`;
    traceError('chat.watchdog-stopped', {
      thread_id: conversationId,
      blocked_ms: Math.round(blockedMs),
      lag_ms: Math.round(lag),
      stalls: this.watchdogStalls,
      limit_ms: limit,
    });
    this.blockingTime.clear();
    this.watchdogStalls = 0;
    this.stop(conversationId);
  },
};
