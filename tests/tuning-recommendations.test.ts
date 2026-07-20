import { describe, expect, it } from "vitest";
import { productionEvaluationProfile } from "../simulator/evaluation-profiles.ts";
import { acceptanceTuningSettings, buildPromotionReport, promotionEligibility, selectCanonicalChampion, tuningExportFiles, type TuningCandidate, type TuningMatch } from "../simulator/tuning.ts";

const baseline = productionEvaluationProfile("2026-01-01T00:00:00.000Z");
const run = { ...acceptanceTuningSettings(), name: "Synthetic positive recommendation", baselineProfileId: baseline.profileId, generationsRequested: 2, antiOverfitSettings: { ...acceptanceTuningSettings().antiOverfitSettings, minSampleSize: 8, minValidationScore: 0, minHoldoutScore: 0 } };
const stamp = "2026-01-01T00:00:00.000Z";
const mkCandidate = (candidateId: string, profileId: string, generation: number, score: number): TuningCandidate => ({ candidateId, tuningRunId: "synthetic-positive", profileId, generation, parentCandidateIds: generation ? ["baseline-candidate"] : [], mutationSummary: profileId === baseline.profileId ? ["Exact baseline candidate retained for calibration."] : ["Synthetic test-only improvement."], rank: null, score, scoreBreakdown: { validationScore: profileId === baseline.profileId ? -4 : 4, holdoutScore: profileId === baseline.profileId ? -4 : 4 }, wins: profileId === baseline.profileId ? 0 : 8, losses: profileId === baseline.profileId ? 8 : 0, draws: 0, baselineScore: profileId === baseline.profileId ? 0 : 8, leagueScore: score, mirrorPenalty: 0, repetitionPenalty: 0, diversityPenalty: 0, instabilityPenalty: 0, replayFailurePenalty: 0, promoted: false, eliminated: false, createdAt: stamp, updatedAt: stamp });
const candidates = [mkCandidate("baseline-candidate", baseline.profileId, 0, 10), mkCandidate("positive-candidate", "synthetic-positive-profile", 1, 50)];
const mkMatch = (fixture: "validation"|"holdout", n: number, greenCandidate: boolean): TuningMatch => ({ matchId: `synthetic-${fixture}-${n}`, tuningRunId: "synthetic-positive", generation: 1, candidateAProfileId: "synthetic-positive-profile", candidateBProfileId: baseline.profileId, greenProfileId: greenCandidate ? "synthetic-positive-profile" : baseline.profileId, blueProfileId: greenCandidate ? baseline.profileId : "synthetic-positive-profile", opening: n % 2 ? "C1-B1" : "K1-L1", mirroredOpening: null, seed: 100 + n, searchDepth: 1, fixture, result: greenCandidate ? "green" : "blue", plies: 12, drawReason: null, diagnostics: { illegalMoves: 0 }, replayOk: true, status: "completed", completedAt: stamp });
const matches = [0,1,2,3].flatMap(i => [mkMatch("validation", i, i % 2 === 0), mkMatch("holdout", i, i % 2 === 1)]);

describe("positive Phase 3 / Phase 4 tuning recommendation smoke fixture", () => {
  it("marks a clearly superior candidate eligible while requiring manual review", () => {
    const report = promotionEligibility(candidates[1], matches, run.antiOverfitSettings, run.baselineProfileId);
    expect(report.eligible).toBe(true);
    expect(report.recommendation).toBe("eligible for manual promotion");
    expect(report.summary.validationScore).toBe(4);
    expect(report.summary.holdoutScore).toBe(4);
    expect(report.approvedAt).toBeUndefined();
  });

  it("selects the candidate as canonical champion and keeps baseline-retained runs as no improvement", () => {
    const selection = selectCanonicalChampion(run, candidates, matches);
    expect(selection.overallChampionCandidateId).toBe("positive-candidate");
    expect(selection.finalGenerationBestCandidateId).toBe("positive-candidate");
    expect(selection.overallChampionIsSelectedBaseline).toBe(false);
    expect(selection.promotionCandidateId).toBe("positive-candidate");

    const retained = buildPromotionReport(run, [candidates[0], { ...candidates[1], score: 5 }], matches)!;
    expect(retained.recommendation).toBe("no improvement found");
    expect(retained.overallChampionIsSelectedBaseline).toBe(true);
  });

  it("builds matching JSON and Markdown promotion exports from the canonical report", () => {
    const report = buildPromotionReport(run, candidates, matches)!;
    expect(report.recommendation).toBe("eligible for manual promotion");
    expect(report.eligible).toBe(true);
    expect(report.summary.recommendationReason).toContain("passed all safeguards");
    expect(report.approvedAt).toBeUndefined();
    const files = tuningExportFiles({ ...run, tuningRunId: "synthetic-positive" }, [baseline, { ...baseline, profileId: "synthetic-positive-profile", name: "Synthetic positive", source: "mutation", promoted: false }], candidates, matches, [], report);
    const json = JSON.parse(files.find(f => f.name === "promotion_report.json")!.content);
    const md = files.find(f => f.name === "promotion_report.md")!.content;
    expect(json.overallChampionCandidateId).toBe("positive-candidate");
    expect(json.finalGenerationBestCandidateId).toBe("positive-candidate");
    expect(json.selectedBaselineProfileId).toBe(baseline.profileId);
    expect(json.validationScore).toBe(4);
    expect(json.holdoutScore).toBe(4);
    expect(json.eligible).toBe(true);
    expect(md).toContain("Recommendation: eligible for manual promotion");
    expect(md).toContain("Validation score: 4");
    expect(md).toContain("Holdout score: 4");
    expect(md).toContain("No candidate is automatically promoted");
  });
});
