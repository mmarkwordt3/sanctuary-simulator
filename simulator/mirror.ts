import { fromCoord, toCoord } from "../src/game/coords.ts";
import type { Coord, GameState, Move, Piece } from "../src/game/types.ts";

const MIRROR_PIECE_NUMBERS = new Set(["spy", "spear", "guard"]);
const COLS = "ABCDEFGHIJKLM";

export function mirrorCoord(c: Coord): Coord {
  return { col: 12 - c.col, row: c.row };
}

export function mirrorSquare(square: string): string {
  return fromCoord(mirrorCoord(toCoord(square)));
}

export function mirrorPieceId(id: string): string {
  const parts = id.split("-");
  if (parts.length !== 3) return id;
  const [player, type, n] = parts;
  if (!MIRROR_PIECE_NUMBERS.has(type)) return id;
  if (n === "1") return `${player}-${type}-2`;
  if (n === "2") return `${player}-${type}-1`;
  return id;
}

export function mirrorPiece(piece: Piece): Piece {
  const c = mirrorCoord(piece);
  return { ...piece, id: mirrorPieceId(piece.id), col: c.col, row: c.row };
}

export function mirrorMove(move: Move): Move {
  return { pieceId: mirrorPieceId(move.pieceId), to: mirrorCoord(move.to) };
}

export function mirrorState(state: GameState): GameState {
  return {
    ...structuredClone(state),
    pieces: state.pieces.map(mirrorPiece),
    walls: { west: state.walls.east, east: state.walls.west },
    flag: {
      square: state.flag.square ? mirrorCoord(state.flag.square) : null,
      carrierId: state.flag.carrierId ? mirrorPieceId(state.flag.carrierId) : null,
    },
    unladenSanctuary: state.unladenSanctuary
      ? { ...state.unladenSanctuary, bearerId: mirrorPieceId(state.unladenSanctuary.bearerId) }
      : null,
    lastMove: state.lastMove
      ? { from: mirrorCoord(state.lastMove.from), to: mirrorCoord(state.lastMove.to) }
      : null,
  };
}

export function canonicalPieceId(id: string): string {
  return [id, mirrorPieceId(id)].sort()[0];
}

export function canonicalCoord(c: Coord): string {
  const a = fromCoord(c);
  const b = fromCoord(mirrorCoord(c));
  return [a, b].sort()[0];
}

export function mirrorInvariantMoveKey(state: GameState, move: Move): string {
  const piece = state.pieces.find((p) => p.id === move.pieceId);
  const from = piece ? canonicalCoord(piece) : "??";
  return `${canonicalPieceId(move.pieceId)}:${from}->${canonicalCoord(move.to)}`;
}

export function moveLabel(state: GameState, move: Move): string {
  const piece = state.pieces.find((p) => p.id === move.pieceId);
  return `${move.pieceId}:${piece ? fromCoord(piece) : "??"}-${fromCoord(move.to)}`;
}

export function canonicalMoveLabel(state: GameState, move: Move): string {
  const label = moveLabel(state, move);
  const mirrored = moveLabel(mirrorState(state), mirrorMove(move));
  return [label, mirrored].sort()[0];
}

export function mirrorLabel(label: string): string {
  return label.replace(/([A-M])(\d+)/g, (_m, col: string, row: string) => `${COLS[12 - COLS.indexOf(col)]}${row}`)
    .replace(/(green|blue)-(spy|spear|guard)-([12])/g, (_m, player: string, type: string, n: string) => `${player}-${type}-${n === "1" ? "2" : "1"}`);
}

export function canonicalLabel(label: string): string {
  return [label, mirrorLabel(label)].sort()[0];
}
