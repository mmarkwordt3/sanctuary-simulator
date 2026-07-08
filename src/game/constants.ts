// Board geography, starting setup, and the explicit implementation assumptions.
//
// This is the single place the brief's twelve required implementation
// assumptions are encoded, so alternate rule variants could be built by editing
// only this file plus the isolated rule functions in terrain.ts / rules.ts.

import type { PieceType, Player, WallSide } from "./types.ts";
import { key, keySet, toCoord } from "./coords.ts";

// ---------------------------------------------------------------------------
// Flag
// ---------------------------------------------------------------------------

/** The neutral flag's home / reset square. */
export const FLAG_HOME = "G7";

// ---------------------------------------------------------------------------
// Inner circle (Sanctuary) — only Flag Bearers may enter or occupy these.
// ---------------------------------------------------------------------------

export const INNER_CIRCLE = [
  "F6", "G6", "H6",
  "F7", "G7", "H7",
  "F8", "G8", "H8",
];
export const INNER_CIRCLE_KEYS = keySet(INNER_CIRCLE);

// ---------------------------------------------------------------------------
// Permanent ring-wall squares — permanently inaccessible to every piece.
// The Horse may jump over them but may not land on them.
// ---------------------------------------------------------------------------

export const PERMANENT_WALLS = [
  "E5", "E6", "F5",
  "H5", "I5", "I6",
  "E8", "E9", "F9",
  "H9", "I9", "I8",
];
export const PERMANENT_WALL_KEYS = keySet(PERMANENT_WALLS);

// ---------------------------------------------------------------------------
// Gates — only Flag Bearers may enter or occupy these.
// ---------------------------------------------------------------------------

export const GATES = {
  north: "G5",
  west: "E7",
  east: "I7",
  south: "G9",
} as const;

export type GateName = keyof typeof GATES;

export const GATE_KEYS = keySet(Object.values(GATES));

/** Which physical wall (if any) sits on a gate square. */
export const GATE_WALL: Partial<Record<string, WallSide>> = {
  [key(toCoord(GATES.west))]: "west",
  [key(toCoord(GATES.east))]: "east",
};

/**
 * Gate entry/exit direction rules (assumption #9): North and South are
 * entrance-only; a Flag Bearer may leave the inner circle only via the West or
 * East gate. This applies whether laden or unladen.
 */
export const EXIT_GATES: GateName[] = ["west", "east"];

/**
 * Forced gate-departure: a carrier that reaches a side gate must leave it on its
 * owner's next turn, moving only to one of these outward squares (away from the
 * inner circle). West Gate E7 -> D-column; East Gate I7 -> J-column.
 */
export const GATE_DEPARTURE: Record<string, string[]> = {
  [GATES.west]: ["D6", "D7", "D8"], // off E7
  [GATES.east]: ["J6", "J7", "J8"], // off I7
};

// ---------------------------------------------------------------------------
// Cannon zones — lore-based board areas. The interaction is cross-map:
// an Engineer ending in the WEST cannon opens the EAST wall, and vice versa.
// ---------------------------------------------------------------------------

export const WEST_CANNON = ["A6", "A7", "A8"];
export const EAST_CANNON = ["M6", "M7", "M8"];
export const CANNON_KEYS = keySet([...WEST_CANNON, ...EAST_CANNON]);

/** Cannon-zone -> wall it removes. West cannon removes the East wall (I7). */
export const WEST_CANNON_KEYS = keySet(WEST_CANNON);
export const EAST_CANNON_KEYS = keySet(EAST_CANNON);

// ---------------------------------------------------------------------------
// Promotion / demotion boundaries.
// ---------------------------------------------------------------------------

/** Rows (1-indexed) on which a Spy of the given side promotes to Assassin. */
export const PROMOTION_ROWS: Record<Player, number[]> = {
  green: [9, 10],
  blue: [4, 5],
};

/** Rows (1-indexed) that form each side's Assassin territory. */
export const ASSASSIN_TERRITORY: Record<Player, number[]> = {
  green: [9, 10, 11, 12, 13],
  blue: [1, 2, 3, 4, 5],
};

// ---------------------------------------------------------------------------
// Reserved return squares (assumption #5). No piece other than the designated
// returning special piece may END on these squares.
// ---------------------------------------------------------------------------

export const RESERVED = {
  greenFlagBearer: "G1",
  greenEngineer: "G3",
  blueEngineer: "G11",
  blueFlagBearer: "G13",
} as const;

export const RESERVED_KEYS = keySet(Object.values(RESERVED));

/** Home / route-return square for each side's Flag Bearer and Engineer. */
export const HOME_SQUARE: Record<Player, { flagBearer: string; engineer: string }> = {
  green: { flagBearer: RESERVED.greenFlagBearer, engineer: RESERVED.greenEngineer },
  blue: { flagBearer: RESERVED.blueFlagBearer, engineer: RESERVED.blueEngineer },
};

// ---------------------------------------------------------------------------
// Flank columns for Spears.
// ---------------------------------------------------------------------------

export const FLANK_COLUMNS = ["A", "B", "L", "M"];
export const FLANK_COL_INDICES = new Set(
  FLANK_COLUMNS.map((c) => "ABCDEFGHIJKLM".indexOf(c)),
);

// ---------------------------------------------------------------------------
// Facing. Green advances toward increasing row numbers, Blue toward decreasing.
// Expressed as a row delta (in 0-indexed row space, +1 = "forward" for green).
// ---------------------------------------------------------------------------

export const FORWARD_ROW_DELTA: Record<Player, number> = {
  green: 1,
  blue: -1,
};

// ---------------------------------------------------------------------------
// Starting setup.
// ---------------------------------------------------------------------------

export interface SetupEntry {
  type: PieceType;
  player: Player;
  at: string;
}

export const STARTING_SETUP: SetupEntry[] = [
  // Green
  { type: "spear", player: "green", at: "C1" },
  { type: "spy", player: "green", at: "E1" },
  { type: "flagBearer", player: "green", at: "G1" },
  { type: "spy", player: "green", at: "I1" },
  { type: "spear", player: "green", at: "K1" },
  { type: "horse", player: "green", at: "G2" },
  { type: "guard", player: "green", at: "D3" },
  { type: "engineer", player: "green", at: "G3" },
  { type: "guard", player: "green", at: "J3" },
  // Blue
  { type: "guard", player: "blue", at: "D11" },
  { type: "engineer", player: "blue", at: "G11" },
  { type: "guard", player: "blue", at: "J11" },
  { type: "horse", player: "blue", at: "G12" },
  { type: "spear", player: "blue", at: "C13" },
  { type: "spy", player: "blue", at: "E13" },
  { type: "flagBearer", player: "blue", at: "G13" },
  { type: "spy", player: "blue", at: "I13" },
  { type: "spear", player: "blue", at: "K13" },
];

// ---------------------------------------------------------------------------
// Rules constants tied to explicit assumptions.
// ---------------------------------------------------------------------------

/** Assumption #1: Green moves first. */
export const FIRST_PLAYER: Player = "green";

/** Extraction allowance in personal carrier turns (the pickup turn excluded). */
export const EXTRACTION_TURNS = 3;

/** Short display labels for the board. */
export const PIECE_LABEL: Record<PieceType, string> = {
  flagBearer: "FB",
  engineer: "EN",
  spy: "SP",
  assassin: "AS",
  spear: "SR",
  guard: "GD",
  horse: "H",
};

export const PIECE_NAME: Record<PieceType, string> = {
  flagBearer: "Flag Bearer",
  engineer: "Engineer",
  spy: "Spy",
  assassin: "Assassin",
  spear: "Spear",
  guard: "Guard",
  horse: "Horse",
};
