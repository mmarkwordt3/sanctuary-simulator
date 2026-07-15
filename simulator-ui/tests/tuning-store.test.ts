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
    const files = await store.exportTuningRun(run.tuningRunId);
    expect(files.find(f => f.name === "matches.csv")!.content).toContain("tuningRunId");
    expect(files.find(f => f.name === "evaluation_profiles.json")!.content).toContain("profileId");
    expect(files.find(f => f.name === "promotion_report.md")!.content.length).toBeGreaterThan(20);
    expect(final.candidates.some(c => c.scoreBreakdown?.validationScore !== undefined && c.scoreBreakdown?.holdoutScore !== undefined)).toBe(true);
  }, 30000);

  it("pauses, retries failures, cancels while preserving completions, deletes linked records, and preserves approved profiles", async () => {
    const store = new TuningStore(dbName());
    const run = await store.createTuningRun(quickSettings());
    expect((await store.loadTuningRun(run.tuningRunId))!.reports).toHaveLength(0);
    const first = (await store.nextQueuedMatch(run.tuningRunId))!
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

  it("prevents duplicate approvals, persists approved profiles independently, and uses selected experimental baselines", async () => {
    const name = dbName();
    let store = new TuningStore(name);
    const run = await store.createTuningRun(quickSettings());
    const firstSnap = (await store.loadTuningRun(run.tuningRunId))!;
    const sourceCandidate = firstSnap.candidates[1];
    const sourceProfile = firstSnap.profiles.find(p => p.profileId === sourceCandidate.profileId)!;

    const approved = await store.approveCandidate(run.tuningRunId, sourceCandidate.candidateId);
    const duplicate = await store.approveCandidate(run.tuningRunId, sourceCandidate.candidateId);
    expect(duplicate.profileId).toBe(approved.profileId);
    expect((await store.listApprovedExperimentalProfiles()).filter(p => p.experimentalApproval.sourceCandidateId === sourceCandidate.candidateId)).toHaveLength(1);
    expect(approved.experimentalApproval.sourceTuningRunId).toBe(run.tuningRunId);
    expect(approved.experimentalApproval.parentOrBaselineProfileId).toBe(run.baselineProfileId);
    expect(approved.experimentalApproval.evaluationWeights).toEqual(sourceProfile.weights);

    store.close();
    store = new TuningStore(name);
    expect((await store.listApprovedExperimentalProfiles()).map(p => p.profileId)).toContain(approved.profileId);

    await store.deleteTuningRun(run.tuningRunId);
    expect(await store.loadTuningRun(run.tuningRunId)).toBeNull();
    expect((await store.listApprovedExperimentalProfiles()).map(p => p.profileId)).toContain(approved.profileId);

    const experimentalSettings = quickSettings();
    experimentalSettings.baselineProfileId = approved.profileId;
    const confirmation = await store.createTuningRun(experimentalSettings);
    const confirmationSnap = (await store.loadTuningRun(confirmation.tuningRunId))!;
    expect(confirmationSnap.run.baselineProfileId).toBe(approved.profileId);
    expect(confirmationSnap.profiles.find(p => p.profileId === approved.profileId)?.weights).toEqual(approved.weights);
    expect(confirmationSnap.candidates[0].profileId).toBe(approved.profileId);
    expect(confirmationSnap.matches.some(m => m.greenProfileId === approved.profileId || m.blueProfileId === approved.profileId)).toBe(true);
    expect((await store.getProfile("production-baseline-v1"))!.source).toBe("production");

    const files = await store.exportTuningRun(confirmation.tuningRunId);
    expect(files.find(f => f.name === "tuning_run_metadata.json")!.content).toContain(approved.profileId);
    expect(files.find(f => f.name === "tuner_config.json")!.content).toContain("selectedBaselineProfileId");
    expect(files.find(f => f.name === "promotion_report.md")!.content).toContain("No candidate is automatically promoted");
  });

  it("rejects missing or unapproved selected baseline profile ids", async () => {
    const store = new TuningStore(dbName());
    const missing = quickSettings();
    missing.baselineProfileId = "missing-experimental-profile";
    await expect(store.createTuningRun(missing)).rejects.toThrow("Selected baseline profile missing-experimental-profile was not found");

    const run = await store.createTuningRun(quickSettings());
    const candidateProfileId = (await store.loadTuningRun(run.tuningRunId))!.candidates[1].profileId;
    const unapproved = quickSettings();
    unapproved.baselineProfileId = candidateProfileId;
    await expect(store.createTuningRun(unapproved)).rejects.toThrow("is not an approved experimental profile");
  });

});
