// Shared test utilities for building bespoke positions and inspecting moves.

import type { GameState, Piece, PieceType, Player } from "../src/game/types.ts";
import { toCoord, fromCoord } from "../src/game/coords.ts";
import { legalMoves } from "../src/game/movement.ts";
import { applyMove } from "../src/game/reducer.ts";
import { pieceAt } from "../src/game/terrain.ts";

let idCounter = 0;

export function piece(
  type: PieceType,
  player: Player,
  at: string,
  id?: string,
): Piece {
  const c = toCoord(at);
  return { id: id ?? `${type}-${player}-${idCounter++}`, type, player, col: c.col, row: c.row };
}

/** Build a minimal state with the given pieces. Flag defaults to G7 resting. */
export function makeState(
  pieces: Piece[],
  overrides: Partial<GameState> = {},
): GameState {
  return {
    pieces,
    current: "green",
    walls: { west: true, east: true },
    flag: { square: toCoord("G7"), carrierId: null },
    extractionTurnsRemaining: null,
    forcedGateDeparture: false,
    unladenSanctuary: null,
    lastMove: null,
    engineersRemoved: false,
    winner: null,
    // Fixtures represent an in-progress position, not the game's opening, so seed
    // a non-empty history (the Green first-turn opening restriction keys off an
    // empty history). Tests that need the true opening use createInitialState().
    history: ["(position setup)"],
    ...overrides,
  };
}

/** Algebraic destinations of legal empty moves from a square. */
export function moveTargets(state: GameState, at: string): string[] {
  return legalMoves(state, toCoord(at))
    .filter((m) => m.kind === "move")
    .map((m) => fromCoord(m.to))
    .sort();
}

/** Algebraic destinations of legal captures from a square. */
export function captureTargets(state: GameState, at: string): string[] {
  return legalMoves(state, toCoord(at))
    .filter((m) => m.kind === "capture")
    .map((m) => fromCoord(m.to))
    .sort();
}

/** All legal destinations (move + capture) from a square. */
export function allTargets(state: GameState, at: string): string[] {
  return legalMoves(state, toCoord(at))
    .map((m) => fromCoord(m.to))
    .sort();
}

/** Apply a move by algebraic squares; returns the new state. */
export function move(state: GameState, from: string, to: string): GameState {
  const p = pieceAt(state, toCoord(from));
  if (!p) throw new Error(`No piece at ${from}`);
  return applyMove(state, { pieceId: p.id, to: toCoord(to) });
}

export function at(state: GameState, square: string): Piece | undefined {
  return pieceAt(state, toCoord(square));
}
