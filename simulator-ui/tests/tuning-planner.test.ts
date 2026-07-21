import { describe, expect, it } from "bun:test";
import { acceptanceTuningSettings, type PromotionReport, type TuningCandidate } from "../../simulator/tuning.ts";
import { analyzeTuningHistoryForPlanner, plannerReportExportFiles, TuningStore, type TuningSnapshot } from "../src/tuning-store.ts";
import { installIndexedDbShim } from "./indexeddb-shim.ts";

installIndexedDbShim();
const dbName = () => `planner-${Date.now()}-${Math.random()}`;
function candidate(id: string, profileId: string, score: number, generation = 1): TuningCandidate { return { candidateId:id, tuningRunId:"run", profileId, generation, parentCandidateIds:[], mutationSummary:["mobility: +1"], rank:null, score, wins:0, losses:0, draws:0, baselineScore:0, leagueScore:score, mirrorPenalty:0, repetitionPenalty:0, diversityPenalty:0, instabilityPenalty:0, replayFailurePenalty:0, promoted:false, eliminated:false, createdAt:"2026-01-01T00:00:00.000Z", updatedAt:"2026-01-01T00:00:00.000Z"}; }
function snap(id: string, opts: { baselineWins?: boolean; bestScore?: number; baseScore?: number; openings?: string[]; failed?: number; unresolved?: boolean; manual?: boolean; status?: any } = {}): TuningSnapshot {
  const settings = acceptanceTuningSettings(); settings.openingSuite = opts.openings ?? ["C1-B1","K1-L1","D3-E3","J3-I3"];
  const base = candidate(`${id}-base`, settings.baselineProfileId, opts.baseScore ?? 10); base.tuningRunId = id;
  const mut = candidate(`${id}-mut`, `${id}-profile`, opts.bestScore ?? 4); mut.tuningRunId = id; mut.scoreBreakdown = { validationScore: opts.manual ? 2 : 0, holdoutScore: opts.manual ? 2 : 0 };
  const champion = opts.baselineWins ?? true ? base : mut;
  const reports: PromotionReport[] = opts.manual ? [{ reportId:`report-${id}`, tuningRunId:id, candidateId:mut.candidateId, profileId:mut.profileId, recommendation:"eligible for manual promotion", interpretation:"eligible for manual promotion", eligible:true, safeguards:{}, summary:{}, createdAt:"2026-01-01T00:00:00.000Z" }] : [{ reportId:`report-${id}`, tuningRunId:id, candidateId:champion.candidateId, profileId:champion.profileId, recommendation:champion===base?"no improvement found":"continue testing", interpretation:champion===base?"baseline remains strongest":"eligible for more confirmation", eligible:false, safeguards:{}, summary:{}, createdAt:"2026-01-01T00:00:00.000Z" }];
  const matches:any[] = [{ matchId:`m-${id}`, tuningRunId:id, status:opts.unresolved?"queued":"completed", fixture:"training", opening:settings.openingSuite[0] }];
  return { run:{ ...settings, tuningRunId:id, createdAt:`2026-01-0${id.slice(-1)}T00:00:00.000Z`, updatedAt:"2026-01-01T00:00:00.000Z", status:opts.status ?? "completed", currentGeneration:1, currentPhase:opts.status === "completed" ? "complete" : "training", totalMatches:1, completedMatches:opts.unresolved?0:1, failedMatches:opts.failed ?? 0, bestCandidateId:champion.candidateId, overallChampionCandidateId:champion.candidateId, overallChampionProfileId:champion.profileId, overallChampionGeneration:1, overallChampionIsSelectedBaseline:champion===base, finalGenerationBestCandidateId:mut.candidateId, selectedBaselineProfileId:settings.baselineProfileId, promotionCandidateId:opts.manual?mut.candidateId:null, currentWorkerState:"idle", currentMatchId:null, activeStartedAt:null, activeMs:0, completedAt:"2026-01-01T00:00:00.000Z", schemaVersion:1, tunerVersion:"test" }, profiles:[], candidates:[base, mut], matches, generations:[], reports } as any;
}

describe("phase 5 automated tuning planner", () => {
  it("detects repeated no-improvement same-opening runs and proposes opening expansion", () => {
    const r = analyzeTuningHistoryForPlanner([snap("r1"), snap("r2")]);
    expect(["opening_expansion","broad_search"]).toContain(r.mode);
    expect(r.warnings.join(" ")).toContain("same four-opening suite");
    expect(r.proposedJobs[0].openingSuite).toContain("E1-F1");
  });
  it("detects eligible manual-review candidate and blocks further tuning proposal", () => {
    const r = analyzeTuningHistoryForPlanner([snap("r1", { manual:true, baselineWins:false, bestScore:20 })]);
    expect(r.mode).toBe("manual_review_required");
    expect(r.proposedJobs).toHaveLength(0);
  });
  it("detects close candidate and proposes confirmation or narrow refinement", () => {
    const r = analyzeTuningHistoryForPlanner([snap("r1", { baseScore:10, bestScore:9, openings:["A","B"] }), snap("r2", { baseScore:8, bestScore:7, openings:["C","D"] })]);
    expect(["confirmation","narrow_refinement"]).toContain(r.mode);
  });
  it("refuses aggressive proposal when runs are unresolved or failed", () => {
    const r = analyzeTuningHistoryForPlanner([snap("r1", { unresolved:true }), snap("r2", { failed:1, status:"failed" })]);
    expect(r.mode).toBe("stop_no_clear_next_step");
    expect(r.proposedJobs).toHaveLength(0);
  });
  it("generated jobs include all required settings and add to Phase 4 queue without auto-start", async () => {
    const store = new TuningStore(dbName());
    const report = analyzeTuningHistoryForPlanner([snap("r1"), snap("r2")]);
    expect(report.proposedJobs[0]).toMatchObject({ baselineProfileId:"production-baseline-v1", candidateCount:8, searchDepth:2, seedCount:4, mutationRate:0.4, eliteCount:2, parentSelection:"rank", maxPlies:60, noProgressLimit:24, mirroredOpeningsRequired:true, candidateVsBaseline:true, compactPeer:true, autoPauseAfterGeneration:false });
    const items = await store.addPlannerJobsToQueue(report);
    expect(items).toHaveLength(1);
    expect((await store.listQueueItems())[0].status).toBe("queued");
    expect((await store.getQueueState()).autoRunEnabled).toBe(false);
  });
  it("planner report export includes analyzed runs, mode, rationale, warnings, and proposed jobs", () => {
    const report = analyzeTuningHistoryForPlanner([snap("r1"), snap("r2")]);
    const json = plannerReportExportFiles(report).find(f=>f.name.endsWith(".json"))!.content;
    expect(json).toContain("analyzedRuns"); expect(json).toContain("mode"); expect(json).toContain("rationale"); expect(json).toContain("warnings"); expect(json).toContain("proposedJobs");
  });
});
