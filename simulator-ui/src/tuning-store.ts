import { fromCoord } from "../../src/game/coords.ts";
import { createInitialState } from "../../src/game/setup.ts";
import type { Move } from "../../src/game/types.ts";
import { legalMovesForState, describeMove } from "../../simulator/agents.ts";
import { PRODUCTION_PROFILE_ID, productionEvaluationProfile, validateEvaluationProfile, type EvaluationProfile } from "../../simulator/evaluation-profiles.ts";
import {
  acceptanceTuningSettings,
  buildPromotionReport,
  generateCandidates,
  promotionEligibility,
  scheduleGenerationMatches,
  scoreCandidates,
  tuningExportFiles,
  TUNER_VERSION,
  type PromotionReport,
  type TuningCandidate,
  type TuningGeneration,
  type TuningMatch,
  type TuningRunSettings,
  type TuningStatus,
} from "../../simulator/tuning.ts";
import { playExperimentGame } from "./simulation-runner.ts";
import type { ExportFile } from "./exporters.ts";
import { EXPERIMENT_DB_NAME, EXPERIMENT_SCHEMA_VERSION } from "./experiments.ts";

export type TuningPhase = "training" | "validation" | "holdout" | "complete";
export interface TuningRunRecord extends TuningRunSettings {
  tuningRunId: string;
  createdAt: string;
  updatedAt: string;
  status: TuningStatus;
  currentGeneration: number;
  currentPhase: TuningPhase;
  totalMatches: number;
  completedMatches: number;
  failedMatches: number;
  bestCandidateId: string | null;
  overallChampionCandidateId: string | null;
  overallChampionProfileId: string | null;
  overallChampionGeneration: number | null;
  overallChampionIsSelectedBaseline: boolean;
  finalGenerationBestCandidateId: string | null;
  selectedBaselineProfileId: string | null;
  promotionCandidateId: string | null;
  currentWorkerState: "idle" | "running" | "interrupted";
  currentMatchId: string | null;
  activeStartedAt: string | null;
  activeMs: number;
  completedAt?: string | null;
  schemaVersion: number;
  tunerVersion: string;
}

export interface TuningSnapshot { run: TuningRunRecord; profiles: EvaluationProfile[]; candidates: TuningCandidate[]; matches: TuningMatch[]; generations: TuningGeneration[]; reports: PromotionReport[]; }

export interface ApprovedExperimentalProfileMetadata { sourceTuningRunId: string; sourceCandidateId: string; approvedAt: string; parentOrBaselineProfileId: string; evaluationWeights: EvaluationProfile["weights"]; status: "approved-experimental"; }
export type ApprovedEvaluationProfile = EvaluationProfile & { experimentalApproval: ApprovedExperimentalProfileMetadata };

const STORES = ["evaluationProfiles", "tuningRuns", "tuningCandidates", "tuningMatches", "tuningGenerations", "promotionReports"];
function now() { return new Date().toISOString(); }
function id(prefix: string) { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }
function generationKey(tuningRunId: string, generation: number) { return `${tuningRunId}-generation-${generation}`; }

function openDb(name = EXPERIMENT_DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, EXPERIMENT_SCHEMA_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const ensure = (store: string, keyPath: string, indexes: Array<[string, string | string[]]> = []) => {
        if (!((db as any).objectStoreNames?.contains?.(store) ?? (db as any).stores?.has?.(store))) {
          const created = db.createObjectStore(store, { keyPath });
          for (const [indexName, key] of indexes) created.createIndex(indexName, key as string);
        }
      };
      ensure("experiments", "experimentId", [["status", "status"]]);
      ensure("gameJobs", "jobId", [["experimentId", "experimentId"], ["experimentId_status", ["experimentId", "status"]], ["experimentId_ordinal", ["experimentId", "ordinal"]]]);
      ensure("completedGames", "gameId", [["experimentId", "experimentId"], ["experimentId_winner", ["experimentId", "winner"]], ["experimentId_opening", ["experimentId", "opening"]]]);
      ensure("experimentAnalyses", "analysisId", [["experimentId", "experimentId"]]);
      ensure("analysisFlags", "flagId", [["analysisId", "analysisId"], ["experimentId", "experimentId"]]);
      ensure("followUpProposals", "proposalId", [["analysisId", "analysisId"], ["experimentId", "experimentId"]]);
      ensure("evaluationProfiles", "profileId", [["source", "source"], ["promoted", "promoted"]]);
      ensure("tuningRuns", "tuningRunId", [["status", "status"], ["baselineProfileId", "baselineProfileId"]]);
      ensure("tuningCandidates", "candidateId", [["tuningRunId", "tuningRunId"], ["profileId", "profileId"], ["tuningRunId_generation", ["tuningRunId", "generation"]]]);
      ensure("tuningMatches", "matchId", [["tuningRunId", "tuningRunId"], ["status", "status"], ["tuningRunId_status", ["tuningRunId", "status"]], ["tuningRunId_generation", ["tuningRunId", "generation"]], ["candidate_pair", ["candidateAProfileId", "candidateBProfileId"]], ["opening", "opening"], ["seed", "seed"]]);
      ensure("tuningGenerations", "generationKey", [["tuningRunId", "tuningRunId"], ["generation", "generation"]]);
      ensure("promotionReports", "reportId", [["tuningRunId", "tuningRunId"], ["profileId", "profileId"]]);
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}
function txDone(tx: IDBTransaction, body: (tx: IDBTransaction) => void) { return new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); body(tx); }); }
function get<T>(db: IDBDatabase, store: string, key: IDBValidKey) { return new Promise<T | undefined>((resolve, reject) => { const r = db.transaction(store).objectStore(store).get(key); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
function getAll<T>(db: IDBDatabase, store: string) { return new Promise<T[]>((resolve, reject) => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }

export function openingPrefix(label: string): Move[] {
  const initial = createInitialState();
  const moves = legalMovesForState(initial);
  const simple = label.trim();
  const found = moves.find((m) => `${fromCoord(initial.pieces.find((p) => p.id === m.pieceId) ?? m.to)}-${fromCoord(m.to)}` === simple || describeMove(m).endsWith(simple));
  return found ? [found] : [];
}

export class TuningStore {
  dbp: Promise<IDBDatabase>;
  constructor(name = EXPERIMENT_DB_NAME) { this.dbp = openDb(name); }
  async db() { return this.dbp; }
  async close() { (await this.db()).close(); }

  async createTuningRun(settings: TuningRunSettings = acceptanceTuningSettings()): Promise<TuningRunRecord> {
    if (!settings.candidateVsBaseline && !settings.candidateVsCandidate) throw new Error("Tuning run would create zero matches.");
    const createdAt = now();
    const tuningRunId = id("tune");
    const baseline = await this.resolveBaselineProfile(settings.baselineProfileId, createdAt);
    const settingsWithBaseline = { ...settings, baselineProfileId: baseline.profileId };
    const { profiles, candidates } = generateCandidates(tuningRunId, baseline, settingsWithBaseline, 0);
    const matches = scheduleGenerationMatches(tuningRunId, 0, candidates, settingsWithBaseline).map((m) => ({ ...m, fixture: "training" as const }));
    if (!matches.length) throw new Error("Tuning run would create zero matches.");
    const generation: TuningGeneration & { generationKey: string } = { generationKey: generationKey(tuningRunId, 0), tuningRunId, generation: 0, status: "queued", candidateIds: candidates.map((c) => c.candidateId), matchIds: matches.map((m) => m.matchId), championCandidateId: null, summary: {}, createdAt, updatedAt: createdAt };
    const run: TuningRunRecord = { ...settingsWithBaseline, tuningRunId, createdAt, updatedAt: createdAt, status: "queued", currentGeneration: 0, currentPhase: "training", totalMatches: matches.length, completedMatches: 0, failedMatches: 0, bestCandidateId: null, overallChampionCandidateId: null, overallChampionProfileId: null, overallChampionGeneration: null, overallChampionIsSelectedBaseline: false, finalGenerationBestCandidateId: null, selectedBaselineProfileId: baseline.profileId, promotionCandidateId: null, currentWorkerState: "idle", currentMatchId: null, activeStartedAt: null, activeMs: 0, schemaVersion: EXPERIMENT_SCHEMA_VERSION, tunerVersion: TUNER_VERSION };
    const db = await this.db();
    await txDone(db.transaction(STORES, "readwrite"), (tx) => {
      tx.objectStore("evaluationProfiles").put(baseline);
      for (const p of profiles) tx.objectStore("evaluationProfiles").put(p);
      tx.objectStore("tuningRuns").put(run);
      for (const c of candidates) tx.objectStore("tuningCandidates").put(c);
      for (const m of matches) tx.objectStore("tuningMatches").put(m);
      tx.objectStore("tuningGenerations").put(generation);
    });
    return run;
  }

  async listApprovedExperimentalProfiles(): Promise<ApprovedEvaluationProfile[]> {
    const profiles = await getAll<EvaluationProfile & { experimentalApproval?: ApprovedExperimentalProfileMetadata }>(await this.db(), "evaluationProfiles");
    return profiles.filter((p): p is ApprovedEvaluationProfile => p.source === "promotion" && p.promoted === true && p.experimentalApproval?.status === "approved-experimental").sort((a, b) => b.experimentalApproval.approvedAt.localeCompare(a.experimentalApproval.approvedAt));
  }
  async getProfile(profileId: string) { return get<EvaluationProfile>(await this.db(), "evaluationProfiles", profileId); }
  private async resolveBaselineProfile(profileId: string, stamp = now()): Promise<EvaluationProfile> {
    if (!profileId || profileId === PRODUCTION_PROFILE_ID) return productionEvaluationProfile(stamp);
    const profile = await this.getProfile(profileId);
    if (!profile) throw new Error(`Selected baseline profile ${profileId} was not found. Choose an available baseline profile.`);
    if (!(profile.source === "promotion" && profile.promoted)) throw new Error(`Selected baseline profile ${profileId} is not an approved experimental profile.`);
    return profile;
  }

  async listTuningRuns() { return (await getAll<TuningRunRecord>(await this.db(), "tuningRuns")).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  async loadTuningRun(tuningRunId: string): Promise<TuningSnapshot | null> {
    const db = await this.db();
    const run = await get<TuningRunRecord>(db, "tuningRuns", tuningRunId);
    if (!run) return null;
    const [profiles, candidates, matches, generations, reports] = await Promise.all([
      getAll<EvaluationProfile>(db, "evaluationProfiles"), getAll<TuningCandidate>(db, "tuningCandidates"), getAll<TuningMatch>(db, "tuningMatches"), getAll<TuningGeneration & { generationKey: string }>(db, "tuningGenerations"), getAll<PromotionReport>(db, "promotionReports"),
    ]);
    const profileIds = new Set(candidates.filter((c) => c.tuningRunId === tuningRunId).map((c) => c.profileId));
    profileIds.add(run.baselineProfileId);
    return { run, profiles: profiles.filter((p) => profileIds.has(p.profileId)), candidates: candidates.filter((c) => c.tuningRunId === tuningRunId), matches: matches.filter((m) => m.tuningRunId === tuningRunId), generations: generations.filter((g) => g.tuningRunId === tuningRunId), reports: reports.filter((r) => r.tuningRunId === tuningRunId) };
  }
  async nextQueuedMatch(tuningRunId: string) { const snap = await this.loadTuningRun(tuningRunId); return snap?.matches.filter((m) => m.status === "queued" && m.fixture === snap.run.currentPhase).sort((a, b) => a.generation - b.generation || a.matchId.localeCompare(b.matchId))[0] ?? null; }
  async resumeTuningRun(tuningRunId: string) { return this.setRunStatus(tuningRunId, "running"); }
  async pauseTuningRun(tuningRunId: string) { return this.setRunStatus(tuningRunId, "paused", true); }
  async cancelTuningRun(tuningRunId: string) {
    const snap = await this.loadTuningRun(tuningRunId); if (!snap) return;
    const db = await this.db(); const stamp = now();
    await txDone(db.transaction(["tuningRuns", "tuningMatches"], "readwrite"), (tx) => {
      for (const m of snap.matches.filter((m) => m.status === "queued" || m.status === "running")) tx.objectStore("tuningMatches").put({ ...m, status: "cancelled", completedAt: stamp });
      tx.objectStore("tuningRuns").put({ ...snap.run, status: "cancelled", updatedAt: stamp, currentWorkerState: "idle", currentMatchId: null });
    });
  }
  async retryFailedMatches(tuningRunId: string) {
    const snap = await this.loadTuningRun(tuningRunId); if (!snap) return;
    const db = await this.db(); const stamp = now();
    await txDone(db.transaction(["tuningRuns", "tuningMatches"], "readwrite"), (tx) => {
      for (const m of snap.matches.filter((m) => m.status === "failed")) tx.objectStore("tuningMatches").put({ ...m, status: "queued", failureMessage: null, startedAt: null, completedAt: null });
      tx.objectStore("tuningRuns").put({ ...snap.run, status: "queued", failedMatches: 0, updatedAt: stamp });
    });
  }
  async recoverInterruptedTuningRuns() {
    const runs = await this.listTuningRuns();
    for (const run of runs.filter((r) => r.status === "running")) await this.recoverRun(run.tuningRunId);
  }
  private async recoverRun(tuningRunId: string) {
    const snap = await this.loadTuningRun(tuningRunId); if (!snap) return;
    const db = await this.db(); const stamp = now();
    await txDone(db.transaction(["tuningRuns", "tuningMatches"], "readwrite"), (tx) => {
      for (const m of snap.matches.filter((m) => m.status === "running")) tx.objectStore("tuningMatches").put({ ...m, status: "queued", startedAt: null });
      tx.objectStore("tuningRuns").put({ ...snap.run, status: "paused", currentWorkerState: "interrupted", currentMatchId: null, updatedAt: stamp });
    });
  }
  async deleteTuningRun(tuningRunId: string) {
    const snap = await this.loadTuningRun(tuningRunId); if (!snap || snap.run.status === "running") return;
    const db = await this.db();
    await txDone(db.transaction(STORES, "readwrite"), (tx) => {
      tx.objectStore("tuningRuns").delete(tuningRunId);
      for (const c of snap.candidates) tx.objectStore("tuningCandidates").delete(c.candidateId);
      for (const m of snap.matches) tx.objectStore("tuningMatches").delete(m.matchId);
      for (const g of snap.generations as Array<TuningGeneration & { generationKey: string }>) tx.objectStore("tuningGenerations").delete(g.generationKey ?? generationKey(g.tuningRunId, g.generation));
      for (const r of snap.reports) tx.objectStore("promotionReports").delete(r.reportId);
      for (const p of snap.profiles.filter((p) => p.source !== "promotion" && p.profileId !== snap.run.baselineProfileId && p.profileId !== PRODUCTION_PROFILE_ID)) tx.objectStore("evaluationProfiles").delete(p.profileId);
    });
  }
  async exportTuningRun(tuningRunId: string): Promise<ExportFile[]> { const snap = await this.loadTuningRun(tuningRunId); if (!snap) throw new Error("Tuning run not found"); return tuningExportFiles(snap.run, snap.profiles, snap.candidates, snap.matches, snap.generations, snap.reports[0] ?? null) as ExportFile[]; }
  async approveCandidate(tuningRunId: string, candidateId: string) {
    const snap = await this.loadTuningRun(tuningRunId); if (!snap) throw new Error("Tuning run not found");
    const candidate = snap.candidates.find((c) => c.candidateId === candidateId); if (!candidate) throw new Error("Candidate not found");
    const sourceProfile = snap.profiles.find((p) => p.profileId === candidate.profileId); if (!sourceProfile) throw new Error("Profile not found");
    const existing = (await this.listApprovedExperimentalProfiles()).find((p) => p.experimentalApproval.sourceTuningRunId === tuningRunId && p.experimentalApproval.sourceCandidateId === candidateId);
    if (existing) return existing;
    const stamp = now(); const promoted = validateEvaluationProfile({ ...sourceProfile, profileId: `approved-${candidate.profileId}-${Date.now().toString(36)}`, name: `${sourceProfile.name} approved experimental`, source: "promotion", parentProfileIds: [snap.run.baselineProfileId, sourceProfile.profileId], promoted: true, createdAt: stamp, updatedAt: stamp, notes: `${sourceProfile.notes}\nApproved from ${tuningRunId} candidate ${candidateId} at ${stamp}.`, experimentalApproval: { sourceTuningRunId: tuningRunId, sourceCandidateId: candidateId, approvedAt: stamp, parentOrBaselineProfileId: snap.run.baselineProfileId, evaluationWeights: sourceProfile.weights, status: "approved-experimental" } } as EvaluationProfile & { experimentalApproval: ApprovedExperimentalProfileMetadata }) as ApprovedEvaluationProfile;
    const report = snap.reports.find((r) => r.candidateId === candidateId) ?? promotionEligibility(candidate, snap.matches);
    const db = await this.db();
    await txDone(db.transaction(["evaluationProfiles", "tuningCandidates", "promotionReports"], "readwrite"), (tx) => {
      tx.objectStore("evaluationProfiles").put(promoted);
      tx.objectStore("tuningCandidates").put({ ...candidate, promoted: true, updatedAt: stamp });
      tx.objectStore("promotionReports").put({ ...report, approvedAt: stamp, rejectedAt: null });
    });
    return promoted;
  }
  async rejectCandidate(tuningRunId: string, candidateId: string) {
    const snap = await this.loadTuningRun(tuningRunId); if (!snap) return;
    const candidate = snap.candidates.find((c) => c.candidateId === candidateId); if (!candidate) return;
    const report = snap.reports.find((r) => r.candidateId === candidateId) ?? promotionEligibility(candidate, snap.matches);
    const stamp = now(); const db = await this.db();
    await txDone(db.transaction(["tuningCandidates", "promotionReports"], "readwrite"), (tx) => { tx.objectStore("tuningCandidates").put({ ...candidate, eliminated: true, updatedAt: stamp }); tx.objectStore("promotionReports").put({ ...report, rejectedAt: stamp }); });
  }

  async markMatchRunning(tuningRunId: string, matchId: string) {
    const snap = await this.loadTuningRun(tuningRunId); if (!snap) return false;
    const match = snap.matches.find((m) => m.matchId === matchId); if (!match || match.status !== "queued" || snap.run.status === "paused" || snap.run.status === "cancelled") return false;
    const db = await this.db(); const stamp = now();
    await txDone(db.transaction(["tuningRuns", "tuningMatches"], "readwrite"), (tx) => { tx.objectStore("tuningMatches").put({ ...match, status: "running", startedAt: stamp }); tx.objectStore("tuningRuns").put({ ...snap.run, status: "running", currentWorkerState: "running", currentMatchId: matchId, activeStartedAt: snap.run.activeStartedAt ?? stamp, updatedAt: stamp }); });
    return true;
  }

  async completeMatch(tuningRunId: string, matchId: string, result: Pick<TuningMatch, "result" | "plies" | "drawReason" | "diagnostics" | "replayOk">) {
    const snap = await this.loadTuningRun(tuningRunId); if (!snap) throw new Error("Tuning run not found");
    const match = snap.matches.find((m) => m.matchId === matchId); if (!match || match.status === "completed") return;
    const completedAt = now();
    const updatedMatch: TuningMatch = { ...match, ...result, status: "completed", completedAt };
    const matches = snap.matches.map((m) => m.matchId === matchId ? updatedMatch : m);
    const generationMatches = matches.filter((m) => m.generation === match.generation && m.fixture === "training");
    let candidates = snap.candidates;
    let generations = snap.generations as Array<TuningGeneration & { generationKey: string }>;
    let run = { ...snap.run, completedMatches: snap.run.completedMatches + 1, currentMatchId: null, updatedAt: completedAt, currentWorkerState: "idle" as const };
    if (run.activeStartedAt) { run.activeMs += Math.max(0, Date.parse(completedAt) - Date.parse(run.activeStartedAt)); run.activeStartedAt = null; }
    const generationDone = generationMatches.length > 0 && generationMatches.every((m) => ["completed", "failed", "cancelled"].includes(m.status));
    let scheduledFinals = false;
    const stores = [...STORES] as string[];
    const db = await this.db();
    await txDone(db.transaction(stores, "readwrite"), (tx) => {
      tx.objectStore("tuningMatches").put(updatedMatch);
      if (generationDone && match.fixture === "training") {
        const currentGenCandidates = candidates.filter((c) => c.generation === match.generation && c.tuningRunId === tuningRunId);
        const ranked = scoreCandidates(currentGenCandidates, generationMatches, run.scoringSettings, run.baselineProfileId);
        for (const c of ranked) tx.objectStore("tuningCandidates").put(c);
        candidates = candidates.map((c) => ranked.find((r) => r.candidateId === c.candidateId) ?? c);
        const champion = ranked[0] ?? null;
        const gen = generations.find((g) => g.generation === match.generation);
        if (gen) tx.objectStore("tuningGenerations").put({ ...gen, status: "completed", championCandidateId: champion?.candidateId ?? null, summary: { ranked: ranked.map((c) => ({ candidateId: c.candidateId, score: c.score, rank: c.rank })) }, updatedAt: completedAt });
        run.bestCandidateId = champion?.candidateId ?? run.bestCandidateId;
        if (match.generation + 1 < run.generationsRequested) {
          const parents = ranked.slice(0, run.mutationSettings.eliteCount);
          const baseline = snap.profiles.find((p) => p.profileId === run.baselineProfileId) ?? productionEvaluationProfile();
          const parentProfiles = parents.map((parent) => snap.profiles.find((p) => p.profileId === parent.profileId)).filter((p): p is EvaluationProfile => !!p);
          const { profiles, candidates: nextCandidates } = generateCandidates(tuningRunId, baseline, run, match.generation + 1, parents, parentProfiles);
          const nextMatches = scheduleGenerationMatches(tuningRunId, match.generation + 1, nextCandidates, run).map((m) => ({ ...m, fixture: "training" as const }));
          for (const p of profiles) tx.objectStore("evaluationProfiles").put(p);
          for (const c of nextCandidates) tx.objectStore("tuningCandidates").put(c);
          for (const m of nextMatches) tx.objectStore("tuningMatches").put(m);
          tx.objectStore("tuningGenerations").put({ generationKey: generationKey(tuningRunId, match.generation + 1), tuningRunId, generation: match.generation + 1, status: "queued", candidateIds: nextCandidates.map((c) => c.candidateId), matchIds: nextMatches.map((m) => m.matchId), championCandidateId: null, summary: { parentCandidateIds: parents.map((p) => p.candidateId) }, createdAt: completedAt, updatedAt: completedAt });
          run.currentGeneration = match.generation + 1;
          run.totalMatches += nextMatches.length;
          run.status = run.autoPauseAfterGeneration ? "paused" : "queued";
        } else {
          const finalists = ranked.slice(0, Math.max(1, run.mutationSettings.eliteCount));
          const validation = scheduleFinalistMatches(tuningRunId, match.generation, finalists, run, "validation");
          const holdout = scheduleFinalistMatches(tuningRunId, match.generation, finalists, run, "holdout");
          for (const m of [...validation, ...holdout]) tx.objectStore("tuningMatches").put(m);
          run.totalMatches += validation.length + holdout.length;
          run.currentPhase = validation.length ? "validation" : holdout.length ? "holdout" : "complete";
          run.status = "queued";
          scheduledFinals = true;
        }
      }
      if (!scheduledFinals && match.fixture === "validation") {
        const validationDone = matches.filter((m) => m.fixture === "validation").every((m) => ["completed", "failed", "cancelled"].includes(m.status));
        if (validationDone) { run.currentPhase = "holdout"; run.status = "queued"; }
      }
      if (!scheduledFinals && match.fixture === "holdout") {
        const holdoutDone = matches.filter((m) => m.fixture === "holdout").every((m) => ["completed", "failed", "cancelled"].includes(m.status));
        if (holdoutDone) {
          const finalGeneration = Math.max(...candidates.map((c) => c.generation));
          const finalCandidates = candidates.filter((c) => c.generation === finalGeneration);
          const scoredFinalists = scoreCandidates(finalCandidates, matches.filter((m) => m.fixture !== "holdout"), run.scoringSettings, run.baselineProfileId);
          const withFinalPhaseScores = scoredFinalists.map((candidate) => {
            const related = matches.filter((m) => m.greenProfileId === candidate.profileId || m.blueProfileId === candidate.profileId);
            const phaseScore = (fixture: "validation" | "holdout") => related.filter((m) => m.fixture === fixture).reduce((sum, m) => sum + (m.result === "draw" ? 0 : (m.greenProfileId === candidate.profileId && m.result === "green") || (m.blueProfileId === candidate.profileId && m.result === "blue") ? 1 : -1), 0);
            return { ...candidate, scoreBreakdown: { ...(candidate.scoreBreakdown ?? {}), validationScore: phaseScore("validation"), holdoutScore: phaseScore("holdout") } };
          });
          for (const c of withFinalPhaseScores) tx.objectStore("tuningCandidates").put(c);
          candidates = candidates.map((c) => withFinalPhaseScores.find((s) => s.candidateId === c.candidateId) ?? c);
          const report = buildPromotionReport(run, candidates, matches);
          if (report) { tx.objectStore("promotionReports").put(report); run.bestCandidateId = report.overallChampionCandidateId ?? null; run.overallChampionCandidateId = report.overallChampionCandidateId ?? null; run.overallChampionProfileId = report.overallChampionProfileId ?? null; run.overallChampionGeneration = report.overallChampionGeneration ?? null; run.overallChampionIsSelectedBaseline = !!report.overallChampionIsSelectedBaseline; run.finalGenerationBestCandidateId = report.finalGenerationBestCandidateId ?? null; run.selectedBaselineProfileId = report.selectedBaselineProfileId ?? run.baselineProfileId; run.promotionCandidateId = report.promotionCandidateId ?? null; }
          run.status = "completed"; run.currentPhase = "complete"; run.completedAt = completedAt;
        }
      }
      tx.objectStore("tuningRuns").put(run);
    });
  }

  async failMatch(tuningRunId: string, matchId: string, failureMessage: string) {
    const snap = await this.loadTuningRun(tuningRunId); if (!snap) return;
    const match = snap.matches.find((m) => m.matchId === matchId); if (!match || match.status === "completed") return;
    const stamp = now(); const db = await this.db();
    await txDone(db.transaction(["tuningRuns", "tuningMatches"], "readwrite"), (tx) => { tx.objectStore("tuningMatches").put({ ...match, status: "failed", failureMessage, completedAt: stamp }); tx.objectStore("tuningRuns").put({ ...snap.run, failedMatches: snap.run.failedMatches + 1, currentMatchId: null, currentWorkerState: "idle", updatedAt: stamp }); });
  }

  private async setRunStatus(tuningRunId: string, status: TuningStatus, requeueRunning = false) {
    const snap = await this.loadTuningRun(tuningRunId); if (!snap) return;
    const db = await this.db(); const stamp = now();
    await txDone(db.transaction(["tuningRuns", "tuningMatches"], "readwrite"), (tx) => {
      if (requeueRunning) for (const m of snap.matches.filter((m) => m.status === "running")) tx.objectStore("tuningMatches").put({ ...m, status: "queued", startedAt: null });
      tx.objectStore("tuningRuns").put({ ...snap.run, status, currentWorkerState: status === "running" ? "running" : "idle", currentMatchId: null, updatedAt: stamp });
    });
  }
}

export function scheduleFinalistMatches(tuningRunId: string, generation: number, finalists: TuningCandidate[], settings: TuningRunSettings, fixture: "validation" | "holdout"): TuningMatch[] {
  const seedSet = fixture === "validation" ? settings.antiOverfitSettings.validationSeeds : settings.antiOverfitSettings.holdoutSeeds;
  const openings = fixture === "validation" ? settings.openingSuite.slice(0, 2) : settings.openingSuite.slice(-2);
  const matches: TuningMatch[] = [];
  for (const c of finalists) for (const seed of seedSet) for (const opening of openings) {
    const base = `${tuningRunId}-${fixture}-g${generation}-${c.candidateId}-${opening}-${seed}`;
    matches.push({ matchId: `${base}-gb`, tuningRunId, generation, candidateAProfileId: c.profileId, candidateBProfileId: settings.baselineProfileId, greenProfileId: c.profileId, blueProfileId: settings.baselineProfileId, opening, mirroredOpening: null, seed, searchDepth: settings.searchDepth, fixture, result: null, plies: 0, drawReason: null, diagnostics: {}, replayOk: false, status: "queued" });
    matches.push({ matchId: `${base}-bg`, tuningRunId, generation, candidateAProfileId: c.profileId, candidateBProfileId: settings.baselineProfileId, greenProfileId: settings.baselineProfileId, blueProfileId: c.profileId, opening, mirroredOpening: null, seed: seed + 500000, searchDepth: settings.searchDepth, fixture, result: null, plies: 0, drawReason: null, diagnostics: {}, replayOk: false, status: "queued" });
  }
  return matches;
}

export async function executePersistedTuningMatch(store: TuningStore, tuningRunId: string, match: TuningMatch) {
  const snap = await store.loadTuningRun(tuningRunId); if (!snap) throw new Error("Tuning run not found");
  const profiles = new Map(snap.profiles.map((p) => [p.profileId, p]));
  const prefix = openingPrefix(match.opening);
  const game = playExperimentGame({ id: 1, seed: match.seed, greenAgent: "search-alpha-beta-deterministic", blueAgent: "search-alpha-beta-deterministic", greenDiversity: 0, blueDiversity: 0, searchDepth: match.searchDepth, maxPlies: snap.run.maxPlies, noProgressPlyLimit: snap.run.noProgressPlyLimit, positionSampling: "none", positions: [], forcedPrefix: prefix, opening: match.opening, greenEvaluationProfile: profiles.get(match.greenProfileId), blueEvaluationProfile: profiles.get(match.blueProfileId), timeLimitMs: snap.run.timeLimitMs });
  await store.completeMatch(tuningRunId, match.matchId, { result: game.winner === "green" || game.winner === "blue" ? game.winner : "draw", plies: game.plies, drawReason: game.drawReason, replayOk: game.replayOk, diagnostics: { illegalMoves: game.metrics.illegalMoves, replayOk: game.replayOk, uniquePositionsVisited: game.repetitionDiagnostics.uniquePositionsVisited, repetitionDraw: game.repetitionDiagnostics.repetitionDraw, noProgressDraw: game.repetitionDiagnostics.noProgressDraw, first10: game.first10 } });
}
