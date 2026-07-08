// Visual board orientation for local pass-and-play.
//
// This is a RENDERING-ONLY transform. It never touches the GameState or the
// internal coordinate system — it only decides the order in which existing
// squares are laid out on screen, so the player to move always sees their home
// row at the bottom. Green: row 1 (its home) at the bottom, columns A→M. Blue:
// the whole view rotated 180° — row 13 at the bottom, columns M→A. Because the
// squares are reordered (not CSS-rotated), piece labels stay upright.

import type { Player } from "../game/types.ts";
import { BOARD_SIZE, COLUMNS } from "../game/coords.ts";

/** Internal row indices (0 = row 1 … 12 = row 13) ordered top → bottom. */
export function getDisplayRows(active: Player): number[] {
  const ascending = Array.from({ length: BOARD_SIZE }, (_, i) => i);
  // Green sees row 1 at the bottom → rows descend from 13 (top) to 1 (bottom).
  // Blue's view is rotated 180° → rows ascend from 1 (top) to 13 (bottom).
  return active === "green" ? ascending.slice().reverse() : ascending;
}

/** Internal column indices (0 = A … 12 = M) ordered left → right. */
export function getDisplayColumns(active: Player): number[] {
  const ascending = Array.from({ length: BOARD_SIZE }, (_, i) => i);
  // Green shows A→M; Blue's 180° rotation shows M→A.
  return active === "green" ? ascending : ascending.slice().reverse();
}

export interface BoardDisplayModel {
  /** Internal row indices, top → bottom. */
  rows: number[];
  /** Internal column indices, left → right. */
  columns: number[];
  /** Coordinate labels for `rows` (e.g. "13" … "1" for Green). */
  rowLabels: string[];
  /** Coordinate labels for `columns` (e.g. "A" … "M" for Green). */
  columnLabels: string[];
}

/** Full display model (order + matching coordinate labels) for the active side. */
export function getBoardDisplayModel(active: Player): BoardDisplayModel {
  const rows = getDisplayRows(active);
  const columns = getDisplayColumns(active);
  return {
    rows,
    columns,
    rowLabels: rows.map((r) => String(r + 1)),
    columnLabels: columns.map((c) => COLUMNS[c]),
  };
}
