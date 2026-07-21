import { acceptanceTuningSettings, type PromotionReport, type TuningCandidate, type TuningMatch } from "../../simulator/tuning.ts";
import { analyzeBaselineChampionDiagnostics, baselineDiagnosticsExportFiles, TuningStore, type TuningRunRecord, type TuningSnapshot } from "../src/tuning-store.ts";

const stamp = "2026-01-01T00:00:00.000Z";
function candidate(id:string, profileId:string, score:number, generation=1, mutationSummary=["materialStep: 1 -> 2"]): TuningCandidate { return { candidateId:id, tuningRunId:"run", profileId, generation, parentCandidateIds:[], mutationSummary, rank:null, score, wins:0, losses:0, draws:0, baselineScore:0, leagueScore:score, mirrorPenalty:0, repetitionPenalty:0, diversityPenalty:0, instabilityPenalty:0, replayFailurePenalty:0, promoted:false, eliminated:false, createdAt:stamp, updatedAt:stamp }; }
function snap(id:string, opts: { status?: any; baseScore?: number; candScore?: number; baselineChampion?: boolean; candWins?: number; candLosses?: number; validation?: number; holdout?: number; openings?: string[]; mut?: string[]; gens?: number[] } = {}): TuningSnapshot {
  const settings = { ...acceptanceTuningSettings(), name:`Run ${id}`, openingSuite: opts.openings ?? ["C1-B1","K1-L1","D3-E3","J3-I3"], mutationSettings:{...acceptanceTuningSettings().mutationSettings, mutationRate:.5, mutationMagnitude:.2} };
  const base = candidate(`${id}-base`, settings.baselineProfileId, opts.baseScore ?? 10, 0); base.tuningRunId=id;
  const mut = candidate(`${id}-mut`, `${id}-profile`, opts.candScore ?? 5, 1, opts.mut ?? ["materialStep: 1 -> 2"]); mut.tuningRunId=id; mut.wins=(opts.candWins??0)+2;
  const candidates = [base, mut, ...(opts.gens??[]).map((score,g)=>{ const c=candidate(`${id}-g${g}`,`${id}-p${g}`,score,g); c.tuningRunId=id; return c; })];
  const matches: TuningMatch[] = [];
  for (let i=0;i<(opts.candWins??0);i++) matches.push({ matchId:`${id}-w${i}`, tuningRunId:id, generation:1, candidateAProfileId:mut.profileId, candidateBProfileId:base.profileId, greenProfileId:mut.profileId, blueProfileId:base.profileId, opening:settings.openingSuite[0], mirroredOpening:null, seed:i, searchDepth:settings.searchDepth, fixture:"training", result:"green", plies:10, drawReason:null, diagnostics:{}, replayOk:true, status:"completed", completedAt:stamp });
  for (let i=0;i<(opts.candLosses??1);i++) matches.push({ matchId:`${id}-l${i}`, tuningRunId:id, generation:1, candidateAProfileId:mut.profileId, candidateBProfileId:base.profileId, greenProfileId:mut.profileId, blueProfileId:base.profileId, opening:settings.openingSuite[0], mirroredOpening:null, seed:10+i, searchDepth:settings.searchDepth, fixture:"training", result:"blue", plies:10, drawReason:null, diagnostics:{}, replayOk:true, status:"completed", completedAt:stamp });
  const report: PromotionReport = { reportId:`rep-${id}`, tuningRunId:id, candidateId:mut.candidateId, profileId:mut.profileId, recommendation: opts.baselineChampion===false ? "continue testing" : "no improvement found", interpretation:"baseline remains strongest", eligible:false, safeguards:{}, summary:{ validationScore: opts.validation ?? 1, holdoutScore: opts.holdout ?? 1 }, createdAt:stamp };
  const run: TuningRunRecord = { ...settings, tuningRunId:id, createdAt:stamp, updatedAt:stamp, status: opts.status ?? "completed", currentGeneration:1, currentPhase:"complete", totalMatches:matches.length, completedMatches:matches.length, failedMatches:0, bestCandidateId: opts.baselineChampion===false?mut.candidateId:base.candidateId, overallChampionCandidateId: opts.baselineChampion===false?mut.candidateId:base.candidateId, overallChampionProfileId: opts.baselineChampion===false?mut.profileId:base.profileId, overallChampionGeneration: opts.baselineChampion===false?1:0, overallChampionIsSelectedBaseline: opts.baselineChampion!==false, finalGenerationBestCandidateId:mut.candidateId, selectedBaselineProfileId:base.profileId, promotionCandidateId:null, currentWorkerState:"idle", currentMatchId:null, activeStartedAt:null, activeMs:0, completedAt:stamp, schemaVersion:1, tunerVersion:"test" };
  return { run, profiles:[], candidates, matches, generations:[], reports:[report] };
}

describe("Phase 6.5 baseline champion diagnostics", () => {
  it("filters completed runs, diagnoses repeated baseline wins, and summarizes openings/mutations/trends/jobs", () => {
    const report = analyzeBaselineChampionDiagnostics([snap("a"), snap("b", { mut:["materialStep: 1 -> 3","mobilityStep: 2 -> 1"], gens:[1,2,2] }), snap("x", { status:"running" })]);
    expect(report.summary.completedRunsAnalyzed).toBe(2);
    expect(report.summary.baselineChampionRuns).toBe(2);
    expect(report.openingAnalysis.warning).toContain("concentrated");
    expect(report.mutationPatternAnalysis.frequentWeights.map(w=>w.weight)).toContain("materialStep");
    expect(report.trendAnalysis.perRun[0].generationScores.generation0).not.toBeUndefined();
    expect(report.suggestedJobs).toHaveLength(3);
    expect(report.safety).toEqual({ noAutoStart:true, noAutoPromotion:true, queueRemainsPaused:true });
  });
  it("detects candidates that only beat peers and validation/holdout blocking", () => {
    const peer = analyzeBaselineChampionDiagnostics([snap("p", { candWins:0, candLosses:2 })]);
    expect(peer.baselineVsCandidate[0].bestCandidateOnlyBeatPeers).toBe(true);
    const blocked = analyzeBaselineChampionDiagnostics([snap("v", { candWins:2, candLosses:0, validation:-1, holdout:-1 })]);
    expect(blocked.conclusion.category).toBe("validation_or_holdout_blocking");
  });
  it("exports JSON and Markdown with parity for core sections", () => {
    const report = analyzeBaselineChampionDiagnostics([snap("e")]);
    const files = baselineDiagnosticsExportFiles(report);
    expect(JSON.parse(files.find(f=>f.name.endsWith(".json"))!.content).conclusion.category).toBe(report.conclusion.category);
    const md = files.find(f=>f.name.endsWith(".md"))!.content;
    for (const section of ["Per-run table", "Baseline-vs-candidate analysis", "Opening analysis", "Mutation-pattern analysis", "Trend analysis", "Suggested next jobs"]) expect(md).toContain(section);
  });
  it("adds suggested jobs without auto-start after imported backup-like data can be analyzed", async () => {
    const store = new TuningStore(`diag-${Date.now()}-${Math.random()}`);
    const report = analyzeBaselineChampionDiagnostics([snap("i")]);
    const added = await store.addBaselineDiagnosticJobsToQueue(report);
    const state = await store.getQueueState();
    expect(added.length).toBe(3);
    expect(state.autoRunEnabled).toBe(false);
    expect(state.activeQueueItemId).toBeNull();
    await store.close();
  });
});
