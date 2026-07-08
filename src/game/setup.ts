// Initial state construction. Kept separate so the reducer and UI both build a
// fresh game from one canonical source.

import type { GameState, Piece } from "./types.ts";
import { FIRST_PLAYER, FLAG_HOME, STARTING_SETUP } from "./constants.ts";
import { toCoord } from "./coords.ts";

/** Build the starting pieces from the canonical setup table. */
export function createStartingPieces(): Piece[] {
  const counters: Record<string, number> = {};
  return STARTING_SETUP.map((entry) => {
    const c = toCoord(entry.at);
    const key = `${entry.player}-${entry.type}`;
    const n = (counters[key] = (counters[key] ?? 0) + 1);
    const piece: Piece = {
      id: `${key}-${n}`,
      type: entry.type,
      player: entry.player,
      col: c.col,
      row: c.row,
    };
    return piece;
  });
}

/** A fresh game in its opening position. */
export function createInitialState(): GameState {
  return {
    pieces: createStartingPieces(),
    current: FIRST_PLAYER,
    walls: { west: true, east: true }, // both walls begin closed
    flag: { square: toCoord(FLAG_HOME), carrierId: null },
    extractionTurnsRemaining: null,
    forcedGateDeparture: false,
    unladenSanctuary: null,
    lastMove: null,
    engineersRemoved: false,
    winner: null,
    history: [],
  };
}

/** Deep, structurally faithful clone used for undo snapshots. */
export function cloneState(state: GameState): GameState {
  // structuredClone preserves the exact shape and is available in the target
  // runtimes (Node >= 17, modern browsers). State is intentionally plain data.
  return structuredClone(state);
}
