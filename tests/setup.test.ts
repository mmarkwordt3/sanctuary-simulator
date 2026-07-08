import { describe, it, expect } from "vitest";
import { createInitialState } from "../src/game/setup.ts";
import { BOARD_SIZE, fromCoord, toCoord } from "../src/game/coords.ts";
import { PERMANENT_WALLS, STARTING_SETUP } from "../src/game/constants.ts";
import { legalMoves } from "../src/game/movement.ts";
import { pieceAt } from "../src/game/terrain.ts";

describe("board & setup", () => {
  it("has 169 coordinates", () => {
    let count = 0;
    for (let col = 0; col < BOARD_SIZE; col++) {
      for (let row = 0; row < BOARD_SIZE; row++) {
        expect(fromCoord({ col, row })).toMatch(/^[A-M]\d{1,2}$/);
        count++;
      }
    }
    expect(count).toBe(169);
  });

  it("round-trips algebraic coordinates", () => {
    expect(fromCoord(toCoord("A1"))).toBe("A1");
    expect(fromCoord(toCoord("M13"))).toBe("M13");
    expect(fromCoord(toCoord("G7"))).toBe("G7");
  });

  it("starting coordinates are unique", () => {
    const squares = STARTING_SETUP.map((s) => s.at);
    expect(new Set(squares).size).toBe(squares.length);
  });

  it("places the correct 18 initial pieces", () => {
    const state = createInitialState();
    expect(state.pieces).toHaveLength(18);
    // Each side: 1 FB, 1 EN, 2 Spy, 2 Spear, 2 Guard, 1 Horse = 9.
    for (const player of ["green", "blue"] as const) {
      const mine = state.pieces.filter((p) => p.player === player);
      expect(mine).toHaveLength(9);
      const counts = mine.reduce<Record<string, number>>((acc, p) => {
        acc[p.type] = (acc[p.type] ?? 0) + 1;
        return acc;
      }, {});
      expect(counts).toEqual({
        flagBearer: 1,
        engineer: 1,
        spy: 2,
        spear: 2,
        guard: 2,
        horse: 1,
      });
    }
  });

  it("all 12 permanent walls are inaccessible (no piece can enter/pass)", () => {
    expect(PERMANENT_WALLS).toHaveLength(12);
    const state = createInitialState();
    // No legal move (for any piece, either side) ends on a permanent wall.
    const wallKeys = new Set(PERMANENT_WALLS);
    for (const piece of state.pieces) {
      const cur = { ...state, current: piece.player };
      for (const m of legalMoves(cur, { col: piece.col, row: piece.row })) {
        expect(wallKeys.has(fromCoord(m.to))).toBe(false);
      }
    }
  });

  it("east & west walls begin closed", () => {
    const state = createInitialState();
    expect(state.walls.west).toBe(true);
    expect(state.walls.east).toBe(true);
  });

  it("flag begins at G7", () => {
    const state = createInitialState();
    expect(state.flag.carrierId).toBeNull();
    expect(state.flag.square).toEqual(toCoord("G7"));
    expect(pieceAt(state, toCoord("G7"))).toBeUndefined();
  });

  it("green begins", () => {
    expect(createInitialState().current).toBe("green");
  });
});
