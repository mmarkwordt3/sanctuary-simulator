import { createInitialState } from "../src/game/setup.ts";
import { applyMove } from "../src/game/reducer.ts";
import { fromCoord } from "../src/game/coords.ts";
import type { Move } from "../src/game/types.ts";
import {
  type AgentName,
  type DiversityLevel,
  legalMovesForState,
  selectMoveDetailed,
  positionKey,
  type MoveRecord,
} from "./agents.ts";
import { summarize } from "./validation.ts";

export interface OpeningExplorationConfig {
  green: AgentName;
  blue: AgentName;
  gamesPerOpening: number;
  seedStart: number;
  maxPlies: number;
  searchDepth?: number;
  diversity?: DiversityLevel;
  forceBlueReplies?: boolean;
}

function labelMove(stateMove: Move, from: string): string {
  return `${stateMove.pieceId}:${from}-${fromCoord(stateMove.to)}`;
}

function firstMoveLabels(): Array<{ move: Move; label: string }> {
  const state = createInitialState();
  return legalMovesForState(state).map((move) => {
    const piece = state.pieces.find((p) => p.id === move.pieceId)!;
    return { move, label: labelMove(move, fromCoord(piece)) };
  });
}

function playWithForcedPrefix(
  prefix: Move[],
  green: AgentName,
  blue: AgentName,
  seed: number,
  maxPlies: number,
  searchDepth: number,
  diversity: DiversityLevel,
) {
  let state = createInitialState();
  const seen = new Map<string, number>();
  let previousMove: MoveRecord | null = null;
  const moves: Move[] = [];
  const summary = {
    winner: null as string | null,
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
  for (const move of prefix) {
    const piece = state.pieces.find((p) => p.id === move.pieceId)!;
    const beforeHistory = state.history.length;
    const beforeCarrier = state.flag.carrierId;
    const next = applyMove(state, move);
    if (next === state) throw new Error(`Forced illegal move ${move.pieceId}->${fromCoord(move.to)}`);
    recordEvents(summary, next.history.slice(beforeHistory).join(" | "), beforeCarrier);
    previousMove = { pieceId: move.pieceId, from: { col: piece.col, row: piece.row }, to: move.to };
    moves.push(move);
    state = next;
  }

  let plies = prefix.length;
  let illegalMoves = 0;
  while (plies < maxPlies && !state.winner) {
    const key = positionKey(state);
    seen.set(key, (seen.get(key) ?? 0) + 1);
    const agent = state.current === "green" ? green : blue;
    const selection = selectMoveDetailed(state, agent, {
      seed: seed + plies * 7919 + (state.current === "green" ? 0 : 31337),
      recentPositions: seen,
      previousMove,
      searchDepth,
      diversity,
    });
    if (!selection.move) break;
    const piece = state.pieces.find((p) => p.id === selection.move!.pieceId)!;
    const beforeHistory = state.history.length;
    const beforeCarrier = state.flag.carrierId;
    const next = applyMove(state, selection.move);
    if (next === state) { illegalMoves++; break; }
    if (selection.diversityAffectedChoice) {
      summary.diversityChanges++;
      summary.totalDiversityScoreLoss += selection.scoreLoss;
    }
    recordEvents(summary, next.history.slice(beforeHistory).join(" | "), beforeCarrier);
    previousMove = { pieceId: selection.move.pieceId, from: { col: piece.col, row: piece.row }, to: selection.move.to };
    moves.push(selection.move);
    state = next;
    plies++;
  }
  summary.winner = state.winner;
  summary.plies = plies;
  summary.illegalMoves = illegalMoves;
  summary.replayOk = replayVerify(moves, state);
  return summary;
}

function recordEvents(summary: ReturnType<typeof emptySummary>, events: string, beforeCarrier: string | null): void {
  if (/Wall removed/.test(events)) summary.sideGatesOpened++;
  if (/entered the Sanctuary/.test(events)) summary.sanctuaryEntries++;
  if (/took the flag/.test(events)) summary.flagPickups++;
  if (/reached the (West|East) Gate/.test(events)) summary.carrierReachedSideGate++;
  if (/departed the gate/.test(events)) summary.successfulForcedDepartures++;
  if (/ran out of extraction turns/.test(events)) summary.extractionFailures++;
  if (beforeCarrier && /Flag Bearer/.test(events) && /routed/.test(events)) summary.ladenFlagBearerRoutings++;
  if (/wins/.test(events)) summary.homeSquareVictory = true;
}

function emptySummary() {
  return {
    winner: null as string | null,
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
}

function replayVerify(moves: Move[], expected: ReturnType<typeof createInitialState>): boolean {
  let state = createInitialState();
  for (const move of moves) {
    const next = applyMove(state, move);
    if (next === state) return false;
    state = next;
  }
  return JSON.stringify(state) === JSON.stringify(expected);
}

export function runOpeningExploration(config: OpeningExplorationConfig) {
  const openings = firstMoveLabels();
  const output: Record<string, unknown> = {};
  let seed = config.seedStart;
  for (const opening of openings) {
    const initial = createInitialState();
    const afterOpening = applyMove(initial, opening.move);
    const blueReplies = config.forceBlueReplies && afterOpening !== initial
      ? legalMovesForState(afterOpening).map((reply) => {
        const piece = afterOpening.pieces.find((p) => p.id === reply.pieceId)!;
        return { move: reply, label: labelMove(reply, fromCoord(piece)) };
      })
      : [{ move: null, label: "normal-blue-response" }];
    const replyOutput: Record<string, unknown> = {};
    for (const reply of blueReplies) {
      const games = [];
      for (let i = 0; i < config.gamesPerOpening; i++) {
        const prefix = reply.move ? [opening.move, reply.move] : [opening.move];
        games.push(playWithForcedPrefix(
          prefix,
          config.green,
          config.blue,
          seed++,
          config.maxPlies,
          config.searchDepth ?? 2,
          config.diversity ?? 0,
        ));
      }
      replyOutput[reply.label] = summarize(games);
    }
    output[opening.label] = replyOutput;
  }
  return {
    config: {
      green: config.green,
      blue: config.blue,
      searchDepth: config.searchDepth ?? 2,
      diversity: config.diversity ?? 0,
      seedStart: config.seedStart,
      gamesPerOpening: config.gamesPerOpening,
      forceBlueReplies: !!config.forceBlueReplies,
    },
    openingsCovered: openings.length,
    results: output,
  };
}

if (import.meta.main) {
  console.log(JSON.stringify(runOpeningExploration({
    green: "heuristic-diverse",
    blue: "heuristic-diverse",
    gamesPerOpening: 1,
    seedStart: 1_000,
    maxPlies: 300,
    diversity: 1,
  }), null, 2));
}
