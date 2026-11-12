/**
 * Framework-free polling loop used by usePolling (lib/usePolling.ts).
 * LIVE_UPDATES = smart-polling:
 *
 *  - runs the task right away on start(), then `intervalMs` after each run
 *    finished (setTimeout chain, so requests never overlap),
 *  - pauses while the document is hidden and runs immediately when it
 *    becomes visible again or the window gets focus,
 *  - backs off exponentially after failures (capped at `maxBackoffMs`) and
 *    returns to the normal interval after the next success,
 *  - stop() clears the timer, aborts the in-flight request (AbortSignal) and
 *    removes the listeners: nothing runs after unmount.
 *
 * The task may resolve to "stop" to end polling (e.g. on 401), or to "again"
 * to run once more right away (e.g. more data is waiting).
 * `trigger()` asks for an immediate run (after the user's own actions); if a
 * run is in flight it runs once more right after it, so the result reflects
 * the action. Focus/visibility triggers don't queue an extra run.
 */

export type PollResult = void | "stop" | "again";
export type PollTask = (signal: AbortSignal) => Promise<PollResult>;

type Listenable = {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
};

export type VisibilitySource = Listenable & { readonly visibilityState: string };

export type PollerOptions = {
  intervalMs: number;
  maxBackoffMs?: number;
  /** Defaults to `document` in the browser; null disables visibility handling. */
  doc?: VisibilitySource | null;
  /** Defaults to `window` in the browser; null disables focus handling. */
  win?: Listenable | null;
};

export type Poller = {
  start(): void;
  stop(): void;
  /** Run now (or right after the in-flight run). */
  trigger(): void;
};

export function createPoller(task: PollTask, options: PollerOptions): Poller {
  const { intervalMs } = options;
  const maxBackoffMs = Math.max(options.maxBackoffMs ?? intervalMs * 8, intervalMs);
  const doc = options.doc !== undefined ? options.doc : typeof document !== "undefined" ? document : null;
  const win = options.win !== undefined ? options.win : typeof window !== "undefined" ? window : null;

  let stopped = true;
  let running = false;
  let rerun = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;

  const isVisible = () => !doc || doc.visibilityState !== "hidden";

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const schedule = (delayMs: number) => {
    clearTimer();
    if (stopped || !isVisible()) return;
    timer = setTimeout(() => {
      timer = null;
      void run();
    }, delayMs);
  };

  async function run(): Promise<void> {
    if (stopped || !isVisible()) return;
    if (running) {
      rerun = true;
      return;
    }

    running = true;
    const ownController = new AbortController();
    controller = ownController;
    let result: PollResult = undefined;
    let failed = false;
    try {
      result = await task(ownController.signal);
    } catch {
      failed = true;
    } finally {
      running = false;
      if (controller === ownController) controller = null;
    }

    if (stopped) return;
    if (result === "stop") {
      stop();
      return;
    }
    failures = failed ? failures + 1 : 0;

    if (rerun || result === "again") {
      rerun = false;
      schedule(0);
      return;
    }
    schedule(failures === 0 ? intervalMs : Math.min(intervalMs * 2 ** failures, maxBackoffMs));
  }

  /** Visibility/focus: run now unless a run is already in flight. */
  const softTrigger = () => {
    if (stopped || running) return;
    if (!isVisible()) {
      clearTimer();
      return;
    }
    clearTimer();
    void run();
  };

  function trigger() {
    if (stopped) return;
    if (running) {
      rerun = true;
      return;
    }
    clearTimer();
    void run();
  }

  function onVisibilityChange() {
    if (isVisible()) softTrigger();
    else clearTimer();
  }

  function start() {
    if (!stopped) return;
    stopped = false;
    failures = 0;
    doc?.addEventListener("visibilitychange", onVisibilityChange);
    win?.addEventListener("focus", softTrigger);
    softTrigger();
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    rerun = false;
    clearTimer();
    controller?.abort();
    controller = null;
    doc?.removeEventListener("visibilitychange", onVisibilityChange);
    win?.removeEventListener("focus", softTrigger);
  }

  return { start, stop, trigger };
}
