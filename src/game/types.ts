// Core type definitions for Sanctuary.
//
// Everything here is plain data so that a GameState can be structurally cloned
// and serialized (JSON) without loss. That guarantee is what makes reliable
// undo possible: an undo is simply "restore a previous serialized snapshot".

/** The two players. Green begins at the top, Blue at the bottom. */
export type Player = "green" | "blue";

/**
 * Piece kinds. `spy` and `assassin` are two states of the same physical piece
 * (a Spy promotes into an Assassin and an Assassin demotes back into a Spy).
 */
export type PieceType =
  | "flagBearer"
  | "engineer"
  | "spy"
  | "assassin"
  | "spear"
  | "guard"
  | "horse";

/** A board square, 0-indexed. col 0 = column A, row 0 = row 1. */
export interface Coord {
  col: number; // 0..12  (A..M)
  row: number; // 0..12  (1..13)
}

/** A single piece on the board. `id` is stable across a game for the UI/undo. */
export interface Piece {
  id: string;
  type: PieceType;
  player: Player;
  col: number;
  row: number;
}

/** Which physical wall a gate square carries. */
export type WallSide = "west" | "east";

/**
 * Full, serializable game state. No functions, no DOM references, no Maps with
 * object keys — everything is a primitive, array, or plain object so that
 * `structuredClone` / JSON round-trips it exactly.
 */
export interface GameState {
  /** All pieces currently on the board, keyed by id for stable lookup. */
  pieces: Piece[];

  /** Whose turn it is. */
  current: Player;

  /**
   * Wall state. A closed wall blocks its gate square entirely. Once a wall is
   * opened it never closes again (see reducer — no code path re-closes a wall).
   */
  walls: {
    west: boolean; // true = West Wall still blocks E7
    east: boolean; // true = East Wall still blocks I7
  };

  /**
   * Flag location. If `carrierId` is set, the flag is being carried and
   * `square` is null. Otherwise `square` holds its resting coordinate (G7 at
   * the start, or wherever a routed carrier dropped it — always G7 per rules).
   */
  flag: {
    square: Coord | null;
    carrierId: string | null;
  };

  /**
   * Remaining extraction turns for the player who owns the carrier. Null when
   * nobody is carrying (or once the carrier has reached a side gate). Set to 3
   * on pickup; the pickup turn itself does not count, and it decrements once at
   * the end of every completed turn by the carrier's owner thereafter.
   */
  extractionTurnsRemaining: number | null;

  /**
   * True while the carrier occupies an extraction gate (E7 or I7) and must be
   * moved off it on its owner's next turn. While set, the countdown is null and
   * the owner may move only the carrier, and only to the legal outward squares.
   */
  forcedGateDeparture: boolean;

  /**
   * Tracks an UNLADEN Flag Bearer that has entered the Sanctuary. The owner gets
   * one normal "buffer" turn and then one normal "decision" turn to collect the
   * flag at G7 or retreat completely out of an open gate; after the decision turn
   * the Bearer is routed if it has done neither. Null when no such sequence is
   * active. Only one may be active at a time (single Sanctuary occupancy).
   */
  unladenSanctuary: UnladenSanctuary | null;

  /**
   * Origin and destination of the most recently completed move, for the
   * last-move board highlight. Null before any move. Stored as logical board
   * coordinates so it stays correct across board rotation.
   */
  lastMove: { from: Coord; to: Coord } | null;

  /**
   * Whether each side's Engineer has been permanently removed from play (this
   * happens when the second Cannon wall opens — both Engineers leave the game).
   */
  engineersRemoved: boolean;

  /** Winner, or null if the game is still in progress. */
  winner: Player | null;

  /** Human-readable move/event log, oldest first. */
  history: string[];
}

/** Stage of the unladen Sanctuary sequence (see GameState.unladenSanctuary). */
export type UnladenSanctuaryStage = "bufferPending" | "decisionPending";

/** Serializable record of an active unladen Sanctuary sequence. */
export interface UnladenSanctuary {
  player: Player;
  bearerId: string;
  stage: UnladenSanctuaryStage;
}

/** A move request: which piece, and where it is going. */
export interface Move {
  pieceId: string;
  to: Coord;
}

/** Classification of a candidate destination for UI highlighting. */
export type MoveKind = "move" | "capture";

/** A legal destination produced by the movement generator. */
export interface LegalMove {
  to: Coord;
  kind: MoveKind;
  /**
   * Optional note describing a special consequence, used by movement code and
   * surfaced in tooltips (e.g. "demotion", "flank-charge", "pickup").
   */
  note?: string;
}
