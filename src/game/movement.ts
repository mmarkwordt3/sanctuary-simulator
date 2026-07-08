// Pure legal-move generation. Every function here takes a GameState + a piece
// and returns the legal destinations for that piece. Nothing here mutates state.
// The reducer validates requested moves against this generator, so the UI can
// never force an illegal move — the rules layer is the single source of truth.

import type { Coord, GameState, LegalMove, MoveKind, Piece } from "./types.ts";
import {
  ASSASSIN_TERRITORY,
  FLANK_COL_INDICES,
  FLAG_HOME,
  FORWARD_ROW_DELTA,
  GATES,
} from "./constants.ts";
import {
  DIAGONAL,
  DIRECTIONS,
  ORTHOGONAL,
  fromCoord,
  inBounds,
  key,
  step,
  toCoord,
} from "./coords.ts";
import {
  canBearerEnterInnerCircle,
  isBlockedGate,
  isGate,
  isInnerCircle,
  isPermanentWall,
  pieceAt,
  reservedBlocksEnd,
} from "./terrain.ts";
import { gateDepartureSquares, isBlockedByGreenOpening } from "./rules.ts";

const FLAG_HOME_COORD = toCoord(FLAG_HOME);
const EXIT_GATE_COORDS = [toCoord(GATES.west), toCoord(GATES.east)];

function isExitGate(c: Coord): boolean {
  return EXIT_GATE_COORDS.some((g) => g.col === c.col && g.row === c.row);
}

function inTerritory(player: Piece["player"], row0: number): boolean {
  return ASSASSIN_TERRITORY[player].includes(row0 + 1);
}

// ---------------------------------------------------------------------------
// Shared landing evaluation for ordinary (non-Bearer) pieces.
// ---------------------------------------------------------------------------

interface SquareEval {
  landable: boolean;
  kind?: MoveKind;
  /** True if a sliding piece cannot continue past this square. */
  blocks: boolean;
}

/** Ordinary pieces cannot capture a Flag Bearer/Engineer? They CAN (routing). */
function ordinaryCanCapture(piece: Piece): boolean {
  // Engineers cannot attack (assumption #2). Flag Bearers use bespoke logic.
  return piece.type !== "engineer" && piece.type !== "flagBearer";
}

/**
 * Evaluate a single destination square for an ordinary piece. Handles terrain
 * (walls, gates, inner circle, reserved squares), occupancy, and capture
 * eligibility. `blocks` reports whether a slide must stop here.
 */
function evalOrdinary(state: GameState, piece: Piece, dest: Coord): SquareEval {
  if (!inBounds(dest)) return { landable: false, blocks: true };
  // Gates, inner circle and permanent walls are impassable to non-Bearers and
  // cannot be landed on nor traversed.
  if (isPermanentWall(dest) || isGate(dest) || isInnerCircle(dest)) {
    return { landable: false, blocks: true };
  }
  const occ = pieceAt(state, dest);
  if (!occ) {
    if (reservedBlocksEnd(piece, dest)) {
      // Reserved square: cannot END here, but the empty square is traversable.
      return { landable: false, blocks: false };
    }
    return { landable: true, kind: "move", blocks: false };
  }
  if (occ.player === piece.player) return { landable: false, blocks: true };
  // Enemy occupant.
  if (!ordinaryCanCapture(piece)) return { landable: false, blocks: true };
  if (reservedBlocksEnd(piece, dest)) return { landable: false, blocks: true };
  return { landable: true, kind: "capture", blocks: true };
}

/** Generic straight-line generator for orthogonal/diagonal sliders. */
function slide(
  state: GameState,
  piece: Piece,
  dirs: ReadonlyArray<Coord>,
  maxDist: number,
): LegalMove[] {
  const out: LegalMove[] = [];
  for (const dir of dirs) {
    for (let d = 1; d <= maxDist; d++) {
      const dest = step(piece, dir, d);
      const ev = evalOrdinary(state, piece, dest);
      if (ev.landable) out.push({ to: dest, kind: ev.kind! });
      if (ev.blocks) break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Flag Bearer
// ---------------------------------------------------------------------------

/** A gate's traversal axis: North/South (G5/G9) are vertical, West/East
 * (E7/I7) are horizontal. Used to forbid diagonal corner-cutting through gates. */
function gateIsVertical(c: Coord): boolean {
  const a = fromCoord(c);
  return a === GATES.north || a === GATES.south;
}

/**
 * Per-step terrain/direction legality for a Flag Bearer moving `from` -> `to`.
 * Occupancy is handled by the caller.
 *
 * Laden (carrying) Bearers keep the original gate rules: they may leave the
 * circle only through the open West/East gate and never through North/South.
 *
 * Unladen Bearers may retreat through ANY open gate (North/South included), but
 * a gate may only be traversed STRAIGHT along its axis (vertical for N/S,
 * horizontal for W/E) — this permits the two-square through-gate exits and
 * blocks diagonal corner-cutting around a gate/wall.
 *
 * For both, the inner circle can only be entered from a gate (or from within it)
 * and closed gates are impassable.
 */
function bearerStepLegal(
  state: GameState,
  from: Coord,
  to: Coord,
  laden: boolean,
): boolean {
  if (!inBounds(to)) return false;
  if (isPermanentWall(to)) return false;

  const fromInner = isInnerCircle(from);
  const fromGate = isGate(from);
  const toGate = isGate(to);
  const toInner = isInnerCircle(to);
  const toOutside = !toGate && !toInner;

  if (toGate && isBlockedGate(state, to)) return false; // closed wall blocks the gate

  if (toInner) {
    // The inner circle is sealed by walls; the only legal entry is via a gate
    // or a move within the circle.
    if (!fromGate && !fromInner) return false;
  }

  if (laden) {
    // Laden extraction: leave the circle only via the open West/East gate.
    if (toGate && fromInner && !isExitGate(to)) return false;
    if (fromGate && toOutside && !isExitGate(from)) return false;
  } else {
    // Unladen: a gate may only be crossed straight along its axis — EXCEPT that
    // a Bearer may land on a gate from an exterior (non-inner) square with any
    // otherwise-legal 1-2 square move. The axis rule still blocks diagonal
    // corner-cutting between a gate and the inner circle, and off-axis steps off
    // a gate.
    const gate = toGate ? to : fromGate ? from : null;
    const landingOnGateFromOutside = toGate && !isInnerCircle(from);
    if (gate && !landingOnGateFromOutside) {
      if (gateIsVertical(gate)) {
        if (from.col !== to.col) return false;
      } else if (from.row !== to.row) return false;
    }
  }
  return true;
}

function flagBearerMoves(state: GameState, piece: Piece): LegalMove[] {
  const out: LegalMove[] = [];
  const laden = state.flag.carrierId === piece.id;
  const maxDist = laden ? 1 : 2; // laden bearers move exactly 1
  const attackerInside = isInnerCircle(piece);

  // An unladen Bearer inside the Sanctuary moves normally (1-2 orthogonal or
  // diagonal): it may reshuffle within the circle, step onto G7 to collect the
  // flag, or retreat completely out through any open gate. The buffer/decision
  // timing that eventually routes it is handled in the reducer, not here.

  for (const dir of DIRECTIONS) {
    for (let d = 1; d <= maxDist; d++) {
      const from = step(piece, dir, d - 1);
      const to = step(piece, dir, d);
      if (!bearerStepLegal(state, from, to, laden)) break;

      const occ = pieceAt(state, to);
      if (!occ) {
        // Entry into the inner circle is gated for UNLADEN Bearers: the flag
        // must be at G7 and no other Bearer may be inside (rules 1, 2, 4).
        // Laden Bearers move freely inside the circle while extracting (rule 5).
        if (isInnerCircle(to) && !laden && !canBearerEnterInnerCircle(state, piece)) {
          break;
        }
        if (!reservedBlocksEnd(piece, to)) {
          out.push({ to, kind: "move" });
        }
        // Empty & traversable — keep sliding.
        continue;
      }

      // Occupied: a Bearer may capture ONLY the opposing carrier, and only when
      // neither the attacker nor the target is inside the inner circle
      // (assumption #7). It can never capture ordinary pieces or an Engineer.
      const targetInside = isInnerCircle(to);
      if (
        occ.type === "flagBearer" &&
        occ.player !== piece.player &&
        state.flag.carrierId === occ.id &&
        !attackerInside &&
        !targetInside
      ) {
        out.push({ to, kind: "capture" });
      }
      break; // cannot pass through any occupied square
    }
  }

  // Forced gate-departure: while the carrier occupies a side gate it may move
  // ONLY to the legal outward squares (E7 -> D6/D7/D8, I7 -> J6/J7/J8) and never
  // back into the inner circle. We reuse the normal laden generation above (it
  // already yields only empty, terrain-legal squares) and keep just the outward
  // ones. This centralizes rule 12/13/16 on top of the existing move rules.
  if (state.forcedGateDeparture && state.flag.carrierId === piece.id) {
    const allowed = new Set(gateDepartureSquares(piece).map((c) => key(c)));
    return out.filter((m) => allowed.has(key(m.to)));
  }

  return out;
}

// ---------------------------------------------------------------------------
// Engineer, Spy
// ---------------------------------------------------------------------------

function engineerMoves(state: GameState, piece: Piece): LegalMove[] {
  // 1-2 orthogonal/diagonal, cannot attack (evalOrdinary bars captures).
  return slide(state, piece, DIRECTIONS, 2);
}

function spyMoves(state: GameState, piece: Piece): LegalMove[] {
  return slide(state, piece, DIRECTIONS, 2);
}

// ---------------------------------------------------------------------------
// Assassin (up to 4, plus single-step demotion across the boundary)
// ---------------------------------------------------------------------------

function assassinMoves(state: GameState, piece: Piece): LegalMove[] {
  const out: LegalMove[] = [];
  for (const dir of DIRECTIONS) {
    for (let d = 1; d <= 4; d++) {
      const dest = step(piece, dir, d);
      if (!inBounds(dest)) break;

      const crossed = !inTerritory(piece.player, dest.row);
      if (crossed) {
        // DEMOTION: the Assassin may cross its boundary but stops on the FIRST
        // square beyond it and becomes a Spy. It cannot use remaining range.
        // The path up to here was already verified clear (we break on blocks),
        // so evaluate this single square as the terminal move/capture.
        const ev = evalOrdinary(state, piece, dest);
        if (ev.landable) out.push({ to: dest, kind: ev.kind!, note: "demotion" });
        break; // never continue past the boundary
      }

      // Still inside Assassin territory: behave like a long slider.
      const ev = evalOrdinary(state, piece, dest);
      if (ev.landable) out.push({ to: dest, kind: ev.kind! });
      if (ev.blocks) break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Horse (knight jumps)
// ---------------------------------------------------------------------------

const KNIGHT_OFFSETS: ReadonlyArray<Coord> = [
  { col: 1, row: 2 },
  { col: 2, row: 1 },
  { col: 2, row: -1 },
  { col: 1, row: -2 },
  { col: -1, row: -2 },
  { col: -2, row: -1 },
  { col: -2, row: 1 },
  { col: -1, row: 2 },
];

function horseMoves(state: GameState, piece: Piece): LegalMove[] {
  const out: LegalMove[] = [];
  for (const off of KNIGHT_OFFSETS) {
    const dest = { col: piece.col + off.col, row: piece.row + off.row };
    // The Horse jumps intervening squares, so only the landing square matters.
    const ev = evalOrdinary(state, piece, dest);
    if (ev.landable) out.push({ to: dest, kind: ev.kind! });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Guard (orthogonal move, diagonal capture)
// ---------------------------------------------------------------------------

function guardMoves(state: GameState, piece: Piece): LegalMove[] {
  const out: LegalMove[] = [];
  // Orthogonal 1: empty moves only (cannot capture orthogonally).
  for (const dir of ORTHOGONAL) {
    const dest = step(piece, dir, 1);
    const ev = evalOrdinary(state, piece, dest);
    if (ev.landable && ev.kind === "move") out.push({ to: dest, kind: "move" });
  }
  // Diagonal 1: captures only (cannot move diagonally to an empty square).
  for (const dir of DIAGONAL) {
    const dest = step(piece, dir, 1);
    const ev = evalOrdinary(state, piece, dest);
    if (ev.landable && ev.kind === "capture") {
      out.push({ to: dest, kind: "capture" });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Spear (horizontal + diagonal move/capture, flank charge, no backward on flank)
// ---------------------------------------------------------------------------

function spearMoves(state: GameState, piece: Piece): LegalMove[] {
  const out: LegalMove[] = [];
  const fwd = FORWARD_ROW_DELTA[piece.player]; // +1 green, -1 blue
  const onFlank = FLANK_COL_INDICES.has(piece.col);

  // Normal move/capture: exactly 1 square horizontally or diagonally. Pure
  // vertical (straight forward/backward) is NOT a normal move.
  const normalDirs: Coord[] = [
    { col: -1, row: 0 }, // left
    { col: 1, row: 0 }, // right
    { col: -1, row: fwd }, // forward diagonals
    { col: 1, row: fwd },
    { col: -1, row: -fwd }, // backward diagonals
    { col: 1, row: -fwd },
  ];
  for (const dir of normalDirs) {
    const dest = step(piece, dir, 1);
    // No backward movement while on a flank column (blocks backward diagonals).
    if (onFlank && isBackward(piece, dest)) continue;
    const ev = evalOrdinary(state, piece, dest);
    if (ev.landable) out.push({ to: dest, kind: ev.kind! });
  }

  // Flank Charge: only when starting on a flank column. A forward orthogonal
  // charge-capture (assumption #6) against the FIRST enemy up to 4 squares
  // ahead in the same column. Capture only; the path must be clear.
  if (onFlank) {
    const dir = { col: 0, row: fwd };
    for (let d = 1; d <= 4; d++) {
      const dest = step(piece, dir, d);
      if (!inBounds(dest)) break;
      if (isPermanentWall(dest) || isGate(dest) || isInnerCircle(dest)) break;
      const occ = pieceAt(state, dest);
      if (!occ) continue; // empty: charge passes over nothing, keep scanning
      if (occ.player === piece.player) break; // blocked by a friendly piece
      if (reservedBlocksEnd(piece, dest)) break;
      out.push({ to: dest, kind: "capture", note: "flank-charge" });
      break; // captures only the first enemy encountered
    }
  }

  return dedupe(out);
}

/** Is `dest` a backward step for this piece (row moves opposite to facing)? */
function isBackward(piece: Piece, dest: Coord): boolean {
  const fwd = FORWARD_ROW_DELTA[piece.player];
  const rowDelta = dest.row - piece.row;
  return Math.sign(rowDelta) === -Math.sign(fwd);
}

/** Remove duplicate destinations (a charge and a normal capture cannot both
 * land on the same square, but guard against overlap defensively). */
function dedupe(moves: LegalMove[]): LegalMove[] {
  const seen = new Set<string>();
  const out: LegalMove[] = [];
  for (const m of moves) {
    const k = `${m.to.col},${m.to.row}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(m);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/** All legal destinations for the piece currently at `coord`. */
export function legalMovesForPiece(state: GameState, piece: Piece): LegalMove[] {
  if (state.winner) return [];
  // Opening restriction: Green's Engineer/Flag Bearer cannot move on turn 1.
  if (isBlockedByGreenOpening(state, piece)) return [];
  // Forced gate-departure: on the carrier owner's turn the ONLY movable piece is
  // the carrier itself. Opponent pieces are unaffected, so the opposing Flag
  // Bearer may still capture the carrier on the gate (rule 15).
  if (state.forcedGateDeparture && state.flag.carrierId) {
    const carrier = state.pieces.find((p) => p.id === state.flag.carrierId);
    if (carrier && piece.player === carrier.player && piece.id !== carrier.id) {
      return [];
    }
  }
  switch (piece.type) {
    case "flagBearer":
      return flagBearerMoves(state, piece);
    case "engineer":
      return engineerMoves(state, piece);
    case "spy":
      return spyMoves(state, piece);
    case "assassin":
      return assassinMoves(state, piece);
    case "horse":
      return horseMoves(state, piece);
    case "guard":
      return guardMoves(state, piece);
    case "spear":
      return spearMoves(state, piece);
  }
}

/** Legal moves for the piece at a coordinate, or [] if none/empty/not current. */
export function legalMoves(state: GameState, coord: Coord): LegalMove[] {
  const piece = pieceAt(state, coord);
  if (!piece) return [];
  if (piece.player !== state.current) return [];
  return legalMovesForPiece(state, piece);
}

/** Is moving `piece` to `dest` legal in this state? Returns the LegalMove. */
export function findLegalMove(
  state: GameState,
  piece: Piece,
  dest: Coord,
): LegalMove | undefined {
  return legalMovesForPiece(state, piece).find(
    (m) => m.to.col === dest.col && m.to.row === dest.row,
  );
}

export { FLAG_HOME_COORD, fromCoord };
