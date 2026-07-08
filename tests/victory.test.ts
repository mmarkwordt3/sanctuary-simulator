import { describe, it, expect } from "vitest";
import { makeState, piece, move } from "./helpers.ts";
import { createInitialState } from "../src/game/setup.ts";
import { applyMove } from "../src/game/reducer.ts";
import { toCoord } from "../src/game/coords.ts";

describe("Victory", () => {
  it("Green wins when its carrier reaches G1", () => {
    const fb = piece("flagBearer", "green", "G2");
    const s = makeState([fb], {
      flag: { square: null, carrierId: fb.id },
      extractionTurnsRemaining: null, // already extracted
    });
    const after = move(s, "G2", "G1");
    expect(after.winner).toBe("green");
    expect(after.history.some((h) => /wins/.test(h))).toBe(true);
  });

  it("Blue wins when its carrier reaches G13", () => {
    const fb = piece("flagBearer", "blue", "G12");
    const s = makeState([fb], {
      current: "blue",
      flag: { square: null, carrierId: fb.id },
      extractionTurnsRemaining: null,
    });
    const after = move(s, "G12", "G13");
    expect(after.winner).toBe("blue");
  });

  it("does not switch player after a win and rejects further moves", () => {
    const fb = piece("flagBearer", "green", "G2");
    const other = piece("spy", "blue", "C7");
    const s = makeState([fb, other], {
      flag: { square: null, carrierId: fb.id },
      extractionTurnsRemaining: null,
    });
    const won = move(s, "G2", "G1");
    expect(won.winner).toBe("green");
    expect(won.current).toBe("green"); // unchanged
    // Any subsequent move is rejected (state reference is returned unchanged).
    const p = won.pieces.find((x) => x.type === "spy")!;
    expect(applyMove(won, { pieceId: p.id, to: toCoord("C6") })).toBe(won);
  });

  it("rejects illegal moves by returning the same state reference", () => {
    const s = createInitialState();
    const spy = s.pieces.find((p) => p.type === "spy" && p.player === "green")!;
    // Spies move at most 2 — a 5-square jump is illegal.
    expect(applyMove(s, { pieceId: spy.id, to: toCoord("C6") })).toBe(s);
  });

  it("rejects moving the wrong player's piece", () => {
    const s = createInitialState(); // green to move
    const blueSpy = s.pieces.find((p) => p.type === "spy" && p.player === "blue")!;
    expect(applyMove(s, { pieceId: blueSpy.id, to: toCoord("C11") })).toBe(s);
  });
});
