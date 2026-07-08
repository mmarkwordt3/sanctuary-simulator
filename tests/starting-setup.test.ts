import { describe, it, expect } from "vitest";
import { createInitialState } from "../src/game/setup.ts";
import { GameSession } from "../src/game/session.ts";
import { toCoord } from "../src/game/coords.ts";
import { pieceAt } from "../src/game/terrain.ts";
import type { GameState, PieceType, Player } from "../src/game/types.ts";

function typeAt(s: GameState, square: string): PieceType | undefined {
  return pieceAt(s, toCoord(square))?.type;
}
function playerAt(s: GameState, square: string): Player | undefined {
  return pieceAt(s, toCoord(square))?.player;
}

describe("New starting setup", () => {
  it("places every Green piece on its new coordinate", () => {
    const s = createInitialState();
    const expected: Array<[string, PieceType]> = [
      ["C1", "spear"],
      ["K1", "spear"],
      ["E1", "spy"],
      ["I1", "spy"],
      ["G1", "flagBearer"],
      ["G2", "horse"],
      ["D3", "guard"],
      ["J3", "guard"],
      ["G3", "engineer"],
    ];
    for (const [square, type] of expected) {
      expect(typeAt(s, square)).toBe(type);
      expect(playerAt(s, square)).toBe("green");
    }
  });

  it("places every Blue piece on its mirrored new coordinate", () => {
    const s = createInitialState();
    const expected: Array<[string, PieceType]> = [
      ["C13", "spear"],
      ["K13", "spear"],
      ["E13", "spy"],
      ["I13", "spy"],
      ["G13", "flagBearer"],
      ["G12", "horse"],
      ["D11", "guard"],
      ["J11", "guard"],
      ["G11", "engineer"],
    ];
    for (const [square, type] of expected) {
      expect(typeAt(s, square)).toBe(type);
      expect(playerAt(s, square)).toBe("blue");
    }
  });

  it("leaves the old Guard and Spy starting coordinates empty", () => {
    const s = createInitialState();
    for (const square of ["F2", "H2", "F12", "H12"]) {
      expect(pieceAt(s, toCoord(square))).toBeUndefined();
    }
  });

  it("does not alter any terrain coordinates", () => {
    const s = createInitialState();
    expect(s.walls).toEqual({ west: true, east: true });
    expect(s.flag.square).toEqual(toCoord("G7"));
  });

  it("restart and new game restore the new starting position", () => {
    const session = new GameSession();
    session.move({
      pieceId: pieceAt(session.state, toCoord("E1"))!.id,
      to: toCoord("E3"),
    });
    session.restart();
    expect(typeAt(session.state, "D3")).toBe("guard");
    expect(typeAt(session.state, "G3")).toBe("engineer");

    session.move({
      pieceId: pieceAt(session.state, toCoord("E1"))!.id,
      to: toCoord("E3"),
    });
    session.newGame();
    expect(typeAt(session.state, "J3")).toBe("guard");
    expect(typeAt(session.state, "C1")).toBe("spear");
  });
});
