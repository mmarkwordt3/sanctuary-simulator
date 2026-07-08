import { describe, it, expect } from "vitest";
import { GameSession } from "../src/game/session.ts";
import { makeState, piece } from "./helpers.ts";
import { toCoord } from "../src/game/coords.ts";
import type { GameState } from "../src/game/types.ts";

function idAt(state: GameState, square: string): string {
  const c = toCoord(square);
  const p = state.pieces.find((x) => x.col === c.col && x.row === c.row);
  if (!p) throw new Error(`no piece at ${square}`);
  return p.id;
}

describe("Undo restores full state", () => {
  it("restores a plain move (including turn and history)", () => {
    const session = new GameSession();
    const before = structuredClone(session.state);
    const spy = idAt(session.state, "E1");
    expect(session.move({ pieceId: spy, to: toCoord("E3") })).toBe(true);
    expect(session.state.current).toBe("blue");
    expect(session.undo()).toBe(true);
    expect(session.state).toEqual(before);
  });

  it("restores walls and a routed Engineer after a wall opening", () => {
    const session = new GameSession(
      makeState([piece("engineer", "green", "B7")]),
    );
    const before = structuredClone(session.state);
    session.move({ pieceId: idAt(session.state, "B7"), to: toCoord("A7") });
    expect(session.state.walls.east).toBe(false);
    session.undo();
    expect(session.state).toEqual(before);
    expect(session.state.walls.east).toBe(true);
  });

  it("restores both Engineers after a second-wall removal", () => {
    const session = new GameSession(
      makeState([piece("engineer", "green", "L7"), piece("engineer", "blue", "F11")], {
        walls: { west: true, east: false },
      }),
    );
    const before = structuredClone(session.state);
    session.move({ pieceId: idAt(session.state, "L7"), to: toCoord("M7") });
    expect(session.state.engineersRemoved).toBe(true);
    expect(session.state.pieces.filter((p) => p.type === "engineer")).toHaveLength(0);
    session.undo();
    expect(session.state).toEqual(before);
    expect(session.state.pieces.filter((p) => p.type === "engineer")).toHaveLength(2);
  });

  it("restores a demoted Assassin and a captured piece", () => {
    const session = new GameSession(
      makeState([piece("assassin", "green", "C9"), piece("guard", "blue", "C8")]),
    );
    const before = structuredClone(session.state);
    session.move({ pieceId: idAt(session.state, "C9"), to: toCoord("C8") });
    expect(session.state.pieces.find((p) => p.type === "guard")).toBeUndefined();
    session.undo();
    expect(session.state).toEqual(before);
    expect(session.state.pieces.find((p) => p.type === "guard")).toBeDefined();
    expect(session.state.pieces.find((p) => p.type === "assassin")).toBeDefined();
  });

  it("restores flag, carrier and countdown after a pickup", () => {
    const session = new GameSession(makeState([piece("flagBearer", "green", "G6")]));
    const before = structuredClone(session.state);
    session.move({ pieceId: idAt(session.state, "G6"), to: toCoord("G7") });
    expect(session.state.flag.carrierId).not.toBeNull();
    expect(session.state.extractionTurnsRemaining).toBe(3);
    session.undo();
    expect(session.state).toEqual(before);
    expect(session.state.flag.carrierId).toBeNull();
    expect(session.state.extractionTurnsRemaining).toBeNull();
  });

  it("restores the pre-win state including winner=null", () => {
    const fb = piece("flagBearer", "green", "G2");
    const session = new GameSession(
      makeState([fb], { flag: { square: null, carrierId: fb.id }, extractionTurnsRemaining: null }),
    );
    const before = structuredClone(session.state);
    session.move({ pieceId: fb.id, to: toCoord("G1") });
    expect(session.state.winner).toBe("green");
    session.undo();
    expect(session.state).toEqual(before);
    expect(session.state.winner).toBeNull();
  });

  it("cannot undo past the start", () => {
    const session = new GameSession();
    expect(session.canUndo()).toBe(false);
    expect(session.undo()).toBe(false);
  });

  it("serializes and restores a full session", () => {
    const session = new GameSession();
    session.move({ pieceId: idAt(session.state, "E1"), to: toCoord("E3") });
    const restored = GameSession.deserialize(session.serialize());
    expect(restored.state).toEqual(session.state);
    expect(restored.canUndo()).toBe(true);
  });
});
