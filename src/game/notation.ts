// Human-readable history formatting. Produces the sentence-style log entries
// shown in the brief's examples (e.g. "Green Spy C1 → D2").

import type { Piece, PieceType, Player } from "./types.ts";
import { PIECE_NAME } from "./constants.ts";
import { fromCoord } from "./coords.ts";
import type { Coord } from "./types.ts";

export function playerName(p: Player): string {
  return p === "green" ? "Green" : "Blue";
}

export function pieceName(type: PieceType): string {
  return PIECE_NAME[type];
}

/** "Green Spy" style label for a piece. */
export function label(piece: Piece): string {
  return `${playerName(piece.player)} ${pieceName(piece.type)}`;
}

/** Base move description: "Green Spy C1 → D2". */
export function describeMove(
  piece: Piece,
  from: Coord,
  to: Coord,
): string {
  return `${playerName(piece.player)} ${pieceName(piece.type)} ${fromCoord(from)} → ${fromCoord(to)}`;
}

export function describeCapture(
  attacker: Piece,
  victimType: PieceType,
  victimPlayer: Player,
  at: Coord,
): string {
  return `${label(attacker)} captured ${playerName(victimPlayer)} ${pieceName(victimType)} on ${fromCoord(at)}`;
}
