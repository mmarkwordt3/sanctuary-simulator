// Coordinate utilities. All string <-> {col,row} parsing lives here so the rest
// of the code never touches algebraic-notation string manipulation directly.

import type { Coord } from "./types.ts";

export const BOARD_SIZE = 13;
export const COLUMNS = "ABCDEFGHIJKLM"; // 13 columns, A..M

/** Convert algebraic notation (e.g. "G7") to a Coord. Throws if malformed. */
export function toCoord(algebraic: string): Coord {
  const match = /^([A-M])(\d{1,2})$/.exec(algebraic.trim().toUpperCase());
  if (!match) {
    throw new Error(`Invalid coordinate: "${algebraic}"`);
  }
  const col = COLUMNS.indexOf(match[1]);
  const row = Number(match[2]) - 1;
  if (col < 0 || row < 0 || row >= BOARD_SIZE) {
    throw new Error(`Coordinate out of range: "${algebraic}"`);
  }
  return { col, row };
}

/** Convert a Coord back to algebraic notation (e.g. {col:6,row:6} -> "G7"). */
export function fromCoord(c: Coord): string {
  return `${COLUMNS[c.col]}${c.row + 1}`;
}

/** Alias used in UI/notation for readability. */
export const algebraic = fromCoord;

/** Is the coordinate on the board? */
export function inBounds(c: Coord): boolean {
  return c.col >= 0 && c.col < BOARD_SIZE && c.row >= 0 && c.row < BOARD_SIZE;
}

/** Structural equality for coordinates. */
export function coordEquals(a: Coord, b: Coord): boolean {
  return a.col === b.col && a.row === b.row;
}

/** Stable string key for a coordinate, handy for Set/Map membership. */
export function key(c: Coord): string {
  return `${c.col},${c.row}`;
}

/** Build a Set of keys from an array of algebraic strings. */
export function keySet(algebraics: string[]): Set<string> {
  return new Set(algebraics.map((a) => key(toCoord(a))));
}

/** The 8 unit direction vectors (orthogonal + diagonal). */
export const DIRECTIONS: ReadonlyArray<Coord> = [
  { col: 0, row: -1 },
  { col: 1, row: -1 },
  { col: 1, row: 0 },
  { col: 1, row: 1 },
  { col: 0, row: 1 },
  { col: -1, row: 1 },
  { col: -1, row: 0 },
  { col: -1, row: -1 },
];

export const ORTHOGONAL: ReadonlyArray<Coord> = [
  { col: 0, row: -1 },
  { col: 1, row: 0 },
  { col: 0, row: 1 },
  { col: -1, row: 0 },
];

export const DIAGONAL: ReadonlyArray<Coord> = [
  { col: 1, row: -1 },
  { col: 1, row: 1 },
  { col: -1, row: 1 },
  { col: -1, row: -1 },
];

/** Add a direction vector to a coordinate. */
export function step(c: Coord, dir: Coord, n = 1): Coord {
  return { col: c.col + dir.col * n, row: c.row + dir.row * n };
}

/** Sign of a number, as -1 | 0 | 1. */
export function sign(n: number): number {
  return n > 0 ? 1 : n < 0 ? -1 : 0;
}
