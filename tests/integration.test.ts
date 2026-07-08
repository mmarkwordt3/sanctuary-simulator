import { describe, it, expect } from "vitest";
import { GameSession } from "../src/game/session.ts";
import { makeState, piece } from "./helpers.ts";
import { toCoord, fromCoord } from "../src/game/coords.ts";
import type { GameState } from "../src/game/types.ts";

function idAt(s: GameState, square: string): string {
  const c = toCoord(square);
  const p = s.pieces.find((x) => x.col === c.col && x.row === c.row)!;
  return p.id;
}
function coordOf(s: GameState, id: string): string {
  const p = s.pieces.find((x) => x.id === id)!;
  return fromCoord(p);
}

describe("Acceptance: full flag run over real alternating turns", () => {
  it("enters, picks up, and secures extraction through a side gate", () => {
    // Green Flag Bearer just outside the West gate; West wall already open.
    // A blue Guard provides tempo moves so turns alternate realistically.
    const gfb = piece("flagBearer", "green", "D7");
    const bg = piece("guard", "blue", "A10");
    const session = new GameSession(
      makeState([gfb, bg], { walls: { west: false, east: true } }),
    );
    const G = gfb.id;

    // 1. Green enters the Sanctuary through the open West gate (D7 -> F7).
    expect(session.move({ pieceId: G, to: toCoord("F7") })).toBe(true);
    expect(coordOf(session.state, G)).toBe("F7");

    // Blue tempo.
    session.move({ pieceId: idAt(session.state, "A10"), to: toCoord("A11") });

    // 2. Green takes the flag at G7.
    expect(session.move({ pieceId: G, to: toCoord("G7") })).toBe(true);
    expect(session.state.flag.carrierId).toBe(G);
    expect(session.state.extractionTurnsRemaining).toBe(3);

    session.move({ pieceId: idAt(session.state, "A11"), to: toCoord("A10") });

    // 3. Carrier move 1 (laden, 1 square): G7 -> F7. Countdown 3 -> 2.
    expect(session.move({ pieceId: G, to: toCoord("F7") })).toBe(true);
    expect(session.state.extractionTurnsRemaining).toBe(2);

    session.move({ pieceId: idAt(session.state, "A10"), to: toCoord("A11") });

    // 4. Carrier move 2: F7 -> E7 (reaches the side gate). Extraction secured.
    expect(session.move({ pieceId: G, to: toCoord("E7") })).toBe(true);
    expect(session.state.extractionTurnsRemaining).toBeNull();
    expect(session.state.flag.carrierId).toBe(G); // still carrying

    session.move({ pieceId: idAt(session.state, "A11"), to: toCoord("A10") });

    // 5. Exit fully onto the outside board (E7 -> D7). No timeout risk now.
    expect(session.move({ pieceId: G, to: toCoord("D7") })).toBe(true);
    expect(coordOf(session.state, G)).toBe("D7");
    expect(session.state.flag.carrierId).toBe(G);
    expect(session.state.winner).toBeNull();
  });

  it("full sequence is undoable back to the opening position", () => {
    const gfb = piece("flagBearer", "green", "D7");
    const bg = piece("guard", "blue", "A10");
    const opening = makeState([gfb, bg], { walls: { west: false, east: true } });
    const session = new GameSession(structuredClone(opening));
    session.move({ pieceId: gfb.id, to: toCoord("F7") });
    session.move({ pieceId: idAt(session.state, "A10"), to: toCoord("A11") });
    session.move({ pieceId: gfb.id, to: toCoord("G7") });
    // Undo everything.
    while (session.canUndo()) session.undo();
    expect(session.state).toEqual(opening);
  });
});
