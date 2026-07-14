import { describe, expect, it } from "bun:test";
import { acceptanceTuningSettings } from "../../simulator/tuning.ts";
import { TuningStore } from "../src/tuning-store.ts";
import { installIndexedDbShim } from "./indexeddb-shim.ts";

installIndexedDbShim();
function dbName() { return `tuning-${Date.now()}-${Math.random()}`; }
function quickSettings() { const s = acceptanceTuningSettings(); s.candidateCount = 2; s.generationsRequested = 2; s.seedSet = [1]; s.openingSuite = ["C1-B1", "K1-L1"]; s.antiOverfitSettings.validationSeeds = [101]; s.antiOverfitSettings.holdoutSeeds = [1001]; return s; }

describe("persistent evolutionary tuning lifecycle", () => {
  it("creates tuning stores, generation 0 records, and prevents duplicate match completion", async () => {
    const store = new TuningStore(dbName());
    const run = await store.createTuningRun(quickSettings());
    let snap = (await store.loadTuningRun(run.tuningRunId))!;
    expect(snap.run.status).toBe("queued");
    expect(snap.candidates.filter(c => c.generation === 0)).toHaveLength(2);
    expect(snap.generations[0].generation).toBe(0);
    const match = snap.matches[0];
    await store.markMatchRunning(run.tuningRunId, match.matchId);
    await store.completeMatch(run.tuningRunId, match.matchId, { result: "green", plies: 12, drawReason: null, diagnostics: { illegalMoves: 0 }, replayOk: true });
    await store.completeMatch(run.tuningRunId, match.matchId, { result: "green", plies: 12, drawReason: null, diagnostics: { illegalMoves: 0 }, replayOk: true });
    snap = (await store.loadTuningRun(run.tuningRunId))!;
    expect(snap.run.completedMatches).toBe(1);
    expect(snap.matches.find(m => m.matchId === match.matchId)!.status).toBe("completed");
  });

  it("recovers interrupted runs and running matches without auto-restarting", async () => {
    const name = dbName();
    let store = new TuningStore(name);
    const run = await store.createTuningRun(quickSettings());
    const match = (await store.nextQueuedMatch(run.tuningRunId))!;
    await store.markMatchRunning(run.tuningRunId, match.matchId);
    store.close();
    store = new TuningStore(name);
    await store.recoverInterruptedTuningRuns();
    const snap = (await store.loadTuningRun(run.tuningRunId))!;
    expect(snap.run.status).toBe("paused");
    expect(snap.run.currentWorkerState).toBe("interrupted");
    expect(snap.matches.find(m => m.matchId === match.matchId)!.status).toBe("queued");
  });

  it("executes two training generations, then validation and holdout, and persists lineage", async () => {
    const store = new TuningStore(dbName());
    const run = await store.createTuningRun(quickSettings());
    for (let guard = 0; guard < 80; guard++) {
      const snap = (await store.loadTuningRun(run.tuningRunId))!;
      if (snap.run.status === "completed") break;
      const match = await store.nextQueuedMatch(run.tuningRunId);
      if (!match) break;
      await store.markMatchRunning(run.tuningRunId, match.matchId);
      await store.completeMatch(run.tuningRunId, match.matchId, { result: guard % 3 === 0 ? "green" : guard % 3 === 1 ? "blue" : "draw", plies: 12, drawReason: null, diagnostics: { illegalMoves: 0, uniquePositionsVisited: 8 + guard }, replayOk: true });
    }
    const final = (await store.loadTuningRun(run.tuningRunId))!;
    expect(final.candidates.some(c => c.generation === 1 && c.parentCandidateIds.length > 0)).toBe(true);
    expect(final.matches.filter(m => m.fixture === "validation").length).toBeGreaterThan(0);
    expect(final.matches.filter(m => m.fixture === "holdout").length).toBeGreaterThan(0);
    expect(final.run.status).toBe("completed");
    expect(final.reports.length).toBeGreaterThan(0);
  }, 30000);

  it("pauses, retries failures, cancels while preserving completions, deletes linked records, and preserves approved profiles", async () => {
    const store = new TuningStore(dbName());
    const run = await store.createTuningRun(quickSettings());
    const first = (await store.nextQueuedMatch(run.tuningRunId))!;
    await store.markMatchRunning(run.tuningRunId, first.matchId);
    await store.completeMatch(run.tuningRunId, first.matchId, { result: "draw", plies: 10, drawReason: "max-plies", diagnostics: { illegalMoves: 0 }, replayOk: true });
    const second = (await store.nextQueuedMatch(run.tuningRunId))!;
    await store.failMatch(run.tuningRunId, second.matchId, "boom");
    await store.retryFailedMatches(run.tuningRunId);
    expect((await store.loadTuningRun(run.tuningRunId))!.matches.filter(m => m.status === "failed")).toHaveLength(0);
    await store.pauseTuningRun(run.tuningRunId);
    expect((await store.loadTuningRun(run.tuningRunId))!.run.status).toBe("paused");
    await store.cancelTuningRun(run.tuningRunId);
    expect((await store.loadTuningRun(run.tuningRunId))!.matches.filter(m => m.status === "completed")).toHaveLength(1);
    await store.deleteTuningRun(run.tuningRunId);
    expect(await store.loadTuningRun(run.tuningRunId)).toBeNull();
  });

  it("approval creates a separate experimental profile and rejection remains persisted", async () => {
    const store = new TuningStore(dbName());
    const run = await store.createTuningRun(quickSettings());
    const first = (await store.loadTuningRun(run.tuningRunId))!.candidates[0];
    const approved = await store.approveCandidate(run.tuningRunId, first.candidateId);
    expect(approved.profileId).not.toBe(first.profileId);
    expect(approved.source).toBe("promotion");
    await store.rejectCandidate(run.tuningRunId, first.candidateId);
    const snap = (await store.loadTuningRun(run.tuningRunId))!;
    expect(snap.candidates.find(c => c.candidateId === first.candidateId)!.eliminated).toBe(true);
  });
});
