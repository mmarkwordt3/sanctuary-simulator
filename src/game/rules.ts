// Small, isolated rule predicates shared by the reducer. Keeping these here
// (rather than inline in the reducer) makes the required implementation
// assumptions easy to locate and change.

import type { Coord, GameState, Piece, Player, WallSide } from "./types.ts";
import {
  ASSASSIN_TERRITORY,
  GATES,
  GATE_DEPARTURE,
  HOME_SQUARE,
  PROMOTION_ROWS,
  RESERVED,
} from "./constants.ts";
import { coordEquals, fromCoord, toCoord } from "./coords.ts";
import { cannonWallTarget, isGate, isInnerCircle } from "./terrain.ts";
import { FLAG_HOME } from "./constants.ts";

/** The route-return / home square for a routable special piece. */
export function homeSquareFor(piece: Piece): Coord {
  if (piece.type === "flagBearer") return toCoord(HOME_SQUARE[piece.player].flagBearer);
  if (piece.type === "engineer") return toCoord(HOME_SQUARE[piece.player].engineer);
  throw new Error(`Piece ${piece.type} has no home square`);
}

/** The square a carrier must reach to win. */
export function victorySquareFor(player: Player): Coord {
  return player === "green"
    ? toCoord(RESERVED.greenFlagBearer) // G1
    : toCoord(RESERVED.blueFlagBearer); // G13
}

/** Does a carrier standing on `dest` win for `player`? */
export function isVictory(player: Player, dest: Coord): boolean {
  return coordEquals(dest, victorySquareFor(player));
}

/** Should a Spy of `player` promote after ending on 0-indexed row `row0`? */
export function shouldPromote(player: Player, row0: number): boolean {
  return PROMOTION_ROWS[player].includes(row0 + 1);
}

/** Is an Assassin of `player` outside its own territory on `row0` (demote)? */
export function isDemotionRow(player: Player, row0: number): boolean {
  return !ASSASSIN_TERRITORY[player].includes(row0 + 1);
}

/**
 * If an Engineer ends on `dest`, which wall (if any) should open? Returns null
 * when the square is not a cannon zone or the target wall is already open
 * (assumption #11: an already-open wall cannot be triggered again).
 */
export function cannonWallToOpen(state: GameState, dest: Coord): WallSide | null {
  const target = cannonWallTarget(dest);
  if (!target) return null;
  return state.walls[target] ? target : null; // true = still closed
}

/** Are both walls now open? (used to decide second-wall Engineer removal) */
export function bothWallsOpen(state: GameState): boolean {
  return !state.walls.west && !state.walls.east;
}

// ---------------------------------------------------------------------------
// Flag extraction & forced gate-departure (centralized pure helpers).
// ---------------------------------------------------------------------------

/** Is `c` an extraction gate — the West (E7) or East (I7) side gate? */
export function isExtractionGate(c: Coord): boolean {
  const a = fromCoord(c);
  return a === GATES.west || a === GATES.east;
}

/**
 * Legal outward departure squares for a carrier standing on a side gate
 * (E7 -> D6/D7/D8, I7 -> J6/J7/J8). Returns [] if `c` is not a side gate. These
 * are terrain candidates only; occupancy/legality is still applied by the mover.
 */
export function gateDepartureSquares(c: Coord): Coord[] {
  const squares = GATE_DEPARTURE[fromCoord(c)];
  return squares ? squares.map(toCoord) : [];
}

/** Human-readable side name of an extraction gate (E7 -> West, I7 -> East). */
export function gateSideName(c: Coord): "West" | "East" {
  return fromCoord(c) === GATES.west ? "West" : "East";
}

/** The piece currently carrying the flag, or undefined. */
export function carrierOf(state: GameState): Piece | undefined {
  if (!state.flag.carrierId) return undefined;
  return state.pieces.find((p) => p.id === state.flag.carrierId);
}

/**
 * Opening restriction: on Green's very first turn only, Green may not move its
 * Engineer or Flag Bearer. Derived from existing state (no dedicated field) —
 * Green moves first, so an empty history with Green to move is that turn. This
 * naturally survives undo/restart/reload because `history` is part of the state.
 */
export function isBlockedByGreenOpening(state: GameState, piece: Piece): boolean {
  return (
    state.current === "green" &&
    state.history.length === 0 &&
    piece.player === "green" &&
    (piece.type === "engineer" || piece.type === "flagBearer")
  );
}

// ---------------------------------------------------------------------------
// Unladen Sanctuary buffer/decision system (centralized pure predicates).
// ---------------------------------------------------------------------------

const FLAG_HOME_C = toCoord(FLAG_HOME);

/** Is this an inner-circle square that activates the unladen sequence on entry?
 * (Every inner square except G7 — landing on G7 collects the flag instead.) */
export function isUnladenEntrySquare(c: Coord): boolean {
  return isInnerCircle(c) && !coordEquals(c, FLAG_HOME_C);
}

/** Has an (unladen) Bearer completely left the Sanctuary — i.e. it is on an
 * exterior, non-gate square? Ending on a gate tile is NOT a complete exit. */
export function bearerCompletedExit(c: Coord): boolean {
  return !isInnerCircle(c) && !isGate(c);
}

/** Is an unladen Sanctuary sequence currently active? */
export function hasActiveUnladenSanctuary(state: GameState): boolean {
  return state.unladenSanctuary !== null;
}
