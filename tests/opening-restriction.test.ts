import { describe, it, expect } from "vitest";
import { createInitialState } from "../src/game/setup.ts";
import { GameSession } from "../src/game/session.ts";
import { allTargets, move } from "./helpers.ts";
import { toCoord } from "../src/game/coords.ts";
import type { GameState } from "../src/game/types.ts";

function idAt(s: GameState, square: string): string {
  const c = toCoord(square);
  return s.pieces.find((p) => p.col === c.col && p.row === c.row)!.id;
}

describe("Green opening restriction", () => {
  it("Green Engineer has no legal moves on Green's first turn", () => {
    expect(allTargets(createInitialState(), "G3")).toEqual([]);
  });

  it("Green Flag Bearer has no legal moves on Green's first turn", () => {
    expect(allTargets(createInitialState(), "G1")).toEqual([]);
  });

  it("Green Horse, Guards, Spears and Spies keep their normal first moves", () => {
    const s = createInitialState();
    for (const square of ["G2", "D3", "J3", "E1", "I1", "C1", "K1"]) {
      expect(allTargets(s, square).length).toBeGreaterThan(0);
    }
  });

  it("clicking a restricted piece cannot produce a move (reducer rejects it)", () => {
    const s = createInitialState();
    // Engine-level: attempting to move the Green Engineer returns the same state.
    const after = move(s, "G3", "G4");
    expect(after).toBe(s);
  });

  it("Green Engineer and Flag Bearer move normally on Green's second turn", () => {
    let s = createInitialState();
    s = move(s, "E1", "E3"); // Green's first move (a Spy) — lifts the restriction
    s = move(s, "E13", "E11"); // Blue takes a turn (a Spy move)
    expect(s.current).toBe("green");
    expect(allTargets(s, "G3").length).toBeGreaterThan(0); // Engineer now moves
    expect(allTargets(s, "G1").length).toBeGreaterThan(0); // Flag Bearer now moves
  });

  it("Blue Engineer and Flag Bearer are unrestricted on Blue's first turn", () => {
    let s = createInitialState();
    s = move(s, "E1", "E3"); // Green's first move -> Blue to move
    expect(s.current).toBe("blue");
    expect(allTargets(s, "G11").length).toBeGreaterThan(0); // Blue Engineer
    expect(allTargets(s, "G13").length).toBeGreaterThan(0); // Blue Flag Bearer
  });

  it("restart restores the Green first-turn restriction", () => {
    const session = new GameSession();
    session.move({ pieceId: idAt(session.state, "E1"), to: toCoord("E3") });
    expect(allTargets(session.state, "G11").length).toBeGreaterThan(0); // no restriction now
    session.restart();
    expect(allTargets(session.state, "G3")).toEqual([]);
    expect(allTargets(session.state, "G1")).toEqual([]);
  });

  it("undo back to the opening re-applies the restriction", () => {
    const session = new GameSession();
    session.move({ pieceId: idAt(session.state, "E1"), to: toCoord("E3") });
    session.undo();
    expect(allTargets(session.state, "G3")).toEqual([]);
  });
});
