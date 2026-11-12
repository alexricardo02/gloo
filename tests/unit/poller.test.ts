import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPoller, type PollResult } from '@/lib/poller';

/** Minimal document/window stand-ins with dispatchable events. */
function fakeTarget() {
  const listeners = new Map<string, Set<() => void>>();
  return {
    addEventListener: (type: string, fn: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener: (type: string, fn: () => void) => listeners.get(type)?.delete(fn),
    dispatch: (type: string) => listeners.get(type)?.forEach((fn) => fn()),
    count: (type: string) => listeners.get(type)?.size ?? 0,
  };
}

function setup() {
  const doc = Object.assign(fakeTarget(), { visibilityState: 'visible' as 'visible' | 'hidden' });
  const win = fakeTarget();
  return { doc, win };
}

/** A task whose calls can be resolved/rejected by the test. */
function controllableTask() {
  const calls: { resolve: (r?: PollResult) => void; reject: (e: Error) => void; signal: AbortSignal }[] = [];
  const task = vi.fn(
    (signal: AbortSignal) =>
      new Promise<PollResult>((resolve, reject) => {
        calls.push({ resolve, reject, signal });
      }),
  );
  return { task, calls };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

describe('createPoller (smart polling)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs immediately, then every interval after the previous run finished', async () => {
    const { doc, win } = setup();
    const task = vi.fn(async () => {});
    const poller = createPoller(task, { intervalMs: 1000, doc, win });

    poller.start();
    await flush();
    expect(task).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(999);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(task).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3000);
    expect(task).toHaveBeenCalledTimes(5);
    poller.stop();
  });

  it('never overlaps requests: a slow request delays the next one', async () => {
    const { doc, win } = setup();
    const { task, calls } = controllableTask();
    const poller = createPoller(task, { intervalMs: 1000, doc, win });

    poller.start();
    await flush();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(task).toHaveBeenCalledTimes(1); // still in flight

    win.dispatch('focus'); // focus while in flight: no second request
    await flush();
    expect(task).toHaveBeenCalledTimes(1);

    calls[0].resolve();
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect(task).toHaveBeenCalledTimes(2);
    poller.stop();
  });

  it('pauses while hidden and refetches immediately when visible again or focused', async () => {
    const { doc, win } = setup();
    const task = vi.fn(async () => {});
    const poller = createPoller(task, { intervalMs: 1000, doc, win });

    poller.start();
    await flush();
    expect(task).toHaveBeenCalledTimes(1);

    doc.visibilityState = 'hidden';
    doc.dispatch('visibilitychange');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(task).toHaveBeenCalledTimes(1); // nothing while hidden

    win.dispatch('focus'); // focus while still hidden: still nothing
    await flush();
    expect(task).toHaveBeenCalledTimes(1);

    doc.visibilityState = 'visible';
    doc.dispatch('visibilitychange');
    await flush();
    expect(task).toHaveBeenCalledTimes(2); // immediately, not after the interval

    await vi.advanceTimersByTimeAsync(500);
    win.dispatch('focus');
    await flush();
    expect(task).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(1000);
    expect(task).toHaveBeenCalledTimes(4); // the interval restarted after the focus run
    poller.stop();
  });

  it('does not start polling while the page is hidden', async () => {
    const { doc, win } = setup();
    doc.visibilityState = 'hidden';
    const task = vi.fn(async () => {});
    const poller = createPoller(task, { intervalMs: 1000, doc, win });

    poller.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(task).not.toHaveBeenCalled();
    poller.stop();
  });

  it('backs off exponentially on errors (capped) and recovers after a success', async () => {
    const { doc, win } = setup();
    let fail = true;
    const task = vi.fn(async () => {
      if (fail) throw new Error('boom');
    });
    const poller = createPoller(task, { intervalMs: 1000, maxBackoffMs: 4000, doc, win });

    poller.start();
    await flush();
    expect(task).toHaveBeenCalledTimes(1); // fails -> next in 2s

    await vi.advanceTimersByTimeAsync(1999);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(task).toHaveBeenCalledTimes(2); // fails -> next in 4s

    await vi.advanceTimersByTimeAsync(4000);
    expect(task).toHaveBeenCalledTimes(3); // fails -> capped at 4s
    await vi.advanceTimersByTimeAsync(4000);
    expect(task).toHaveBeenCalledTimes(4);

    fail = false;
    await vi.advanceTimersByTimeAsync(4000);
    expect(task).toHaveBeenCalledTimes(5); // succeeds -> back to 1s
    await vi.advanceTimersByTimeAsync(1000);
    expect(task).toHaveBeenCalledTimes(6);
    poller.stop();
  });

  it('stops on unmount: aborts the in-flight request, removes listeners, no further requests', async () => {
    const { doc, win } = setup();
    const { task, calls } = controllableTask();
    const poller = createPoller(task, { intervalMs: 1000, doc, win });

    poller.start();
    await flush();
    expect(doc.count('visibilitychange')).toBe(1);
    expect(win.count('focus')).toBe(1);

    poller.stop();
    expect(calls[0].signal.aborted).toBe(true);
    expect(doc.count('visibilitychange')).toBe(0);
    expect(win.count('focus')).toBe(0);

    calls[0].reject(new DOMException('aborted', 'AbortError'));
    poller.trigger();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('trigger() after the user\'s own action runs now, or right after the in-flight run', async () => {
    const { doc, win } = setup();
    const { task, calls } = controllableTask();
    const poller = createPoller(task, { intervalMs: 10_000, doc, win });

    poller.start();
    await flush();
    poller.trigger(); // in flight -> queued once
    poller.trigger();
    expect(task).toHaveBeenCalledTimes(1);

    calls[0].resolve();
    await flush();
    expect(task).toHaveBeenCalledTimes(2); // ran right after, not after 10s

    calls[1].resolve();
    await flush();
    poller.trigger(); // idle -> runs immediately
    await flush();
    expect(task).toHaveBeenCalledTimes(3);
    poller.stop();
  });

  it('a task resolving to "again" runs once more right away (more data waiting)', async () => {
    const { doc, win } = setup();
    let batches = 3;
    const task = vi.fn(async (): Promise<PollResult> => (--batches > 0 ? 'again' : undefined));
    const poller = createPoller(task, { intervalMs: 10_000, doc, win });

    poller.start();
    await vi.advanceTimersByTimeAsync(10); // well below the 10 s interval
    expect(task).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(task).toHaveBeenCalledTimes(3); // back to the normal interval
    poller.stop();
  });

  it('a task resolving to "stop" ends polling (e.g. 401)', async () => {
    const { doc, win } = setup();
    const task = vi.fn(async (): Promise<PollResult> => 'stop');
    const poller = createPoller(task, { intervalMs: 1000, doc, win });

    poller.start();
    await vi.advanceTimersByTimeAsync(10_000);
    win.dispatch('focus');
    await flush();
    expect(task).toHaveBeenCalledTimes(1);
    expect(win.count('focus')).toBe(0);
  });
});
