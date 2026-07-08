// Terrain predicates. Every question about "what kind of square is this" is
// answered here, in one place, so movement and reducer logic stays declarative.

import type { Coord, GameState, Piece } from "./types.ts";
import {
  CANNON_KEYS,
  EAST_CANNON_KEYS,
  FLAG_HOME,
  GATES,
  GATE_KEYS,
  GATE_WALL,
  INNER_CIRCLE_KEYS,
  PERMANENT_WALL_KEYS,
  RESERVED_KEYS,
  RESERVED,
  WEST_CANNON_KEYS,
} from "./constants.ts";
import { fromCoord, inBounds, key, toCoord } from "./coords.ts";
import type { WallSide } from "./types.ts";

export function isPermanentWall(c: Coord): boolean {
  return PERMANENT_WALL_KEYS.has(key(c));
}

export function isInnerCircle(c: Coord): boolean {
  return INNER_CIRCLE_KEYS.has(key(c));
}

export function isGate(c: Coord): boolean {
  return GATE_KEYS.has(key(c));
}

export function isReserved(c: Coord): boolean {
  return RESERVED_KEYS.has(key(c));
}

export function isCannonZone(c: Coord): boolean {
  return CANNON_KEYS.has(key(c));
}

/** Which wall a cannon square controls (cross-map), or null if not a cannon. */
export function cannonWallTarget(c: Coord): WallSide | null {
  const k = key(c);
  // West cannon (A6-A8) opens the EAST wall; East cannon (M6-M8) the WEST wall.
  if (WEST_CANNON_KEYS.has(k)) return "east";
  if (EAST_CANNON_KEYS.has(k)) return "west";
  return null;
}

/** The wall sitting on a gate square, if any (west -> E7, east -> I7). */
export function gateWall(c: Coord): WallSide | null {
  return GATE_WALL[key(c)] ?? null;
}

/**
 * Is this gate currently blocked by its wall? North/South gates carry no wall
 * and are therefore never blocked. A blocked gate is impassable even to a Flag
 * Bearer.
 */
export function isBlockedGate(state: GameState, c: Coord): boolean {
  const w = gateWall(c);
  if (!w) return false;
  return state.walls[w] === true;
}

/** The piece occupying a square, or undefined. Carried pieces are on the board. */
export function pieceAt(state: GameState, c: Coord): Piece | undefined {
  return state.pieces.find((p) => p.col === c.col && p.row === c.row);
}

/**
 * Can a non-Bearer piece pass THROUGH this square as an intermediate step of a
 * sliding move? Blocked by anything a non-Horse piece cannot traverse: walls,
 * gates, inner circle, off-board, or occupancy.
 */
export function isTraversable(state: GameState, c: Coord): boolean {
  if (!inBounds(c)) return false;
  if (isPermanentWall(c)) return false;
  if (isGate(c)) return false; // gates are impassable to non-Bearers
  if (isInnerCircle(c)) return false;
  if (pieceAt(state, c)) return false;
  return true;
}

/** Names of gates for messages/UI (algebraic -> "North"/"West"/...). */
export function gateNameAt(c: Coord): string | null {
  const a = fromCoord(c);
  for (const [name, square] of Object.entries(GATES)) {
    if (square === a) return name.charAt(0).toUpperCase() + name.slice(1);
  }
  return null;
}

/**
 * Is the given reserved square available for `piece` to end on? Reserved
 * squares (G1/G3/G11/G13) may only be ended on by their designated returning
 * special piece — i.e. the piece whose home that square is. All other pieces
 * (and even the wrong special piece) are barred from ending there.
 */
export function reservedBlocksEnd(piece: Piece, c: Coord): boolean {
  const a = fromCoord(c);
  if (!RESERVED_KEYS.has(key(c))) return false;
  // The owning piece is allowed to end on its own reserved home square.
  if (piece.type === "flagBearer" && piece.player === "green" && a === RESERVED.greenFlagBearer) return false;
  if (piece.type === "flagBearer" && piece.player === "blue" && a === RESERVED.blueFlagBearer) return false;
  if (piece.type === "engineer" && piece.player === "green" && a === RESERVED.greenEngineer) return false;
  if (piece.type === "engineer" && piece.player === "blue" && a === RESERVED.blueEngineer) return false;
  return true;
}

/**
 * ISOLATED inner-circle Flag-Bearer entry legality (the single gate for the
 * Sanctuary occupancy rules).
 *
 * An unladen Flag Bearer may ENTER the inner circle only when BOTH hold:
 *   1. the neutral flag is present at G7 (resting, not carried), and
 *   2. no other Flag Bearer is already inside the inner circle
 *      (at most one Flag Bearer may occupy the Sanctuary at a time).
 *
 * Together these enforce single-occupancy (rule 1), flag-must-be-present entry
 * (rule 2), and "the opponent cannot enter until the first Bearer has left or
 * been routed/reset" (rule 4 — once the flag is picked up it is no longer at
 * G7, and a routed/timed-out carrier resets the flag back to G7). Rule 3 (an
 * unladen Bearer already inside gets a buffer/decision grace period, during
 * which any friendly piece may move freely, before being auto-routed home if
 * it neither collects the flag nor fully exits) is implemented by the
 * `unladenSanctuary` state machine in `reducer.ts`, not by restricting
 * movement generation here. Laden Bearers move freely during extraction
 * (rule 5). See README "Unladen Sanctuary (buffer & decision)".
 */
export function canBearerEnterInnerCircle(state: GameState, bearer: Piece): boolean {
  // The opponent may not enter while the other side has an active unladen
  // Sanctuary sequence — even if that committed Bearer has stepped onto a gate.
  if (state.unladenSanctuary && state.unladenSanctuary.player !== bearer.player) {
    return false;
  }
  // Flag must be resting at G7.
  const flagPresent =
    state.flag.carrierId === null &&
    state.flag.square !== null &&
    key(state.flag.square) === key(toCoord(FLAG_HOME));
  if (!flagPresent) return false;
  // No other Flag Bearer may already be inside the Sanctuary.
  const anotherInside = state.pieces.some(
    (p) => p.type === "flagBearer" && p.id !== bearer.id && isInnerCircle(p),
  );
  return !anotherInside;
}

export { toCoord };
