import { runOpening, runStandard, type ProgressUpdate, type RunResult } from "./simulation-runner.ts";
import type { OpeningSettings, StandardSettings } from "./config.ts";

export type WorkerRequest =
  | { type: "start-standard"; settings: StandardSettings }
  | { type: "start-opening"; settings: OpeningSettings }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "cancel" };

export type WorkerResponse =
  | { type: "progress"; progress: ProgressUpdate }
  | { type: "complete"; result: RunResult }
  | { type: "cancelled"; result: RunResult }
  | { type: "error"; message: string };

let paused = false;
let cancelled = false;
let resumeWaiters: Array<() => void> = [];
let running = false;

function waitIfPaused(): Promise<void> {
  if (!paused) return Promise.resolve();
  return new Promise((resolve) => resumeWaiters.push(resolve));
}

function resume(): void {
  paused = false;
  const waiters = resumeWaiters;
  resumeWaiters = [];
  waiters.forEach((fn) => fn());
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.type === "pause") { paused = true; return; }
  if (message.type === "resume") { resume(); return; }
  if (message.type === "cancel") { cancelled = true; resume(); return; }
  if (running) return;
  running = true;
  cancelled = false;
  paused = false;
  const control = {
    isCancelled: () => cancelled,
    waitIfPaused,
    onProgress: (progress: ProgressUpdate) => postMessage({ type: "progress", progress } satisfies WorkerResponse),
  };
  try {
    const result = message.type === "start-standard"
      ? await runStandard(message.settings, control)
      : await runOpening(message.settings, control);
    postMessage({ type: result.cancelled ? "cancelled" : "complete", result } satisfies WorkerResponse);
  } catch (error) {
    postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) } satisfies WorkerResponse);
  } finally {
    running = false;
  }
};
