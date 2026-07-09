import { createInitialState } from "../src/game/setup.ts";
import { applyMove } from "../src/game/reducer.ts";
import type { GameState, Move } from "../src/game/types.ts";
import { type AgentName, positionKey, selectMoveDetailed, type MoveRecord, type DiversityLevel } from "./agents.ts";

export interface GameSummary {
  winner: string | null;
  plies: number;
  replayOk: boolean;
  illegalMoves: number;
  repetitionDraw: boolean;
  sideGatesOpened: number;
  sanctuaryEntries: number;
  flagPickups: number;
  carrierReachedSideGate: number;
  successfulForcedDepartures: number;
  extractionFailures: number;
  ladenFlagBearerRoutings: number;
  homeSquareVictory: boolean;
  diversityChanges: number;
  totalDiversityScoreLoss: number;
}

export function playGame(
  green: AgentName,
  blue: AgentName,
  seed: number,
  maxPlies: number,
  searchDepth = 2,
  diversity: DiversityLevel = 0,
): GameSummary {
  let state = createInitialState();
  const moves: Move[] = [];
  const seen = new Map<string, number>();
  let previousMove: MoveRecord | null = null;
  const summary: GameSummary = {
    winner: null,
    plies: 0,
    replayOk: false,
    illegalMoves: 0,
    repetitionDraw: false,
    sideGatesOpened: 0,
    sanctuaryEntries: 0,
    flagPickups: 0,
    carrierReachedSideGate: 0,
    successfulForcedDepartures: 0,
    extractionFailures: 0,
    ladenFlagBearerRoutings: 0,
    homeSquareVictory: false,
    diversityChanges: 0,
    totalDiversityScoreLoss: 0,
  };

  for (let ply = 0; ply < maxPlies && !state.winner; ply++) {
    const key = positionKey(state);
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count >= 4) {
      summary.repetitionDraw = true;
      break;
    }

    const agent = state.current === "green" ? green : blue;
    const selection = selectMoveDetailed(state, agent, {
      seed: seed + ply * 7919 + (state.current === "green" ? 0 : 31337),
      recentPositions: seen,
      previousMove,
      searchDepth,
      diversity,
    });
    const move = selection.move;
    if (!move) break;
    if (selection.diversityAffectedChoice) {
      summary.diversityChanges++;
      summary.totalDiversityScoreLoss += selection.scoreLoss;
    }
    const piece = state.pieces.find((p) => p.id === move.pieceId)!;
    const beforeHistory = state.history.length;
    const beforeCarrier = state.flag.carrierId;
    const next = applyMove(state, move);
    if (next === state) {
      summary.illegalMoves++;
      break;
    }
    const events = next.history.slice(beforeHistory).join(" | ");
    if (/Wall removed/.test(events)) summary.sideGatesOpened++;
    if (/entered the Sanctuary/.test(events)) summary.sanctuaryEntries++;
    if (/took the flag/.test(events)) summary.flagPickups++;
    if (/reached the (West|East) Gate/.test(events)) summary.carrierReachedSideGate++;
    if (/departed the gate/.test(events)) summary.successfulForcedDepartures++;
    if (/ran out of extraction turns/.test(events)) summary.extractionFailures++;
    if (beforeCarrier && /Flag Bearer/.test(events) && /routed/.test(events)) summary.ladenFlagBearerRoutings++;
    if (/wins/.test(events)) summary.homeSquareVictory = true;

    previousMove = { pieceId: move.pieceId, from: { col: piece.col, row: piece.row }, to: move.to };
    moves.push(move);
    state = next;
  }

  summary.winner = state.winner;
  summary.plies = moves.length;
  summary.replayOk = replayVerify(moves, state);
  return summary;
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

export function summarize(games: GameSummary[]) {
  return {
    actualVictories: games.filter((g) => g.winner).length,
    maxPliesDraws: games.filter((g) => !g.winner && !g.repetitionDraw).length,
    repetitionDraws: games.filter((g) => g.repetitionDraw).length,
    sideGatesOpened: games.reduce((n, g) => n + g.sideGatesOpened, 0),
    sanctuaryEntries: games.reduce((n, g) => n + g.sanctuaryEntries, 0),
    flagPickups: games.reduce((n, g) => n + g.flagPickups, 0),
    carriersReachingE7OrI7: games.reduce((n, g) => n + g.carrierReachedSideGate, 0),
    successfulForcedDepartures: games.reduce((n, g) => n + g.successfulForcedDepartures, 0),
    extractionFailures: games.reduce((n, g) => n + g.extractionFailures, 0),
    ladenFlagBearerRoutings: games.reduce((n, g) => n + g.ladenFlagBearerRoutings, 0),
    homeSquareVictories: games.filter((g) => g.homeSquareVictory).length,
    replayFailures: games.filter((g) => !g.replayOk).length,
    illegalMoves: games.reduce((n, g) => n + g.illegalMoves, 0),
    averagePlies: Number((games.reduce((n, g) => n + g.plies, 0) / games.length).toFixed(2)),
    diversityChanges: games.reduce((n, g) => n + g.diversityChanges, 0),
    averageDiversityScoreLoss: Number((
      games.reduce((n, g) => n + g.totalDiversityScoreLoss, 0) /
      Math.max(1, games.reduce((n, g) => n + g.diversityChanges, 0))
    ).toFixed(2)),
  };
}

if (import.meta.main) {
  const baselineSeeds = [11, 22, 33, 44, 55];
  const improvedSeeds = [101, 202, 303, 404, 505];
  const searchSeeds = [9001, 9002];
  const baselineLegacy = baselineSeeds.map((s) => playGame("legacy-heuristic", "legacy-heuristic", s, 500));
  const baselineImproved = baselineSeeds.map((s) => playGame("heuristic", "heuristic", s, 500));
  const improved750 = improvedSeeds.map((s) => playGame("heuristic", "heuristic", s, 750));
  const search = searchSeeds.map((s) => playGame("search", "search", s, 500, 2));
  console.log(JSON.stringify({
    baselineLegacy: summarize(baselineLegacy),
    baselineImprovedSameSeeds: summarize(baselineImproved),
    improved750: summarize(improved750),
    searchDepth2: summarize(search),
    sampleGames: { baselineLegacy, baselineImproved, improved750, search },
  }, null, 2));
}
