import { runJobGame, type ExperimentRecord, type GameJobRecord } from "./experiments.ts";
import type { GameRecord } from "./simulation-runner.ts";

export type ExperimentWorkerRequest =
  | { type: "run-job"; experiment: ExperimentRecord; job: GameJobRecord }
  | { type: "cancel" };

export type ExperimentWorkerResponse =
  | { type: "job-started"; jobId: string; ordinal: number }
  | { type: "progress"; jobId: string; message: string }
  | { type: "job-completed"; jobId: string; game: GameRecord }
  | { type: "job-failed"; jobId: string; message: string }
  | { type: "cancelled" };

let cancelled = false;

self.onmessage = (event: MessageEvent<ExperimentWorkerRequest>) => {
  const message = event.data;
  if (message.type === "cancel") {
    cancelled = true;
    postMessage({ type: "cancelled" } satisfies ExperimentWorkerResponse);
    return;
  }
  cancelled = false;
  postMessage({ type: "job-started", jobId: message.job.jobId, ordinal: message.job.ordinal } satisfies ExperimentWorkerResponse);
  postMessage({ type: "progress", jobId: message.job.jobId, message: `Running job ${message.job.ordinal}` } satisfies ExperimentWorkerResponse);
  try {
    if (cancelled) return;
    const game = runJobGame(message.experiment, message.job);
    if (cancelled) return;
    postMessage({ type: "job-completed", jobId: message.job.jobId, game } satisfies ExperimentWorkerResponse);
  } catch (error) {
    postMessage({ type: "job-failed", jobId: message.job.jobId, message: error instanceof Error ? error.message : String(error) } satisfies ExperimentWorkerResponse);
  }
};
