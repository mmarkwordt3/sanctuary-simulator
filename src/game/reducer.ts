// The turn-resolution engine. `applyMove` is a pure function: given a state and
// a move it returns a brand-new state, leaving the input untouched. It follows
// the 15-step resolution order from the brief. Illegal requests return the input
// state unchanged, so the reducer is the final guard against illegal moves.

import type { Coord, GameState, Move, Piece, WallSide } from "./types.ts";
import {
  EXTRACTION_TURNS,
  FLAG_HOME,
} from "./constants.ts";
import { coordEquals, toCoord } from "./coords.ts";
import { cloneState } from "./setup.ts";
import { findLegalMove, legalMovesForPiece } from "./movement.ts";
import {
  bearerCompletedExit,
  bothWallsOpen,
  cannonWallToOpen,
  carrierOf,
  gateSideName,
  homeSquareFor,
  isDemotionRow,
  isExtractionGate,
  isUnladenEntrySquare,
  isVictory,
  shouldPromote,
} from "./rules.ts";
import {
  describeCapture,
  describeMove,
  label,
  playerName,
} from "./notation.ts";
import { fromCoord } from "./coords.ts";

const FLAG_HOME_COORD = toCoord(FLAG_HOME);

function other(p: GameState["current"]): GameState["current"] {
  return p === "green" ? "blue" : "green";
}

/**
 * Resolve a blocked forced gate-departure at the START of the carrier owner's
 * turn (rule 14). If the owner now to move has a carrier stuck on a side gate
 * with no legal outward square, the flag returns to G7, the carrier is routed,
 * and that player's turn ends (play passes back to the opponent). Called after
 * the player switch, so it fires as the owner's turn is entered.
 */
function resolveForcedDeparture(state: GameState): void {
  if (state.winner || !state.forcedGateDeparture) return;
  const carrier = carrierOf(state);
  if (!carrier || carrier.player !== state.current) return;
  if (legalMovesForPiece(state, carrier).length > 0) return; // a departure exists
  state.history.push(
    `${label(carrier)} cannot leave the ${gateSideName(carrier)} Gate; flag returns to G7`,
  );
  routePiece(state, carrier); // resets flag + clears countdown + forced state
  state.current = other(state.current); // the blocked turn is spent
}

function wallName(w: WallSide): string {
  return w === "east" ? "East" : "West";
}

function findAt(state: GameState, c: Coord, exceptId?: string): Piece | undefined {
  return state.pieces.find(
    (p) => p.col === c.col && p.row === c.row && p.id !== exceptId,
  );
}

/**
 * Route a Flag Bearer or Engineer back to its home square. If the piece was
 * carrying the flag, the flag resets to G7 and the extraction countdown clears
 * (assumption #4 for the timeout path; also used when a carrier is captured).
 */
function routePiece(state: GameState, piece: Piece): void {
  const home = homeSquareFor(piece);
  piece.col = home.col;
  piece.row = home.row;
  if (state.flag.carrierId === piece.id) {
    state.flag.carrierId = null;
    state.flag.square = { ...FLAG_HOME_COORD };
    state.extractionTurnsRemaining = null;
    state.forcedGateDeparture = false; // routing always clears forced departure
  }
  // Any legitimate routing of the committed Bearer clears its unladen sequence.
  if (state.unladenSanctuary && state.unladenSanctuary.bearerId === piece.id) {
    state.unladenSanctuary = null;
  }
}

/**
 * Apply a move. Returns a new GameState (input is never mutated). If the move
 * is not legal in `state`, the original state is returned unchanged.
 */
export function applyMove(state: GameState, move: Move): GameState {
  // Steps 1-4: game not over, correct owner, move is legal.
  if (state.winner) return state;
  const source = state.pieces.find((p) => p.id === move.pieceId);
  if (!source) return state;
  if (source.player !== state.current) return state;
  const legal = findLegalMove(state, source, move.to);
  if (!legal) return state;

  const next = cloneState(state);
  const mover = next.pieces.find((p) => p.id === move.pieceId)!;
  const from: Coord = { col: mover.col, row: mover.row };
  const dest: Coord = { ...move.to };
  const events: string[] = [];
  let primary = describeMove(mover, from, dest);

  // Step 5: resolve capture (if the destination held an enemy).
  if (legal.kind === "capture") {
    const target = findAt(next, dest, mover.id);
    if (target) {
      if (target.type === "flagBearer" || target.type === "engineer") {
        // Routing: special pieces are sent home rather than removed.
        routePiece(next, target);
        primary = `${label(mover)} routed ${playerName(target.player)} ${
          target.type === "flagBearer" ? "Flag Bearer" : "Engineer"
        } on ${fromCoord(dest)}`;
      } else {
        // Ordinary capture: permanently remove.
        next.pieces = next.pieces.filter((p) => p.id !== target.id);
        primary = describeCapture(mover, target.type, target.player, dest);
      }
    }
  }

  // Step 6: move the piece.
  mover.col = dest.col;
  mover.row = dest.row;

  // Step 7 already handled inside step 5 (routing of the captured piece).

  // Step 8: flag pickup. Landing on G7 with the flag present takes it and ends
  // movement (assumption #3). The pickup turn does not consume the countdown.
  let pickup = false;
  if (
    mover.type === "flagBearer" &&
    next.flag.carrierId === null &&
    next.flag.square &&
    coordEquals(dest, FLAG_HOME_COORD)
  ) {
    next.flag.carrierId = mover.id;
    next.flag.square = null;
    next.extractionTurnsRemaining = EXTRACTION_TURNS;
    pickup = true;
    events.push(
      `${label(mover)} took the flag; ${EXTRACTION_TURNS} extraction turns remain`,
    );
  }

  // Step 9: Spy promotion / Assassin demotion (after movement + capture).
  if (mover.type === "spy" && shouldPromote(mover.player, mover.row)) {
    mover.type = "assassin";
    events.push(`${playerName(mover.player)} Spy promoted on ${fromCoord(dest)}`);
  } else if (mover.type === "assassin" && isDemotionRow(mover.player, mover.row)) {
    mover.type = "spy";
    events.push(`${playerName(mover.player)} Assassin demoted on ${fromCoord(dest)}`);
  }

  // Steps 10-11: Cannon wall removal + second-wall Engineer removal.
  if (mover.type === "engineer") {
    const wall = cannonWallToOpen(next, dest);
    if (wall) {
      next.walls[wall] = false; // open permanently; nothing ever re-closes it
      events.push(`${label(mover)} reached ${fromCoord(dest)}; ${wallName(wall)} Wall removed`);
      if (bothWallsOpen(next)) {
        // Second wall: BOTH Engineers leave the game immediately (assumption #12).
        next.pieces = next.pieces.filter((p) => p.type !== "engineer");
        next.engineersRemoved = true;
        events.push("The second wall is open; both Engineers are removed from play");
      } else {
        // First wall: the opening Engineer is routed to its start.
        routePiece(next, mover);
        events.push(`${label(mover)} returned to ${fromCoord(homeSquareFor(mover))}`);
      }
    }
  }

  // Unladen Sanctuary buffer/decision state machine (resolved after the move's
  // normal effects, before the laden countdown). Branch on the state as it was
  // at the start of this block so the entry turn never doubles as the buffer turn.
  const us = next.unladenSanctuary;
  if (us === null) {
    // Fresh entry: an unladen Flag Bearer that ended on an inner square other
    // than G7 (landing on G7 is a pickup, already resolved above).
    if (
      mover.type === "flagBearer" &&
      next.flag.carrierId !== mover.id &&
      isUnladenEntrySquare({ col: mover.col, row: mover.row })
    ) {
      next.unladenSanctuary = {
        player: mover.player,
        bearerId: mover.id,
        stage: "bufferPending",
      };
      events.push(`${label(mover)} entered the Sanctuary (buffer turn granted)`);
    }
  } else if (mover.player === us.player) {
    // The owner's buffer or decision turn.
    const bearer = next.pieces.find((p) => p.id === us.bearerId);
    const collected = !!bearer && next.flag.carrierId === bearer.id;
    const exited = !!bearer && bearerCompletedExit({ col: bearer.col, row: bearer.row });
    if (us.stage === "bufferPending") {
      if (collected || exited) {
        next.unladenSanctuary = null; // resolved during the buffer turn
      } else {
        next.unladenSanctuary = { ...us, stage: "decisionPending" };
      }
    } else {
      // decisionPending
      if (collected || exited) {
        next.unladenSanctuary = null;
      } else if (bearer) {
        // The Bearer neither collected nor completely exited: route it home.
        // (Uses standard routing + reserved home; the flag is unmoved because the
        // Bearer is still unladen.)
        routePiece(next, bearer);
        events.push(
          `${label(bearer)} failed to leave the Sanctuary and was routed to ${fromCoord(homeSquareFor(bearer))}`,
        );
        next.unladenSanctuary = null;
      } else {
        next.unladenSanctuary = null;
      }
    }
  }
  // An opponent turn never advances or clears the sequence.

  // Step 12: extraction countdown & forced gate-departure.
  //
  // The countdown belongs to the PLAYER who owns the carrier and is processed
  // once at the end of each of that player's post-pickup turns — regardless of
  // which friendly piece moved. It is never touched on the pickup turn or on an
  // opponent's turn.
  const carrier = next.flag.carrierId
    ? next.pieces.find((p) => p.id === next.flag.carrierId)
    : undefined;

  if (next.forcedGateDeparture && carrier && mover.id === carrier.id) {
    // The owner just moved the carrier off the side gate — the only legal action
    // during forced departure. Resume normal play; do NOT restart the countdown.
    next.forcedGateDeparture = false;
    events.push(`${label(mover)} departed the gate`);
  } else if (
    carrier &&
    !pickup &&
    next.extractionTurnsRemaining !== null &&
    mover.player === carrier.player
  ) {
    // Check successful arrival BEFORE decrementing so the carrier may reach a
    // side gate on the third and final allowed turn.
    if (isExtractionGate(carrier)) {
      next.extractionTurnsRemaining = null;
      next.forcedGateDeparture = true;
      events.push(
        `${label(carrier)} reached the ${gateSideName(carrier)} Gate; it must depart next turn`,
      );
    } else {
      const remaining = next.extractionTurnsRemaining - 1;
      if (remaining <= 0) {
        // Timeout: return the flag to G7 and route the carrier home.
        events.push(`${label(carrier)} ran out of extraction turns; flag returns to G7`);
        routePiece(next, carrier);
      } else {
        next.extractionTurnsRemaining = remaining;
      }
    }
  }

  // Step 13: victory — a carrier reaching its home square wins.
  if (next.flag.carrierId === mover.id && isVictory(mover.player, dest)) {
    next.winner = mover.player;
    events.push(`${playerName(mover.player)} wins — the flag has been returned home!`);
  }

  // Record the last completed move (logical coordinates) for the board highlight.
  next.lastMove = { from: { ...from }, to: { ...dest } };

  // Step 14: append history (primary line, then any consequence events).
  next.history.push(primary, ...events);

  // Step 15: switch player unless the game is over.
  if (!next.winner) next.current = other(next.current);

  // Step 15b: if the (new) player to move has a carrier stuck on a gate with no
  // legal departure, auto-resolve it at the start of their turn (rule 14).
  resolveForcedDeparture(next);

  return next;
}
