"use client";

import { useCallback, useEffect, useRef } from "react";
import { createPoller, type Poller, type PollTask } from "@/lib/poller";
import { MAX_POLL_BACKOFF_MS } from "@/lib/liveUpdates";

/**
 * Polls `task` every `intervalMs` while the tab is visible (see lib/poller.ts
 * for the exact rules). The latest `task` closure is always used, so it can
 * read current state. Returns `refresh()`, which runs the task immediately
 * (call it after the user's own actions). Stops on unmount or when
 * `enabled` turns false.
 */
export function usePolling(
  task: PollTask,
  intervalMs: number,
  { enabled = true }: { enabled?: boolean } = {},
): () => void {
  const taskRef = useRef(task);
  const pollerRef = useRef<Poller | null>(null);

  useEffect(() => {
    taskRef.current = task;
  });

  useEffect(() => {
    if (!enabled) return;
    const poller = createPoller((signal) => taskRef.current(signal), {
      intervalMs,
      maxBackoffMs: MAX_POLL_BACKOFF_MS,
    });
    pollerRef.current = poller;
    poller.start();
    return () => {
      poller.stop();
      if (pollerRef.current === poller) pollerRef.current = null;
    };
  }, [intervalMs, enabled]);

  return useCallback(() => pollerRef.current?.trigger(), []);
}
