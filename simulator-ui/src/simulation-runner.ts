import { createInitialState } from "../../src/game/setup.ts";
import { applyMove } from "../../src/game/reducer.ts";
import { COLUMNS, fromCoord } from "../../src/game/coords.ts";
import type { GameState, Move } from "../../src/game/types.ts";
import {
  type AgentName,
  type DiversityLevel,
  type MoveRecord,
  legalMovesForState,
  positionKey,
  selectMoveDetailed,
  gateContainmentDiagnostic,
} from "../../simulator/agents.ts";
import { canonicalLabel } from "../../simulator/mirror.ts";
import { DEFAULT_SETTINGS, type BlueResponseMode, type OpeningSettings, type PositionSampling, type StandardSettings, type TargetedOpeningSettings } from "./config.ts";
import { jsonl, markdownSummary, toCsv, type ExportFile } from "./exporters.ts";
import type { EvaluationProfile } from "../../simulator/evaluation-profiles.ts";

export interface RunnerControl {
  isCancelled(): boolean;
  waitIfPaused(): Promise<void>;
  onProgress(progress: ProgressUpdate): void;
}

export interface ProgressUpdate {
  completedGames: number;
  totalGames: number;
  greenWins: number;
  blueWins: number;
  draws: number;
  replayFailures: number;
  currentOpening?: string;
}

export interface GameRecord {
  id: number;
  seed: number;
  greenAgent: AgentName;
  blueAgent: AgentName;
  winner: string | null;
  drawReason: "max-plies" | "maxPlies" | "cancelled" | "noLegalMove" | "threefold-repetition" | "no-progress" | null;
  plies: number;
  replayOk: boolean;
  moves: string[];
  first10: string;
  opening?: string;
  forcedGreenOpening?: string;
  forcedBlueReply?: string | null;
  blueResponseMode?: BlueResponseMode;
  actualBlueFirstMove?: string | null;
  greenOpeningLabel?: string;
  blueReplyLabel?: string | null;
  matchupId?: string;
  mirrorPairId?: string;
  requestedSearchDepth?: number;
  completedSearchDepth?: number;
  nodesSearched?: number;
  leafEvaluations?: number;
  alphaBetaCutoffs?: number;
  transpositionTableHits?: number;
  searchElapsedMs?: number;
  timedOut?: boolean;
  principalVariation?: string;
  firstPickupPlayer?: string;
  pickupPly?: number;
  extractionFailure?: boolean;
  carrierRouted?: boolean;
  gateContainmentDiagnostics: Array<Record<string, unknown>>;
  repetitionDiagnostics: RepetitionDiagnostics;
  selectedMoveDiagnostics: Array<Record<string, unknown>>;
  metrics: Metrics;
}

export interface RepetitionDiagnostics {
  uniquePositionsVisited: number;
  repeatedPositionsCount: number;
  maximumRepetitionCount: number;
  immediateReversals: number;
  twoPlyCycles: number;
  fourPlyCycles: number;
  noProgressPlies: number;
  longestNoProgressStreak: number;
  repetitionDraw: boolean;
  noProgressDraw: boolean;
  firstRepeatingCyclePly: number | null;
  drawReason: string | null;
}

export interface Metrics {
  sideGatesOpened: number;
  sanctuaryEntries: number;
  directG7PickupEntries: number;
  flagPickups: number;
  extractionFailures: number;
  successfulDepartures: number;
  ladenFlagBearerRoutings: number;
  homeVictories: number;
  illegalMoves: number;
  diversityChanges: number;
  diversityScoreLoss: number;
  gateOpenedWithEnemyCarrierInside: number;
  gateOpenedWithEnemyCarrierFlag: number;
  gateOpenImmediateEscapeRoutes: number;
  gateOpenReducedEscapeDistance: number;
  carrierContainmentDelta: number;
}

export interface RunResult {
  games: GameRecord[];
  positions: Array<Record<string, unknown>>;
  summary: ReturnType<typeof summarizeRecords>;
  metadata: Record<string, unknown>;
  openingRows: Array<Record<string, unknown>>;
  files: ExportFile[];
  cancelled: boolean;
}

const VERSION = "simulator-ui-v1";

export async function runStandard(settings: StandardSettings, control: RunnerControl): Promise<RunResult> {
  const games: GameRecord[] = [];
  const positions: Array<Record<string, unknown>> = [];
  for (let i = 0; i < settings.games; i++) {
    await control.waitIfPaused();
    if (control.isCancelled()) break;
    games.push(playExperimentGame({
      id: i + 1,
      seed: settings.seed + i,
      greenAgent: settings.greenAgent,
      blueAgent: settings.blueAgent,
      greenDiversity: settings.greenDiversity,
      blueDiversity: settings.blueDiversity,
      searchDepth: settings.searchDepth,
      maxPlies: settings.maxPlies,
      noProgressPlyLimit: settings.noProgressPlyLimit ?? 40,
      positionSampling: settings.positionSampling,
      positions,
    }));
    if (i % 2 === 0 || i === settings.games - 1) control.onProgress(progress(games, settings.games));
  }
  return finalize(games, positions, [], "standard", settings, control.isCancelled());
}


export interface TargetedOpeningOption { move: Move; label: string; replies: Array<{ move: Move; label: string }> }

export function targetedOpeningOptions(): TargetedOpeningOption[] {
  const initial = createInitialState();
  return legalMovesForState(initial).map((move) => {
    const after = applyMove(initial, move);
    return { move, label: moveLabel(initial, move), replies: after === initial ? [] : legalMovesForState(after).map((reply) => ({ move: reply, label: moveLabel(after, reply) })) };
  });
}

export function suspectedBlueFlagBearerPreset(): TargetedOpeningSettings {
  const options = targetedOpeningOptions();
  const selectedBlueRepliesByOpening: Record<string, string[]> = {};
  for (const opening of options) {
    selectedBlueRepliesByOpening[opening.label] = opening.replies.filter((r) => /Flag Bearer:G13-(E11|I11)|blue.*flagBearer/i.test(r.label)).filter((r) => /G13-(E11|I11)/.test(r.label)).map((r) => r.label);
  }
  return { ...DEFAULT_SETTINGS.targeted, blueResponseMode: "forced", selectedGreenOpenings: options.map((o) => o.label), selectedBlueRepliesByOpening };
}

export interface TargetedJob { opening: string; blueReply?: string; prefix: Move[]; matchupId: string; mirrorPairId: string; blueResponseMode: BlueResponseMode }

export function normalizeTargetedSettings(settings: TargetedOpeningSettings | (Omit<TargetedOpeningSettings, "blueResponseMode"> & { blueResponseMode?: BlueResponseMode })): TargetedOpeningSettings {
  const selectedBlueRepliesByOpening = settings.selectedBlueRepliesByOpening ?? {};
  const hasForcedReplies = Object.values(selectedBlueRepliesByOpening).some((replies) => replies.length > 0);
  return { ...settings, selectedBlueRepliesByOpening, blueResponseMode: settings.blueResponseMode ?? (hasForcedReplies ? "forced" : "automatic") };
}

export function targetedForcedPairingCount(settings: TargetedOpeningSettings): number {
  const normalized = normalizeTargetedSettings(settings);
  const selectedOpenings = new Set(normalized.selectedGreenOpenings);
  return targetedOpeningOptions()
    .filter((opening) => selectedOpenings.has(opening.label))
    .reduce((sum, opening) => sum + opening.replies.filter((reply) => (normalized.selectedBlueRepliesByOpening[opening.label] ?? []).includes(reply.label)).length, 0);
}

export function validateTargetedSettings(settings: TargetedOpeningSettings): string[] {
  const normalized = normalizeTargetedSettings(settings);
  const errors: string[] = [];
  if (normalized.selectedGreenOpenings.length === 0) errors.push("Select at least one Green opening.");
  if (normalized.blueResponseMode === "forced") {
    const options = new Map(targetedOpeningOptions().map((opening) => [opening.label, opening]));
    for (const label of normalized.selectedGreenOpenings) {
      const opening = options.get(label);
      const selectedLegalReplies = opening?.replies.filter((reply) => (normalized.selectedBlueRepliesByOpening[label] ?? []).includes(reply.label)) ?? [];
      if (selectedLegalReplies.length === 0) errors.push(`Select at least one Blue reply for ${label}.`);
    }
  }
  if (buildTargetedJobs(normalized).length === 0) errors.push("Targeted Opening Test would create zero jobs.");
  return [...new Set(errors)];
}

export function buildTargetedJobs(settings: TargetedOpeningSettings): TargetedJob[] {
  const normalized = normalizeTargetedSettings(settings);
  const options = targetedOpeningOptions();
  const selectedOpenings = new Set(normalized.selectedGreenOpenings);
  const jobs: TargetedJob[] = [];
  for (const opening of options) {
    if (!selectedOpenings.has(opening.label)) continue;
    if (normalized.blueResponseMode === "automatic") {
      jobs.push({ opening: opening.label, prefix: [opening.move], matchupId: `${opening.label}|automatic`, mirrorPairId: `${canonicalLabel(opening.label)}|automatic`, blueResponseMode: "automatic" });
      continue;
    }
    const selected = normalized.selectedBlueRepliesByOpening[opening.label] ?? [];
    for (const reply of opening.replies) {
      if (!selected.includes(reply.label)) continue;
      const matchupId = `${opening.label}|${reply.label}`;
      jobs.push({ opening: opening.label, blueReply: reply.label, prefix: [opening.move, reply.move], matchupId, mirrorPairId: `${canonicalLabel(opening.label)}|${canonicalLabel(reply.label)}`, blueResponseMode: "forced" });
    }
  }
  return jobs;
}

export async function runTargetedOpening(settings: TargetedOpeningSettings, control: RunnerControl): Promise<RunResult> {
  settings = normalizeTargetedSettings(settings);
  const validationErrors = validateTargetedSettings(settings);
  if (validationErrors.length) throw new Error(validationErrors.join(" "));
  const jobs = buildTargetedJobs(settings);
  const totalGames = jobs.length * settings.gamesPerMatchup;
  const games: GameRecord[] = [];
  const positions: Array<Record<string, unknown>> = [];
  let id = 1;
  for (const jobGroup of groupJobsByMirror(jobs)) {
    for (const job of jobGroup) for (let i = 0; i < settings.gamesPerMatchup; i++) {
      await control.waitIfPaused();
      if (control.isCancelled()) break;
      games.push(playExperimentGame({ id: id++, seed: settings.seed + games.length, greenAgent: settings.greenAgent, blueAgent: settings.blueAgent, greenDiversity: settings.greenDiversity, blueDiversity: settings.blueDiversity, searchDepth: settings.searchDepth, timeLimitMs: settings.timeLimitMs, maxPlies: settings.maxPlies, noProgressPlyLimit: settings.noProgressPlyLimit ?? 40, positionSampling: settings.positionSampling, positions, forcedPrefix: job.prefix, opening: job.opening, forcedGreenOpening: job.opening, forcedBlueReply: job.blueReply ?? null, blueResponseMode: job.blueResponseMode, matchupId: job.matchupId, mirrorPairId: job.mirrorPairId }));
      control.onProgress({ ...progress(games, totalGames), currentOpening: job.opening });
    }
    if (control.isCancelled()) break;
  }
  return finalize(games, positions, summarizeOpenings(games, settings as any), "targeted", settings, control.isCancelled());
}

export async function runOpening(settings: OpeningSettings, control: RunnerControl): Promise<RunResult> {
  const openings = legalMovesForState(createInitialState()).map((move) => ({ move, label: moveLabel(createInitialState(), move) }));
  const jobs: Array<{ opening: string; prefix: Move[]; blueReply?: string }> = [];
  for (const opening of openings) {
    const afterOpening = applyMove(createInitialState(), opening.move);
    if (settings.forceBlueReplies && afterOpening !== createInitialState()) {
      for (const reply of legalMovesForState(afterOpening)) jobs.push({ opening: opening.label, prefix: [opening.move, reply], blueReply: moveLabel(afterOpening, reply) });
    } else {
      jobs.push({ opening: opening.label, prefix: [opening.move] });
    }
  }
  const totalGames = jobs.length * settings.gamesPerOpening;
  const games: GameRecord[] = [];
  const positions: Array<Record<string, unknown>> = [];
  let id = 1;
  let pairIndex = 0;
  for (const jobGroup of groupJobsByMirror(jobs)) {
    for (const job of jobGroup) {
    for (let i = 0; i < settings.gamesPerOpening; i++) {
      await control.waitIfPaused();
      if (control.isCancelled()) break;
      games.push(playExperimentGame({
        id: id++,
        seed: settings.seed + pairIndex * settings.gamesPerOpening + i,
        greenAgent: settings.greenAgent,
        blueAgent: settings.blueAgent,
        greenDiversity: settings.greenDiversity,
        blueDiversity: settings.blueDiversity,
        searchDepth: settings.searchDepth,
        maxPlies: settings.maxPlies,
        noProgressPlyLimit: settings.noProgressPlyLimit ?? 40,
        positionSampling: settings.positionSampling,
        positions,
        forcedPrefix: job.prefix,
        opening: job.opening,
      }));
      control.onProgress({ ...progress(games, totalGames), currentOpening: job.opening });
    }
    if (control.isCancelled()) break;
    }
    pairIndex++;
    if (control.isCancelled()) break;
  }
  const openingRows = summarizeOpenings(games, settings);
  return finalize(games, positions, openingRows, "opening", settings, control.isCancelled());
}

function groupJobsByMirror<T extends { opening: string; blueReply?: string }>(jobs: T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const job of jobs) {
    const key = `${canonicalLabel(job.opening)}|${job.blueReply ? canonicalLabel(job.blueReply) : "normal-blue-response"}`;
    groups.set(key, [...(groups.get(key) ?? []), job]);
  }
  return [...groups.values()];
}

interface PlayArgs {
  id: number;
  seed: number;
  greenAgent: AgentName;
  blueAgent: AgentName;
  greenDiversity: DiversityLevel;
  blueDiversity: DiversityLevel;
  searchDepth: number;
  maxPlies: number;
  noProgressPlyLimit: number;
  positionSampling: PositionSampling;
  positions: Array<Record<string, unknown>>;
  forcedPrefix?: Move[];
  opening?: string;
  timeLimitMs?: number;
  forcedGreenOpening?: string;
  forcedBlueReply?: string | null;
  blueResponseMode?: BlueResponseMode;
  matchupId?: string;
  mirrorPairId?: string;
  greenEvaluationProfile?: EvaluationProfile;
  blueEvaluationProfile?: EvaluationProfile;
}

export function runForcedLineForRepetitionTest(forcedPrefix: Move[], maxPlies = 100, noProgressPlyLimit = 40): GameRecord {
  return playExperimentGame({
    id: 1,
    seed: 1,
    greenAgent: "random",
    blueAgent: "random",
    greenDiversity: 0,
    blueDiversity: 0,
    searchDepth: 1,
    maxPlies,
    noProgressPlyLimit,
    positionSampling: "none",
    positions: [],
    forcedPrefix,
  });
}

export function playExperimentGame(args: PlayArgs): GameRecord {
  let state = createInitialState();
  const seen = new Map<string, number>();
  seen.set(positionKey(state), 1);
  let previousMove: MoveRecord | null = null;
  const lastMoveByPiece = new Map<string, MoveRecord>();
  let noProgressPlies = 0;
  let longestNoProgressStreak = 0;
  let repeatedPositionsCount = 0;
  let maximumRepetitionCount = 1;
  let immediateReversals = 0;
  let twoPlyCycles = 0;
  let fourPlyCycles = 0;
  let firstRepeatingCyclePly: number | null = null;
  let drawReason: GameRecord["drawReason"] = null;
  const positionTimeline = [positionKey(state)];
  const selectedMoveDiagnostics: Array<Record<string, unknown>> = [];
  const moves: Move[] = [];
  const labels: string[] = [];
  let searchDiagnostics = { completedSearchDepth: 0, nodesSearched: 0, leafEvaluations: 0, alphaBetaCutoffs: 0, transpositionTableHits: 0, searchElapsedMs: 0, timedOut: false, principalVariation: "" };
  let firstPickupPlayer: string | undefined;
  let pickupPly: number | undefined;
  const metrics: Metrics = {
    sideGatesOpened: 0,
    sanctuaryEntries: 0,
    directG7PickupEntries: 0,
    flagPickups: 0,
    extractionFailures: 0,
    successfulDepartures: 0,
    ladenFlagBearerRoutings: 0,
    homeVictories: 0,
    illegalMoves: 0,
    diversityChanges: 0,
    diversityScoreLoss: 0,
    gateOpenedWithEnemyCarrierInside: 0,
    gateOpenedWithEnemyCarrierFlag: 0,
    gateOpenImmediateEscapeRoutes: 0,
    gateOpenReducedEscapeDistance: 0,
    carrierContainmentDelta: 0,
  };
  const gateDiagnostics: Array<Record<string, unknown>> = [];

  const recordRepetition = (progressed: boolean, reversed: boolean): boolean => {
    const nextKey = positionKey(state);
    const previousCount = seen.get(nextKey) ?? 0;
    noProgressPlies = progressed ? 0 : noProgressPlies + 1;
    longestNoProgressStreak = Math.max(longestNoProgressStreak, noProgressPlies);
    if (reversed) immediateReversals++;
    if (positionTimeline.length >= 2 && nextKey === positionTimeline[positionTimeline.length - 2]) { twoPlyCycles++; if (firstRepeatingCyclePly === null) firstRepeatingCyclePly = moves.length; }
    if (positionTimeline.length >= 4 && nextKey === positionTimeline[positionTimeline.length - 4]) { fourPlyCycles++; if (firstRepeatingCyclePly === null) firstRepeatingCyclePly = moves.length; }
    if (previousCount > 0) repeatedPositionsCount++;
    seen.set(nextKey, previousCount + 1);
    maximumRepetitionCount = Math.max(maximumRepetitionCount, previousCount + 1);
    positionTimeline.push(nextKey);
    selectedMoveDiagnostics.push({ ply: moves.length, move: labels[labels.length - 1], returnedToRecentPosition: previousCount > 0, repetitionCountAfterMove: previousCount + 1, reversedPreviousMove: reversed, nonProgressPenaltyApplied: progressed ? 0 : noProgressPlies * -18, repetitionPenaltyApplied: previousCount >= 2 ? -700 : previousCount === 1 ? -180 : 0 });
    if (!progressed && previousCount + 1 >= 3) { drawReason = "threefold-repetition"; return true; }
    if (noProgressPlies >= args.noProgressPlyLimit) { drawReason = "no-progress"; return true; }
    return false;
  };

  for (const forced of args.forcedPrefix ?? []) {
    const beforeCarrier = state.flag.carrierId;
    const reversed = isRunnerImmediateReversal(lastMoveByPiece.get(forced.pieceId) ?? null, forced, state);
    const applied = applyTrackedMove(state, forced, moves, labels, metrics, gateDiagnostics);
    if (!applied) { metrics.illegalMoves++; break; }
    previousMove = applied.previousMove;
    lastMoveByPiece.set(applied.previousMove.pieceId, applied.previousMove);
    state = applied.state;
    if (!beforeCarrier && state.flag.carrierId && !firstPickupPlayer) { firstPickupPlayer = previousMove.pieceId.startsWith("G") ? "green" : "blue"; pickupPly = moves.length; }
    if (recordRepetition(applied.meaningfulProgress, reversed)) break;
  }

  while (!drawReason && !state.winner && moves.length < args.maxPlies && metrics.illegalMoves === 0) {
    const agent = state.current === "green" ? args.greenAgent : args.blueAgent;
    const diversity = state.current === "green" ? args.greenDiversity : args.blueDiversity;
    const selection = selectMoveDetailed(state, agent, {
      seed: args.seed + moves.length * 7919 + (state.current === "green" ? 0 : 31337),
      recentPositions: seen,
      previousMove,
      searchDepth: args.searchDepth,
      diversity,
      timeLimitMs: args.timeLimitMs,
      currentNoProgressPlies: noProgressPlies,
      evaluationProfile: state.current === "green" ? args.greenEvaluationProfile : args.blueEvaluationProfile,
    });
    if (!selection.move) break;
    if (selection.diagnostics) {
      searchDiagnostics.completedSearchDepth = Math.max(searchDiagnostics.completedSearchDepth, selection.diagnostics.completedDepth);
      searchDiagnostics.nodesSearched += selection.diagnostics.nodesSearched;
      searchDiagnostics.leafEvaluations += selection.diagnostics.leafEvaluations;
      searchDiagnostics.alphaBetaCutoffs += selection.diagnostics.alphaBetaCutoffs;
      searchDiagnostics.transpositionTableHits += selection.diagnostics.transpositionTableHits;
      searchDiagnostics.searchElapsedMs += selection.diagnostics.elapsedMs;
      searchDiagnostics.timedOut ||= selection.diagnostics.timedOut;
      searchDiagnostics.principalVariation = selection.diagnostics.principalVariation.map((m) => moveLabel(state, m)).join(" ");
    }
    if (selection.diversityAffectedChoice) {
      metrics.diversityChanges++;
      metrics.diversityScoreLoss += selection.scoreLoss;
    }
    const beforeCarrier = state.flag.carrierId;
    const beforeScore = selection.candidates.find((c) => c.move === selection.move)?.breakdown.total ?? null;
    const reversed = isRunnerImmediateReversal(lastMoveByPiece.get(selection.move.pieceId) ?? previousMove, selection.move, state);
    const applied = applyTrackedMove(state, selection.move, moves, labels, metrics, gateDiagnostics);
    if (!applied) { metrics.illegalMoves++; break; }
    previousMove = applied.previousMove;
    lastMoveByPiece.set(applied.previousMove.pieceId, applied.previousMove);
    state = applied.state;
    if (!beforeCarrier && state.flag.carrierId && !firstPickupPlayer) { firstPickupPlayer = previousMove.pieceId.startsWith("G") ? "green" : "blue"; pickupPly = moves.length; }
    if (recordRepetition(applied.meaningfulProgress, reversed)) break;
    selectedMoveDiagnostics[selectedMoveDiagnostics.length - 1].objectiveProgressScoreDelta = beforeScore;
    if (args.positionSampling === "every-ply") args.positions.push(positionRecord(args.id, moves.length, state));
  }
  if (args.positionSampling === "final") args.positions.push(positionRecord(args.id, moves.length, state));
  drawReason = state.winner ? null : drawReason ?? (moves.length >= args.maxPlies ? "max-plies" : "noLegalMove");
  const repetitionDiagnostics: RepetitionDiagnostics = { uniquePositionsVisited: seen.size, repeatedPositionsCount, maximumRepetitionCount, immediateReversals, twoPlyCycles, fourPlyCycles, noProgressPlies, longestNoProgressStreak, repetitionDraw: String(drawReason) === "threefold-repetition", noProgressDraw: String(drawReason) === "no-progress", firstRepeatingCyclePly, drawReason };
  return {
    id: args.id,
    seed: args.seed,
    greenAgent: args.greenAgent,
    blueAgent: args.blueAgent,
    winner: state.winner,
    drawReason,
    plies: moves.length,
    replayOk: replayVerify(moves, state),
    moves: labels,
    first10: labels.slice(0, 10).join(" "),
    opening: args.opening ?? labels[0],
    forcedGreenOpening: args.forcedGreenOpening,
    forcedBlueReply: args.forcedBlueReply ?? null,
    blueResponseMode: args.blueResponseMode,
    actualBlueFirstMove: labels[1] ?? null,
    greenOpeningLabel: args.forcedGreenOpening,
    blueReplyLabel: args.forcedBlueReply ?? null,
    matchupId: args.matchupId,
    mirrorPairId: args.mirrorPairId,
    requestedSearchDepth: args.searchDepth,
    completedSearchDepth: searchDiagnostics.completedSearchDepth,
    nodesSearched: searchDiagnostics.nodesSearched,
    leafEvaluations: searchDiagnostics.leafEvaluations,
    alphaBetaCutoffs: searchDiagnostics.alphaBetaCutoffs,
    transpositionTableHits: searchDiagnostics.transpositionTableHits,
    searchElapsedMs: Number(searchDiagnostics.searchElapsedMs.toFixed(3)),
    timedOut: searchDiagnostics.timedOut,
    principalVariation: searchDiagnostics.principalVariation,
    firstPickupPlayer,
    pickupPly,
    extractionFailure: metrics.extractionFailures > 0,
    carrierRouted: metrics.ladenFlagBearerRoutings > 0,
    gateContainmentDiagnostics: gateDiagnostics,
    repetitionDiagnostics,
    selectedMoveDiagnostics,
    metrics,
  };
}

function applyTrackedMove(state: GameState, move: Move, moves: Move[], labels: string[], metrics: Metrics, gateDiagnostics: Array<Record<string, unknown>>) {
  const piece = state.pieces.find((p) => p.id === move.pieceId);
  if (!piece) return null;
  const beforeHistory = state.history.length;
  const beforeCarrier = state.flag.carrierId;
  const from = { col: piece.col, row: piece.row };
  const next = applyMove(state, move);
  if (next === state) return null;
  const events = next.history.slice(beforeHistory).join(" | ");
  if (/Wall removed/.test(events)) {
    metrics.sideGatesOpened++;
    const diagnostic = gateContainmentDiagnostic(state, next, piece.player);
    if (diagnostic) {
      metrics.gateOpenedWithEnemyCarrierInside += Number(diagnostic.gateOpenedWhileEnemyFlagBearerInside);
      metrics.gateOpenedWithEnemyCarrierFlag += Number(diagnostic.enemyFlagBearerCarryingFlag);
      metrics.gateOpenImmediateEscapeRoutes += Number(diagnostic.immediateLegalEscapeRouteCreated);
      metrics.gateOpenReducedEscapeDistance += Number(diagnostic.reducedEstimatedShortestRouteToSafety);
      metrics.carrierContainmentDelta += diagnostic.containmentDelta;
      gateDiagnostics.push({ ply: moves.length + 1, mover: piece.player, move: `${move.pieceId}:${fromCoord(from)}-${fromCoord(move.to)}`, ...diagnostic });
    }
  }
  if (/entered the Sanctuary/.test(events)) metrics.sanctuaryEntries++;
  if (/took the flag/.test(events)) {
    metrics.flagPickups++;
    if (!/entered the Sanctuary/.test(events)) metrics.directG7PickupEntries++;
  }
  if (/ran out of extraction turns/.test(events)) metrics.extractionFailures++;
  if (/departed the gate/.test(events)) metrics.successfulDepartures++;
  if (beforeCarrier && /Flag Bearer/.test(events) && /routed/.test(events)) metrics.ladenFlagBearerRoutings++;
  if (/wins/.test(events)) metrics.homeVictories++;
  moves.push(move);
  labels.push(`${move.pieceId}:${fromCoord(from)}-${fromCoord(move.to)}`);
  const meaningfulProgress = isMeaningfulProgressTransition(state, next, events);
  return { state: next, previousMove: { pieceId: move.pieceId, from, to: move.to }, meaningfulProgress };
}

const MEANINGFUL_PROGRESS_EVENT_PATTERN = /Wall removed|entered the Sanctuary|took the flag|ran out of extraction turns|departed the gate|routed|captured|promoted|demoted|wins/;

export function isMeaningfulProgressTransition(before: GameState, after: GameState, events = ""): boolean {
  if (before.winner !== after.winner) return true;
  if (before.extractionTurnsRemaining !== after.extractionTurnsRemaining) return true;
  if (before.forcedGateDeparture !== after.forcedGateDeparture) return true;
  if (before.walls.west !== after.walls.west || before.walls.east !== after.walls.east) return true;
  if (JSON.stringify(before.flag) !== JSON.stringify(after.flag)) return true;
  if (JSON.stringify(before.unladenSanctuary) !== JSON.stringify(after.unladenSanctuary)) return true;
  if (before.engineersRemoved !== after.engineersRemoved) return true;
  const beforePieces = new Map(before.pieces.map((p) => [p.id, p]));
  if (before.pieces.length !== after.pieces.length) return true;
  for (const piece of after.pieces) {
    const old = beforePieces.get(piece.id);
    if (!old || old.type !== piece.type || old.player !== piece.player) return true;
    const routedLikeMoveToHome = old.col !== piece.col || old.row !== piece.row;
    if (routedLikeMoveToHome && MEANINGFUL_PROGRESS_EVENT_PATTERN.test(events)) return true;
  }
  return MEANINGFUL_PROGRESS_EVENT_PATTERN.test(events);
}

function isRunnerImmediateReversal(previous: MoveRecord | null, move: Move, state: GameState): boolean {
  if (!previous || previous.pieceId !== move.pieceId) return false;
  const piece = state.pieces.find((p) => p.id === move.pieceId);
  return !!piece && previous.from.col === move.to.col && previous.from.row === move.to.row && previous.to.col === piece.col && previous.to.row === piece.row;
}

function moveLabel(state: GameState, move: Move): string {
  const piece = state.pieces.find((p) => p.id === move.pieceId)!;
  return `${move.pieceId}:${fromCoord(piece)}-${fromCoord(move.to)}`;
}

export function replayVerify(moves: Move[], expected: GameState): boolean {
  let state = createInitialState();
  for (const move of moves) {
    const next = applyMove(state, move);
    if (next === state) return false;
    state = next;
  }
  return JSON.stringify(state) === JSON.stringify(expected);
}

function positionRecord(gameId: number, ply: number, state: GameState) {
  return { gameId, ply, current: state.current, winner: state.winner, flag: state.flag, pieces: state.pieces };
}

function progress(games: GameRecord[], totalGames: number): ProgressUpdate {
  return {
    completedGames: games.length,
    totalGames,
    greenWins: games.filter((g) => g.winner === "green").length,
    blueWins: games.filter((g) => g.winner === "blue").length,
    draws: games.filter((g) => !g.winner).length,
    replayFailures: games.filter((g) => !g.replayOk).length,
  };
}

export function summarizeRecords(games: GameRecord[]) {
  const plies = games.map((g) => g.plies).sort((a, b) => a - b);
  const median = plies.length % 2 ? plies[Math.floor(plies.length / 2)] : (plies[plies.length / 2 - 1] + plies[plies.length / 2]) / 2;
  const metric = (key: keyof Metrics) => games.reduce((n, g) => n + Number(g.metrics[key]), 0);
  const diversityChanges = metric("diversityChanges");
  return {
    games: games.length,
    greenWins: games.filter((g) => g.winner === "green").length,
    blueWins: games.filter((g) => g.winner === "blue").length,
    draws: games.filter((g) => !g.winner).length,
    drawsByReason: countBy(games.map((g) => g.drawReason ?? "victory")),
    averagePlies: Number((games.reduce((n, g) => n + g.plies, 0) / Math.max(1, games.length)).toFixed(2)),
    medianPlies: median ?? 0,
    shortestGame: plies[0] ?? 0,
    longestGame: plies[plies.length - 1] ?? 0,
    uniqueCompleteMoveSequences: new Set(games.map((g) => g.moves.join(" "))).size,
    uniqueFirst10PlySequences: new Set(games.map((g) => g.first10)).size,
    sideGatesOpened: metric("sideGatesOpened"),
    sanctuaryEntries: metric("sanctuaryEntries"),
    directG7PickupEntries: metric("directG7PickupEntries"),
    flagPickups: metric("flagPickups"),
    extractionFailures: metric("extractionFailures"),
    successfulDepartures: metric("successfulDepartures"),
    ladenFlagBearerRoutings: metric("ladenFlagBearerRoutings"),
    homeVictories: metric("homeVictories"),
    illegalMoves: metric("illegalMoves"),
    replayFailures: games.filter((g) => !g.replayOk).length,
    diversityChanges,
    gateOpenedWithEnemyCarrierInside: metric("gateOpenedWithEnemyCarrierInside"),
    gateOpenedWithEnemyCarrierFlag: metric("gateOpenedWithEnemyCarrierFlag"),
    gateOpenImmediateEscapeRoutes: metric("gateOpenImmediateEscapeRoutes"),
    gateOpenReducedEscapeDistance: metric("gateOpenReducedEscapeDistance"),
    carrierContainmentDelta: Number(metric("carrierContainmentDelta").toFixed(2)),
    averageDiversityScoreLoss: Number((metric("diversityScoreLoss") / Math.max(1, diversityChanges)).toFixed(2)),
  };
}

function summarizeOpenings(games: GameRecord[], settings: OpeningSettings | TargetedOpeningSettings) {
  const byOpening = new Map<string, GameRecord[]>();
  for (const game of games) byOpening.set(game.opening ?? "(unknown)", [...(byOpening.get(game.opening ?? "(unknown)") ?? []), game]);
  return [...byOpening.entries()].map(([opening, rows]) => ({
    opening,
    games: rows.length,
    greenWins: rows.filter((g) => g.winner === "green").length,
    blueWins: rows.filter((g) => g.winner === "blue").length,
    draws: rows.filter((g) => !g.winner).length,
    averagePlies: Number((rows.reduce((n, g) => n + g.plies, 0) / rows.length).toFixed(2)),
    blueResponseMode: "blueResponseMode" in settings ? settings.blueResponseMode : ((settings as OpeningSettings).forceBlueReplies ? "forced" : "automatic"),
    forcedBlueReply: mostCommon(rows.map((g) => g.forcedBlueReply ?? "(automatic)")),
    actualBlueFirstMove: mostCommon(rows.map((g) => g.actualBlueFirstMove ?? g.moves[1] ?? "(none)")),
    mostCommonBlueReply: mostCommon(rows.map((g) => g.moves[1] ?? "(none)")),
    agents: `${settings.greenAgent} vs ${settings.blueAgent}`,
    diversity: `green ${settings.greenDiversity}, blue ${settings.blueDiversity}`,
  }));
}

function finalize(games: GameRecord[], positions: Array<Record<string, unknown>>, openingRows: Array<Record<string, unknown>>, mode: string, settings: unknown, cancelled: boolean): RunResult {
  const summary = summarizeRecords(games);
  const metadata = {
    simulatorVersion: VERSION,
    repositoryCommit: "browser-build-local",
    dateTime: new Date().toISOString(),
    settings,
    runMode: mode,
    cancelled,
    allReplayVerified: summary.replayFailures === 0,
    blueResponseMode: mode === "targeted" ? (settings as TargetedOpeningSettings).blueResponseMode : undefined,
  };
  const summaryRows = games.map((g) => ({ id: g.id, seed: g.seed, winner: g.winner ?? "draw", drawReason: g.drawReason, plies: g.plies, replayOk: g.replayOk, opening: g.opening, forcedGreenOpening: g.forcedGreenOpening, blueResponseMode: g.blueResponseMode, forcedBlueReply: g.forcedBlueReply ?? null, actualBlueFirstMove: g.actualBlueFirstMove ?? null, greenOpeningLabel: g.greenOpeningLabel, blueReplyLabel: g.blueReplyLabel, matchupId: g.matchupId, mirrorPairId: g.mirrorPairId, requestedSearchDepth: g.requestedSearchDepth, completedSearchDepth: g.completedSearchDepth, nodesSearched: g.nodesSearched, leafEvaluations: g.leafEvaluations, alphaBetaCutoffs: g.alphaBetaCutoffs, transpositionTableHits: g.transpositionTableHits, searchElapsedMs: g.searchElapsedMs, timedOut: g.timedOut, principalVariation: g.principalVariation, gateContainmentDiagnostics: JSON.stringify(g.gateContainmentDiagnostics), repetitionDiagnostics: JSON.stringify(g.repetitionDiagnostics), selectedMoveDiagnostics: JSON.stringify(g.selectedMoveDiagnostics), uniquePositionsVisited: g.repetitionDiagnostics.uniquePositionsVisited, repeatedPositionsCount: g.repetitionDiagnostics.repeatedPositionsCount, maximumRepetitionCount: g.repetitionDiagnostics.maximumRepetitionCount, immediateReversals: g.repetitionDiagnostics.immediateReversals, twoPlyCycles: g.repetitionDiagnostics.twoPlyCycles, fourPlyCycles: g.repetitionDiagnostics.fourPlyCycles, noProgressPlies: g.repetitionDiagnostics.noProgressPlies, longestNoProgressStreak: g.repetitionDiagnostics.longestNoProgressStreak, repetitionDraw: g.repetitionDiagnostics.repetitionDraw, noProgressDraw: g.repetitionDiagnostics.noProgressDraw, firstRepeatingCyclePly: g.repetitionDiagnostics.firstRepeatingCyclePly, firstPickupPlayer: g.firstPickupPlayer, pickupPly: g.pickupPly, extractionFailure: g.extractionFailure, carrierRouted: g.carrierRouted }));
  const files: ExportFile[] = [
    { name: "games.jsonl", mime: "application/x-ndjson", content: jsonl(games) },
    { name: "positions.jsonl", mime: "application/x-ndjson", content: jsonl(positions) },
    { name: "game_summary.csv", mime: "text/csv", content: toCsv(summaryRows) },
    { name: "run_metadata.json", mime: "application/json", content: JSON.stringify(metadata, null, 2) },
    { name: "analysis_summary.md", mime: "text/markdown", content: markdownSummary(summary) },
  ];
  if (openingRows.length) files.push({ name: "opening_results.csv", mime: "text/csv", content: toCsv(openingRows) });
  return { games, positions, summary, metadata, openingRows, files, cancelled };
}

function countBy(values: Array<string | null>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of values) out[value ?? "none"] = (out[value ?? "none"] ?? 0) + 1;
  return out;
}

function mostCommon(values: string[]): string {
  const counts = countBy(values);
  return Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "(none)";
}

export function defaultStandardSettings(): StandardSettings {
  return structuredClone(DEFAULT_SETTINGS.standard);
}

export function replayStoredGame(game: Pick<GameRecord, "moves">): { ok: boolean; state: GameState; failedAt?: number } {
  let state = createInitialState();
  for (let i = 0; i < game.moves.length; i++) {
    const match = /^(.*?):([A-M])(\d+)-([A-M])(\d+)$/.exec(game.moves[i]);
    if (!match) return { ok: false, state, failedAt: i + 1 };
    const move = { pieceId: match[1], to: { col: COLUMNS.indexOf(match[4]), row: Number(match[5]) - 1 } };
    const next = applyMove(state, move);
    if (next === state) return { ok: false, state, failedAt: i + 1 };
    state = next;
  }
  return { ok: true, state };
}

export function replayStoredGameTimeline(game: Pick<GameRecord, "moves">): { ok: boolean; states: GameState[]; failedAt?: number; previousMoves: Array<{ pieceId: string; from: { col: number; row: number }; to: { col: number; row: number } } | null> } {
  let state = createInitialState();
  const states: GameState[] = [state];
  const previousMoves: Array<{ pieceId: string; from: { col: number; row: number }; to: { col: number; row: number } } | null> = [null];
  for (let i = 0; i < game.moves.length; i++) {
    const match = /^(.*?):([A-M])(\d+)-([A-M])(\d+)$/.exec(game.moves[i]);
    if (!match) return { ok: false, states, failedAt: i + 1, previousMoves };
    const from = { col: COLUMNS.indexOf(match[2]), row: Number(match[3]) - 1 };
    const move = { pieceId: match[1], to: { col: COLUMNS.indexOf(match[4]), row: Number(match[5]) - 1 } };
    const next = applyMove(state, move);
    if (next === state) return { ok: false, states, failedAt: i + 1, previousMoves };
    state = next;
    states.push(state);
    previousMoves.push({ pieceId: move.pieceId, from, to: move.to });
  }
  return { ok: true, states, previousMoves };
}
