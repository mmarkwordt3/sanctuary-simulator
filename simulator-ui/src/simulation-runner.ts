import { createInitialState } from "../../src/game/setup.ts";
import { applyMove } from "../../src/game/reducer.ts";
import { fromCoord } from "../../src/game/coords.ts";
import type { GameState, Move } from "../../src/game/types.ts";
import {
  type AgentName,
  type DiversityLevel,
  type MoveRecord,
  legalMovesForState,
  positionKey,
  selectMoveDetailed,
} from "../../simulator/agents.ts";
import { canonicalLabel } from "../../simulator/mirror.ts";
import { DEFAULT_SETTINGS, type OpeningSettings, type PositionSampling, type StandardSettings } from "./config.ts";
import { jsonl, markdownSummary, toCsv, type ExportFile } from "./exporters.ts";

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
  drawReason: "maxPlies" | "cancelled" | "noLegalMove" | null;
  plies: number;
  replayOk: boolean;
  moves: string[];
  first10: string;
  opening?: string;
  metrics: Metrics;
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
    games.push(playOne({
      id: i + 1,
      seed: settings.seed + i,
      greenAgent: settings.greenAgent,
      blueAgent: settings.blueAgent,
      greenDiversity: settings.greenDiversity,
      blueDiversity: settings.blueDiversity,
      searchDepth: settings.searchDepth,
      maxPlies: settings.maxPlies,
      positionSampling: settings.positionSampling,
      positions,
    }));
    if (i % 2 === 0 || i === settings.games - 1) control.onProgress(progress(games, settings.games));
  }
  return finalize(games, positions, [], "standard", settings, control.isCancelled());
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
      games.push(playOne({
        id: id++,
        seed: settings.seed + pairIndex * settings.gamesPerOpening + i,
        greenAgent: settings.greenAgent,
        blueAgent: settings.blueAgent,
        greenDiversity: settings.greenDiversity,
        blueDiversity: settings.blueDiversity,
        searchDepth: settings.searchDepth,
        maxPlies: settings.maxPlies,
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
  positionSampling: PositionSampling;
  positions: Array<Record<string, unknown>>;
  forcedPrefix?: Move[];
  opening?: string;
}

function playOne(args: PlayArgs): GameRecord {
  let state = createInitialState();
  const seen = new Map<string, number>();
  let previousMove: MoveRecord | null = null;
  const moves: Move[] = [];
  const labels: string[] = [];
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
  };

  for (const forced of args.forcedPrefix ?? []) {
    const applied = applyTrackedMove(state, forced, moves, labels, metrics);
    if (!applied) { metrics.illegalMoves++; break; }
    previousMove = applied.previousMove;
    state = applied.state;
  }

  while (!state.winner && moves.length < args.maxPlies && metrics.illegalMoves === 0) {
    const agent = state.current === "green" ? args.greenAgent : args.blueAgent;
    const diversity = state.current === "green" ? args.greenDiversity : args.blueDiversity;
    seen.set(positionKey(state), (seen.get(positionKey(state)) ?? 0) + 1);
    const selection = selectMoveDetailed(state, agent, {
      seed: args.seed + moves.length * 7919 + (state.current === "green" ? 0 : 31337),
      recentPositions: seen,
      previousMove,
      searchDepth: args.searchDepth,
      diversity,
    });
    if (!selection.move) break;
    if (selection.diversityAffectedChoice) {
      metrics.diversityChanges++;
      metrics.diversityScoreLoss += selection.scoreLoss;
    }
    const applied = applyTrackedMove(state, selection.move, moves, labels, metrics);
    if (!applied) { metrics.illegalMoves++; break; }
    previousMove = applied.previousMove;
    state = applied.state;
    if (args.positionSampling === "every-ply") args.positions.push(positionRecord(args.id, moves.length, state));
  }
  if (args.positionSampling === "final") args.positions.push(positionRecord(args.id, moves.length, state));
  const drawReason = state.winner ? null : moves.length >= args.maxPlies ? "maxPlies" : "noLegalMove";
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
    metrics,
  };
}

function applyTrackedMove(state: GameState, move: Move, moves: Move[], labels: string[], metrics: Metrics) {
  const piece = state.pieces.find((p) => p.id === move.pieceId);
  if (!piece) return null;
  const beforeHistory = state.history.length;
  const beforeCarrier = state.flag.carrierId;
  const from = { col: piece.col, row: piece.row };
  const next = applyMove(state, move);
  if (next === state) return null;
  const events = next.history.slice(beforeHistory).join(" | ");
  if (/Wall removed/.test(events)) metrics.sideGatesOpened++;
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
  return { state: next, previousMove: { pieceId: move.pieceId, from, to: move.to } };
}

function moveLabel(state: GameState, move: Move): string {
  const piece = state.pieces.find((p) => p.id === move.pieceId)!;
  return `${move.pieceId}:${fromCoord(piece)}-${fromCoord(move.to)}`;
}

function replayVerify(moves: Move[], expected: GameState): boolean {
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
    averageDiversityScoreLoss: Number((metric("diversityScoreLoss") / Math.max(1, diversityChanges)).toFixed(2)),
  };
}

function summarizeOpenings(games: GameRecord[], settings: OpeningSettings) {
  const byOpening = new Map<string, GameRecord[]>();
  for (const game of games) byOpening.set(game.opening ?? "(unknown)", [...(byOpening.get(game.opening ?? "(unknown)") ?? []), game]);
  return [...byOpening.entries()].map(([opening, rows]) => ({
    opening,
    games: rows.length,
    greenWins: rows.filter((g) => g.winner === "green").length,
    blueWins: rows.filter((g) => g.winner === "blue").length,
    draws: rows.filter((g) => !g.winner).length,
    averagePlies: Number((rows.reduce((n, g) => n + g.plies, 0) / rows.length).toFixed(2)),
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
  };
  const summaryRows = games.map((g) => ({ id: g.id, seed: g.seed, winner: g.winner ?? "draw", drawReason: g.drawReason, plies: g.plies, replayOk: g.replayOk, opening: g.opening }));
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
