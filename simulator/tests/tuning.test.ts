import { describe, expect, it } from "vitest";
import { createInitialState } from "../../src/game/setup.ts";
import { diagnosticBreakdown } from "../agents.ts";
import { LOCKED_WEIGHT_KEYS, productionEvaluationProfile, validateEvaluationProfile } from "../evaluation-profiles.ts";
import { acceptanceTuningSettings, generateCandidates, mutateProfile, promotionEligibility, scheduleGenerationMatches, scoreCandidates, type TuningCandidate, type TuningMatch } from "../tuning.ts";

function candidate(id: string, profileId = id): TuningCandidate {
  return { candidateId: id, tuningRunId: "run", profileId, generation: 0, parentCandidateIds: [], mutationSummary: [], rank: null, score: 0, wins: 0, losses: 0, draws: 0, baselineScore: 0, leagueScore: 0, mirrorPenalty: 0, repetitionPenalty: 0, diversityPenalty: 0, instabilityPenalty: 0, replayFailurePenalty: 0, promoted: false, eliminated: false, createdAt: "", updatedAt: "" };
}
function match(profileId: string, result: "green"|"blue"|"draw", extras: Partial<TuningMatch> = {}): TuningMatch {
  return { matchId: `m-${Math.random()}`, tuningRunId: "run", generation: 0, candidateAProfileId: profileId, candidateBProfileId: "production-baseline-v1", greenProfileId: profileId, blueProfileId: "production-baseline-v1", opening: "C1-B1", mirroredOpening: null, seed: 1, searchDepth: 1, fixture: "training", result, plies: 10, drawReason: null, diagnostics: {}, replayOk: true, status: "completed", ...extras };
}

describe("Phase 3 evolutionary tuning", () => {
  it("baseline profile reproduces current evaluator behavior", () => {
    const state = createInitialState();
    const baseline = productionEvaluationProfile();
    expect(diagnosticBreakdown(state, "green").total).toBe(diagnosticBreakdown(state, "green", { evaluationProfile: baseline }).total);
  });
  it("custom profile changes evaluation output predictably", () => {
    const baseline = productionEvaluationProfile();
    const custom = validateEvaluationProfile({ ...baseline, profileId: "custom", weights: { ...baseline.weights, firstOpenGate: baseline.weights.firstOpenGate + 500 } });
    const initial = createInitialState();
    const open = { ...initial, walls: { west: false, east: true } };
    expect(diagnosticBreakdown(open, "green", { evaluationProfile: custom }).gateProgress).toBeGreaterThan(diagnosticBreakdown(open, "green", { evaluationProfile: baseline }).gateProgress);
  });
  it("profile validation rejects invalid values", () => {
    const baseline = productionEvaluationProfile();
    expect(() => validateEvaluationProfile({ ...baseline, weights: { ...baseline.weights, repeatedPositionFirst: 10 } })).toThrow(/nonPositive/);
    expect(() => validateEvaluationProfile({ ...baseline, weights: { ...baseline.weights, materialStep: Number.NaN } })).toThrow(/finite/);
  });
  it("mutation is deterministic and locked weights do not mutate", () => {
    const baseline = productionEvaluationProfile();
    const settings = acceptanceTuningSettings().mutationSettings;
    const a = mutateProfile(baseline, 123, 0, 1, settings).profile;
    const b = mutateProfile(baseline, 123, 0, 1, settings).profile;
    expect(a.weights).toEqual(b.weights);
    for (const key of LOCKED_WEIGHT_KEYS) expect(a.weights[key]).toBe(baseline.weights[key]);
  });
  it("mutation respects bounds and sign constraints", () => {
    const baseline = productionEvaluationProfile();
    const mutated = mutateProfile(baseline, 9, 0, 2, { seed: 9, mutationRate: 1, mutationMagnitude: 3, eliteCount: 1, parentSelection: "rank" }).profile;
    expect(mutated.weights.terminalWin).toBeGreaterThan(0);
    expect(mutated.weights.repeatedPositionFirst).toBeLessThanOrEqual(0);
    expect(mutated.weights.extractionImpossible).toBeLessThanOrEqual(0);
  });
  it("candidate generation is deterministic, creates generation 0, and prevents duplicate IDs", () => {
    const settings = acceptanceTuningSettings();
    const a = generateCandidates("run", productionEvaluationProfile(), settings, 0);
    const b = generateCandidates("run", productionEvaluationProfile(), settings, 0);
    expect(a.profiles.map(p => p.weights)).toEqual(b.profiles.map(p => p.weights));
    expect(new Set(a.profiles.map(p => p.profileId)).size).toBe(a.profiles.length);
    expect(a.candidates[0].mutationSummary[0]).toContain("baseline");
  });
  it("different tuning seeds generate different candidate profiles", () => {
    const a = acceptanceTuningSettings();
    const b = acceptanceTuningSettings(); b.mutationSettings.seed += 1;
    expect(generateCandidates("a", productionEvaluationProfile(), a, 0).profiles[1].weights).not.toEqual(generateCandidates("b", productionEvaluationProfile(), b, 0).profiles[1].weights);
  });
  it("match schedule is deterministic and covers both colors, mirrors, and seeds", () => {
    const settings = acceptanceTuningSettings();
    const candidates = generateCandidates("run", productionEvaluationProfile(), settings, 0).candidates;
    const a = scheduleGenerationMatches("run", 0, candidates, settings);
    const b = scheduleGenerationMatches("run", 0, candidates, settings);
    expect(a.map(m => m.matchId)).toEqual(b.map(m => m.matchId));
    expect(a.some(m => m.greenProfileId === candidates[0].profileId)).toBe(true);
    expect(a.some(m => m.blueProfileId === candidates[0].profileId)).toBe(true);
    expect(new Set(a.map(m => m.seed)).size).toBeGreaterThanOrEqual(settings.seedSet.length);
    expect(a.some(m => m.opening === "C1-B1")).toBe(true);
    expect(a.some(m => m.opening === "K1-L1")).toBe(true);
  });
  it("candidate scoring applies baseline, mirror/color, repetition, low-diversity, and holdout-style penalties deterministically", () => {
    const c = candidate("c", "p");
    const rows = [match("p", "green"), match("p", "draw", { drawReason: "threefold-repetition" }), match("p", "blue", { greenProfileId: "production-baseline-v1", blueProfileId: "p" })];
    const scored = scoreCandidates([c], rows)[0];
    expect(scored.wins).toBe(2);
    expect(scored.draws).toBe(1);
    expect(scored.baselineScore).toBeGreaterThan(0);
    expect(scored.repetitionPenalty).toBeGreaterThan(0);
    expect(scored.rank).toBe(1);
  });
  it("ranking is stable, elite lineage can be persisted, and generation transition descends from prior champion", () => {
    const ranked = scoreCandidates([candidate("b","pb"), candidate("a","pa")], [match("pa", "green"), match("pb", "draw")]);
    expect(ranked.map(c => c.candidateId)).toEqual(["a", "b"]);
    const settings = acceptanceTuningSettings();
    const next = generateCandidates("run", productionEvaluationProfile(), settings, 1, ranked);
    expect(next.candidates[0].parentCandidateIds).toEqual(["a"]);
  });
  it("promotion safeguards block replay and illegal failures and keep approved profile separate", () => {
    const c = { ...candidate("c", "p"), score: 10, baselineScore: 1 };
    const rows = [match("p", "green", { replayOk: false, diagnostics: { illegalMoves: 1 } })];
    const report = promotionEligibility(c, rows);
    expect(report.eligible).toBe(false);
    expect(report.safeguards.zeroReplayFailures).toBe(false);
    const baseline = productionEvaluationProfile();
    const promoted = validateEvaluationProfile({ ...baseline, profileId: "promoted-copy", source: "promotion", promoted: true, parentProfileIds: ["p"] });
    expect(promoted.profileId).not.toBe(baseline.profileId);
  });
});

describe("promotion recommendation evidence thresholds", () => {
  function phaseRows(profileId: string, validation: Array<"win"|"loss"|"draw">, holdout: Array<"win"|"loss"|"draw">): TuningMatch[] {
    const toResult = (outcome: "win"|"loss"|"draw") => outcome === "win" ? "green" : outcome === "loss" ? "blue" : "draw";
    return [
      ...validation.map((outcome, i) => match(profileId, toResult(outcome), { matchId: `v-${i}`, fixture: "validation" })),
      ...holdout.map((outcome, i) => match(profileId, toResult(outcome), { matchId: `h-${i}`, fixture: "holdout" })),
    ];
  }
  function promotable(profileId = "p") { return { ...candidate("c", profileId), score: 12, baselineScore: 1, mirrorPenalty: 0, instabilityPenalty: 0 }; }

  it("allows manual promotion only with positive validation and positive holdout", () => {
    const report = promotionEligibility(promotable(), phaseRows("p", ["win"], ["win"]));
    expect(report.recommendation).toBe("eligible for manual promotion");
    expect(report.summary.validationEvidence).toBe("positive");
    expect(report.summary.holdoutEvidence).toBe("positive");
  });

  it("continues testing for neutral validation and neutral holdout", () => {
    const report = promotionEligibility(promotable(), phaseRows("p", ["draw"], ["draw"]));
    expect(report.recommendation).toBe("continue testing");
    expect(report.summary.reason).toMatch(/Validation evidence is not positive/);
  });

  it("continues testing for positive validation but neutral holdout", () => {
    const report = promotionEligibility(promotable(), phaseRows("p", ["win"], ["draw"]));
    expect(report.recommendation).toBe("continue testing");
    expect(report.summary.reason).toMatch(/Holdout evidence is not positive/);
  });

  it("blocks negative validation or negative holdout", () => {
    expect(promotionEligibility(promotable(), phaseRows("p", ["loss"], ["win"])).recommendation).not.toBe("eligible for manual promotion");
    expect(promotionEligibility(promotable(), phaseRows("p", ["win"], ["loss"])).recommendation).not.toBe("eligible for manual promotion");
  });

  it("blocks baseline regression and unresolved validation or holdout", () => {
    expect(promotionEligibility({ ...promotable(), baselineScore: -1 }, phaseRows("p", ["win"], ["win"])).recommendation).not.toBe("eligible for manual promotion");
    expect(promotionEligibility(promotable(), phaseRows("p", [], ["win"])).recommendation).not.toBe("eligible for manual promotion");
    expect(promotionEligibility(promotable(), phaseRows("p", ["win"], [])).recommendation).not.toBe("eligible for manual promotion");
  });
});
