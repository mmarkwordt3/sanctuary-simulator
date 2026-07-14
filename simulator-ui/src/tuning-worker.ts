import { acceptanceTuningSettings } from "../../simulator/tuning.ts";
import { executePersistedTuningMatch, TuningStore } from "./tuning-store.ts";

type Request =
  | { type: "create-acceptance" }
  | { type: "run"; tuningRunId: string }
  | { type: "pause"; tuningRunId: string }
  | { type: "cancel"; tuningRunId: string }
  | { type: "retry"; tuningRunId: string };

let activeRunId: string | null = null;
let pauseRequested = false;
const store = new TuningStore();

async function runLoop(tuningRunId: string) {
  if (activeRunId && activeRunId !== tuningRunId) return;
  activeRunId = tuningRunId;
  pauseRequested = false;
  await store.resumeTuningRun(tuningRunId);
  try {
    while (!pauseRequested) {
      const snap = await store.loadTuningRun(tuningRunId);
      if (!snap || snap.run.status === "cancelled" || snap.run.status === "completed") break;
      if (snap.run.status === "paused") break;
      const match = await store.nextQueuedMatch(tuningRunId);
      if (!match) {
        if (snap.run.currentPhase === "complete") break;
        await new Promise((resolve) => setTimeout(resolve, 0));
        const refreshed = await store.loadTuningRun(tuningRunId);
        if (!refreshed || !refreshed.matches.some((m) => m.status === "queued")) break;
        continue;
      }
      const locked = await store.markMatchRunning(tuningRunId, match.matchId);
      if (!locked) continue;
      try { await executePersistedTuningMatch(store, tuningRunId, match); }
      catch (err) { await store.failMatch(tuningRunId, match.matchId, err instanceof Error ? err.message : String(err)); }
      const after = await store.loadTuningRun(tuningRunId);
      (self as any).postMessage({ type: "progress", snapshot: after });
      if (after?.run.autoPauseAfterGeneration && after.run.status === "paused") break;
    }
    if (pauseRequested) await store.pauseTuningRun(tuningRunId);
    (self as any).postMessage({ type: "idle", snapshot: await store.loadTuningRun(tuningRunId) });
  } finally {
    activeRunId = null;
  }
}

self.onmessage = async (event: MessageEvent<Request>) => {
  try {
    if (event.data.type === "create-acceptance") {
      const run = await store.createTuningRun(acceptanceTuningSettings());
      (self as any).postMessage({ type: "created", snapshot: await store.loadTuningRun(run.tuningRunId) });
      return;
    }
    if (event.data.type === "run") {
      if (activeRunId === event.data.tuningRunId) {
        (self as any).postMessage({ type: "duplicate-resume", tuningRunId: event.data.tuningRunId });
        return;
      }
      void runLoop(event.data.tuningRunId);
      return;
    }
    if (event.data.type === "pause") { pauseRequested = true; await store.pauseTuningRun(event.data.tuningRunId); return; }
    if (event.data.type === "cancel") { pauseRequested = true; await store.cancelTuningRun(event.data.tuningRunId); return; }
    if (event.data.type === "retry") { await store.retryFailedMatches(event.data.tuningRunId); return; }
  } catch (err) {
    (self as any).postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
