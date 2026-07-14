import { describe, expect, it } from "bun:test";
import { DEFAULT_SETTINGS } from "../src/config.ts";
import { exportExperiment, ExperimentStore, generateJobs, runJobGame } from "../src/experiments.ts";
import { replayStoredGame, targetedOpeningOptions } from "../src/simulation-runner.ts";
import { installIndexedDbShim } from "./indexeddb-shim.ts";

installIndexedDbShim();

const acceptanceSettings = () => ({
  mode: "targeted" as const,
  ...DEFAULT_SETTINGS.targeted,
  selectedGreenOpenings: targetedOpeningOptions().filter((o) => o.label.includes("C1-B1") || o.label.includes("K1-L1")).map((o) => o.label),
  blueResponseMode: "automatic" as const,
  selectedBlueRepliesByOpening: {},
  gamesPerMatchup: 2,
  greenAgent: "search-alpha-beta-deterministic" as const,
  blueAgent: "search-alpha-beta-deterministic" as const,
  searchDepth: 1,
  greenDiversity: 0 as const,
  blueDiversity: 0 as const,
  seed: 424242,
  maxPlies: 40,
  positionSampling: "none" as const,
});

function dbName() { return `test-${Date.now()}-${Math.random()}`; }

describe("IndexedDB experiment persistence", () => {
  it("initializes schema, persists experiments and deterministic jobs", async () => {
    const store = new ExperimentStore(dbName());
    const exp = await store.createExperiment("Schema", { mode: "standard", ...DEFAULT_SETTINGS.standard, games: 3, seed: 9 });
    expect((await store.listExperiments()).map((e) => e.experimentId)).toContain(exp.experimentId);
    expect((await store.getJobs(exp.experimentId)).map((j) => j.seed)).toEqual([9, 10, 11]);
    store.close();
  });

  it("atomically completes a game and protects duplicate completion", async () => {
    const store = new ExperimentStore(dbName());
    const exp = await store.createExperiment("Atomic", acceptanceSettings());
    const job = (await store.getJobs(exp.experimentId))[0];
    await store.markJobRunning(exp.experimentId, job.jobId);
    const running = (await store.getJobs(exp.experimentId))[0];
    const game = runJobGame((await store.getExperiment(exp.experimentId))!, running);
    await store.completeJob(exp.experimentId, running, game);
    await store.completeJob(exp.experimentId, running, game);
    const updated = (await store.getExperiment(exp.experimentId))!;
    expect(updated.completedJobs).toBe(1);
    expect((await store.completedGames(exp.experimentId)).total).toBe(1);
    expect((await store.getJobs(exp.experimentId))[0].status).toBe("completed");
    store.close();
  });

  it("recovers running jobs on reload, preserves partial completion, resumes, and exports", async () => {
    const name = dbName();
    let store = new ExperimentStore(name);
    const exp = await store.createExperiment("Automated Self-Play Acceptance", acceptanceSettings());
    const jobs = await store.getJobs(exp.experimentId);
    expect(jobs).toHaveLength(4);
    for (const job of jobs.slice(0, 2)) {
      await store.markJobRunning(exp.experimentId, job.jobId);
      await store.completeJob(exp.experimentId, { ...(await store.getJobs(exp.experimentId)).find((j) => j.jobId === job.jobId)! }, runJobGame((await store.getExperiment(exp.experimentId))!, job));
    }
    await store.markJobRunning(exp.experimentId, jobs[2].jobId);
    store.close();

    store = new ExperimentStore(name);
    await store.pauseRecovery();
    expect((await store.completedGames(exp.experimentId)).total).toBe(2);
    expect((await store.getJobs(exp.experimentId)).find((j) => j.jobId === jobs[2].jobId)!.status).toBe("queued");
    while ((await store.getExperiment(exp.experimentId))!.completedJobs < (await store.getExperiment(exp.experimentId))!.totalJobs) {
      const job = (await store.getJobs(exp.experimentId)).find((j) => j.status === "queued");
      if (!job) break;
      await store.markJobRunning(exp.experimentId, job.jobId);
      const running = (await store.getJobs(exp.experimentId)).find((j) => j.jobId === job.jobId)!;
      await store.completeJob(exp.experimentId, running, runJobGame((await store.getExperiment(exp.experimentId))!, running));
    }
    const final = (await store.getExperiment(exp.experimentId))!;
    const completed = await store.completedGames(exp.experimentId, { limit: 10 });
    expect(final.completedJobs).toBe(4);
    expect(completed.total).toBe(4);
    expect(new Set(completed.games.map((g) => g.gameId)).size).toBe(4);
    expect(completed.games.every((g) => replayStoredGame(g).ok)).toBe(true);
    expect((await exportExperiment(store, exp.experimentId)).map((f) => f.name)).toContain("games.jsonl");
    console.log(`acceptance: created=4 afterReload=2 final=${final.completedJobs}/${final.totalJobs} unique=${new Set(completed.games.map((g) => g.gameId)).size} replayOk=${completed.games.every((g) => replayStoredGame(g).ok)} exportFiles=${(await exportExperiment(store, exp.experimentId)).length}`);
  }, 20000);

  it("cancels with completed games preserved, retries failed jobs, filters, paginates, and deletes", async () => {
    const store = new ExperimentStore(dbName());
    const exp = await store.createExperiment("Management", acceptanceSettings());
    const first = (await store.getJobs(exp.experimentId))[0];
    await store.markJobRunning(exp.experimentId, first.jobId);
    await store.completeJob(exp.experimentId, first, runJobGame((await store.getExperiment(exp.experimentId))!, first));
    await store.failJob(exp.experimentId, (await store.getJobs(exp.experimentId))[1], "boom");
    await store.retryFailedJobs(exp.experimentId);
    expect((await store.getJobs(exp.experimentId)).filter((j) => j.status === "failed")).toHaveLength(0);
    await store.cancelExperiment(exp.experimentId);
    expect((await store.completedGames(exp.experimentId)).total).toBe(1);
    expect((await store.completedGames(exp.experimentId, { limit: 1, winner: "draw" })).games.length).toBeLessThanOrEqual(1);
    await store.deleteExperiment(exp.experimentId);
    expect(await store.getExperiment(exp.experimentId)).toBeUndefined();
    expect(await store.getJobs(exp.experimentId)).toHaveLength(0);
    expect((await store.completedGames(exp.experimentId)).total).toBe(0);
  }, 20000);
});

describe("active runtime accounting", () => {
  it("counts completed and failed active durations without counting paused time, and exports JSON prefixes", async () => {
    const store = new ExperimentStore(dbName());
    const exp = await store.createExperiment("Runtime", acceptanceSettings());
    const [first, second] = await store.getJobs(exp.experimentId);
    await store.markJobRunning(exp.experimentId, first.jobId);
    await new Promise((r) => setTimeout(r, 5));
    await store.pauseExperiment(exp.experimentId);
    const afterPause = (await store.getExperiment(exp.experimentId))!.activeMs;
    await new Promise((r) => setTimeout(r, 20));
    expect((await store.getExperiment(exp.experimentId))!.activeMs).toBe(afterPause);
    await store.markJobRunning(exp.experimentId, first.jobId);
    await new Promise((r) => setTimeout(r, 5));
    await store.completeJob(exp.experimentId, (await store.getJobs(exp.experimentId)).find((j) => j.jobId === first.jobId)!, runJobGame((await store.getExperiment(exp.experimentId))!, first));
    const afterComplete = (await store.getExperiment(exp.experimentId))!.activeMs;
    expect(afterComplete).toBeGreaterThan(0);
    await store.markJobRunning(exp.experimentId, second.jobId);
    await new Promise((r) => setTimeout(r, 5));
    await store.failJob(exp.experimentId, (await store.getJobs(exp.experimentId)).find((j) => j.jobId === second.jobId)!, "expected failure");
    expect((await store.getExperiment(exp.experimentId))!.activeMs).toBeGreaterThan(afterComplete);
    const jobsCsv = (await exportExperiment(store, exp.experimentId)).find((f) => f.name === "game_jobs.csv")!.content;
    expect(jobsCsv).not.toContain("[object Object]");
    expect(jobsCsv).toContain('"[{""pieceId"');
  }, 20000);
});
