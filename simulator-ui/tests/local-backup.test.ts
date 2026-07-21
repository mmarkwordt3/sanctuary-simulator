import { describe, expect, it } from "bun:test";
import { productionEvaluationProfile } from "../../simulator/evaluation-profiles.ts";
import { acceptanceTuningSettings, type TuningCandidate, type TuningMatch } from "../../simulator/tuning.ts";
import { analyzeTuningHistoryForPlanner, LOCAL_BACKUP_FORMAT, LOCAL_BACKUP_SCHEMA_VERSION, TuningStore, type LocalBackup, type TuningRunRecord } from "../src/tuning-store.ts";
import { installIndexedDbShim } from "./indexeddb-shim.ts";

installIndexedDbShim();
const dbName = () => `backup-${Date.now()}-${Math.random()}`;
const stamp = "2026-01-01T00:00:00.000Z";

function makeBackup(overrides: Partial<LocalBackup> = {}): LocalBackup {
  const baseline = productionEvaluationProfile(stamp);
  const approved = { ...baseline, profileId:"approved-home", name:"Approved home baseline", source:"promotion" as const, promoted:true, experimentalApproval:{ sourceTuningRunId:"run-a", sourceCandidateId:"cand-a", approvedAt:stamp, parentOrBaselineProfileId:baseline.profileId, evaluationWeights:baseline.weights, status:"approved-experimental" as const } };
  const settings = acceptanceTuningSettings();
  const run: TuningRunRecord = { ...settings, tuningRunId:"run-a", name:"Imported complete", baselineProfileId:approved.profileId, selectedBaselineProfileId:approved.profileId, createdAt:stamp, updatedAt:stamp, status:"completed", currentGeneration:0, currentPhase:"complete", totalMatches:99, completedMatches:0, failedMatches:0, bestCandidateId:"cand-a", overallChampionCandidateId:"cand-a", overallChampionProfileId:approved.profileId, overallChampionGeneration:0, overallChampionIsSelectedBaseline:false, finalGenerationBestCandidateId:"cand-a", promotionCandidateId:null, currentWorkerState:"running", currentMatchId:"match-a", activeStartedAt:stamp, activeMs:0, completedAt:stamp, schemaVersion:5, tunerVersion:"test" };
  const candidate: TuningCandidate = { candidateId:"cand-a", tuningRunId:"run-a", profileId:approved.profileId, generation:0, parentCandidateIds:[], mutationSummary:[], rank:1, score:10, wins:1, losses:0, draws:0, baselineScore:1, leagueScore:10, mirrorPenalty:0, repetitionPenalty:0, diversityPenalty:0, instabilityPenalty:0, replayFailurePenalty:0, promoted:false, eliminated:false, createdAt:stamp, updatedAt:stamp };
  const match: TuningMatch = { matchId:"match-a", tuningRunId:"run-a", generation:0, candidateAProfileId:approved.profileId, candidateBProfileId:baseline.profileId, greenProfileId:approved.profileId, blueProfileId:baseline.profileId, opening:"C1-B1", mirroredOpening:null, seed:1, searchDepth:1, fixture:"training", result:"green", plies:12, drawReason:null, diagnostics:{}, replayOk:true, status:"completed", completedAt:stamp };
  const stores: any = Object.fromEntries(["experiments","gameJobs","completedGames","experimentAnalyses","analysisFlags","followUpProposals","evaluationProfiles","tuningRuns","tuningCandidates","tuningMatches","tuningGenerations","promotionReports","tuningQueue","tuningQueueState","tuningQueueExports"].map(s=>[s,[]]));
  stores.evaluationProfiles = [baseline, approved]; stores.tuningRuns = [run]; stores.tuningCandidates = [candidate]; stores.tuningMatches = [match]; stores.tuningGenerations = [{ generationKey:"run-a-generation-0", tuningRunId:"run-a", generation:0, status:"completed", candidateIds:["cand-a"], matchIds:["match-a"], championCandidateId:"cand-a", summary:{}, createdAt:stamp, updatedAt:stamp }];
  stores.promotionReports = [{ reportId:"report-a", tuningRunId:"run-a", candidateId:"cand-a", profileId:approved.profileId, recommendation:"continue testing", interpretation:"test", eligible:false, safeguards:{}, summary:{}, createdAt:stamp }];
  stores.tuningQueue = [{ queueItemId:"queue-a", runName:"Phase 5 imported", baselineProfileId:approved.profileId, settings, status:"running", tuningRunId:"run-a", createdAt:stamp, startedAt:stamp, completedAt:null, errorMessage:null, autoExportStatus:"succeeded", summary:null }];
  stores.tuningQueueState = [{ stateId:"singleton", autoRunEnabled:true, pauseAfterCurrentMatch:false, pauseAfterCurrentRun:false, activeQueueItemId:"queue-a", updatedAt:stamp, message:"old" }];
  stores.tuningQueueExports = [{ recordId:"export-a", queueItemId:"queue-a", tuningRunId:"run-a", kind:"full-tuning-export", filename:"run-a.zip", files:[], createdAt:stamp }];
  stores.followUpProposals = [{ proposalId:"proposal-a", analysisId:"analysis-a", experimentId:"exp-a", title:"Planner proposal", rationale:[], proposedSettings:{}, createdAt:stamp }];
  return { format:LOCAL_BACKUP_FORMAT, schemaVersion:LOCAL_BACKUP_SCHEMA_VERSION, createdAt:stamp, exportedAt:stamp, app:{ dbName:"test", dbSchemaVersion:5, tunerVersion:"test" }, stores, ...overrides } as LocalBackup;
}

describe("Phase 6 local backup and restore", () => {
  it("validates previews and rejects malformed or future backups", () => {
    const store = new TuningStore(dbName());
    const preview = store.previewLocalBackup(makeBackup());
    expect(preview.approvedProfileCount).toBe(1); expect(preview.tuningRunCount).toBe(1); expect(preview.queueItemCount).toBe(1); expect(preview.matchRecordCount).toBe(1); expect(preview.plannerReportCount).toBeGreaterThan(0);
    expect(() => store.previewLocalBackup({ nope:true })).toThrow("Backup format");
    expect(() => store.previewLocalBackup(makeBackup({ schemaVersion: LOCAL_BACKUP_SCHEMA_VERSION + 1 }))).toThrow("newer");
  });

  it("replace import writes all stores, pauses imported work, reconciles counts, preserves approved profiles, and leaves planner/recommendations unchanged", async () => {
    const store = new TuningStore(dbName());
    await store.importLocalBackupReplace(makeBackup());
    const exported = await store.exportLocalBackup();
    expect(exported.stores.evaluationProfiles.length).toBe(2); expect(exported.stores.tuningRuns.length).toBe(1); expect(exported.stores.tuningMatches.length).toBe(1); expect(exported.stores.tuningQueue.length).toBe(1); expect(exported.stores.tuningQueueExports.length).toBe(1); expect(exported.stores.followUpProposals.length).toBe(1);
    expect((await store.listApprovedExperimentalProfiles())[0].profileId).toBe("approved-home");
    const snap = await store.loadTuningRun("run-a");
    expect(snap?.run.completedMatches).toBe(1); expect(snap?.run.totalMatches).toBe(1); expect(snap?.run.promotionCandidateId).toBeNull(); expect(snap?.candidates[0].promoted).toBe(false);
    const queue = (await store.listQueueItems())[0]; expect(queue.status).not.toBe("running"); expect((await store.getQueueState()).autoRunEnabled).toBe(false); expect(await store.nextQueuedItem()).toBeNull();
    const report = await store.analyzeTuningPlanner("approved-home"); expect(report.analyzedRuns).toHaveLength(1); expect(report.baselineSource).toBe("approved"); expect(analyzeTuningHistoryForPlanner([snap!]).mode).toBe("stop_no_clear_next_step");
  });
});
