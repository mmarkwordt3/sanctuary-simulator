import { describe, it, expect } from "vitest";
import { makeState, piece, move, moveTargets, allTargets, at } from "./helpers.ts";
import { GameSession } from "../src/game/session.ts";
import { applyMove } from "../src/game/reducer.ts";
import { legalMoves } from "../src/game/movement.ts";
import { toCoord } from "../src/game/coords.ts";
import type { GameState, Piece } from "../src/game/types.ts";

const OPEN = { west: false, east: false };

/** A laden state: `fb` carries the flag, plus any extra pieces. */
function ladenState(
  fb: Piece,
  extras: Piece[],
  overrides: Partial<GameState> = {},
): GameState {
  return makeState([fb, ...extras], {
    walls: OPEN,
    flag: { square: null, carrierId: fb.id },
    extractionTurnsRemaining: 3,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Countdown behaviour
// ---------------------------------------------------------------------------

describe("Extraction countdown", () => {
  it("pickup sets the countdown to 3 without consuming a turn", () => {
    const s = makeState([piece("flagBearer", "green", "G6"), piece("guard", "blue", "A10")]);
    const after = move(s, "G6", "G7");
    expect(after.flag.carrierId).toBe(at(after, "G7")!.id);
    expect(after.extractionTurnsRemaining).toBe(3);
    expect(after.forcedGateDeparture).toBe(false);
    expect(after.current).toBe("blue");
  });

  it("an opponent's turn does not change the countdown", () => {
    const fb = piece("flagBearer", "green", "G7");
    const s = ladenState(fb, [piece("guard", "blue", "A10")], { current: "blue" });
    const after = move(s, "A10", "A11"); // Blue tempo move
    expect(after.extractionTurnsRemaining).toBe(3);
  });

  it("moving a friendly non-Bearer reduces the countdown 3 -> 2 -> 1", () => {
    const fb = piece("flagBearer", "green", "G7");
    const guard = piece("guard", "green", "C3");
    const s = ladenState(fb, [guard], { current: "green" });

    const a = move(s, "C3", "C4"); // green non-Bearer move
    expect(a.extractionTurnsRemaining).toBe(2);
    expect(at(a, "G7")?.type).toBe("flagBearer"); // carrier untouched

    const b = move({ ...a, current: "green" }, "C4", "C5");
    expect(b.extractionTurnsRemaining).toBe(1);
  });

  it("the carrier may reach a side gate on the third and final turn", () => {
    const fb = piece("flagBearer", "green", "F7");
    const s = ladenState(fb, [], { current: "green", extractionTurnsRemaining: 1 });
    const after = move(s, "F7", "E7"); // reaches the West gate on the last turn
    expect(after.extractionTurnsRemaining).toBeNull();
    expect(after.forcedGateDeparture).toBe(true);
    expect(after.flag.carrierId).toBe(fb.id); // still carrying
  });

  it("moving another friendly piece on the third turn resets the attempt", () => {
    const fb = piece("flagBearer", "green", "G7");
    const guard = piece("guard", "green", "C3");
    const s = ladenState(fb, [guard], { current: "green", extractionTurnsRemaining: 1 });
    const after = move(s, "C3", "C4"); // spends the last turn without extracting
    expect(after.flag.carrierId).toBeNull();
    expect(after.flag.square).toEqual(toCoord("G7"));
    expect(after.extractionTurnsRemaining).toBeNull();
    expect(at(after, "G1")?.type).toBe("flagBearer"); // routed home
  });

  it("moving the carrier but staying inside on the third turn resets the attempt", () => {
    const fb = piece("flagBearer", "green", "G7");
    const s = ladenState(fb, [], { current: "green", extractionTurnsRemaining: 1 });
    const after = move(s, "G7", "G6"); // still inside the circle
    expect(after.flag.carrierId).toBeNull();
    expect(after.flag.square).toEqual(toCoord("G7"));
    expect(after.extractionTurnsRemaining).toBeNull();
  });

  it("routing the carrier clears the countdown", () => {
    const blueFb = piece("flagBearer", "blue", "D7");
    const greenFb = piece("flagBearer", "green", "C7");
    const s = makeState([greenFb, blueFb], {
      walls: OPEN,
      flag: { square: null, carrierId: blueFb.id },
      extractionTurnsRemaining: 2,
    });
    const after = move(s, "C7", "D7"); // green Bearer routes the blue carrier
    expect(after.extractionTurnsRemaining).toBeNull();
    expect(after.forcedGateDeparture).toBe(false);
    expect(after.flag.square).toEqual(toCoord("G7"));
    expect(at(after, "G13")?.type).toBe("flagBearer"); // blue routed home
  });
});

// ---------------------------------------------------------------------------
// Forced gate-departure
// ---------------------------------------------------------------------------

describe("Forced gate-departure", () => {
  it("reaching a side gate clears the countdown and activates forced departure", () => {
    const fb = piece("flagBearer", "green", "F7");
    const s = ladenState(fb, [], { current: "green" });
    const after = move(s, "F7", "E7");
    expect(after.extractionTurnsRemaining).toBeNull();
    expect(after.forcedGateDeparture).toBe(true);
  });

  it("on the owner's turn only the carrier may move", () => {
    const fb = piece("flagBearer", "green", "E7");
    const guard = piece("guard", "green", "C3");
    const s = makeState([fb, guard], {
      walls: OPEN,
      current: "green",
      flag: { square: null, carrierId: fb.id },
      extractionTurnsRemaining: null,
      forcedGateDeparture: true,
    });
    // The guard has no legal move; the carrier has its departures.
    expect(legalMoves(s, toCoord("C3"))).toEqual([]);
    expect(moveTargets(s, "E7").length).toBeGreaterThan(0);
    // The engine rejects an attempted guard move (not just the UI).
    const guardMove = applyMove(s, { pieceId: guard.id, to: toCoord("C4") });
    expect(guardMove).toBe(s);
  });

  it("from E7 only D6/D7/D8 are valid, never back into the circle", () => {
    const fb = piece("flagBearer", "green", "E7");
    const s = makeState([fb], {
      walls: OPEN,
      current: "green",
      flag: { square: null, carrierId: fb.id },
      extractionTurnsRemaining: null,
      forcedGateDeparture: true,
    });
    expect(allTargets(s, "E7")).toEqual(["D6", "D7", "D8"]);
    expect(allTargets(s, "E7")).not.toContain("F7"); // no re-entry
  });

  it("from I7 only J6/J7/J8 are valid", () => {
    const fb = piece("flagBearer", "green", "I7");
    const s = makeState([fb], {
      walls: OPEN,
      current: "green",
      flag: { square: null, carrierId: fb.id },
      extractionTurnsRemaining: null,
      forcedGateDeparture: true,
    });
    expect(allTargets(s, "I7")).toEqual(["J6", "J7", "J8"]);
  });

  it("a fully blocked departure resets the flag and routes the carrier", () => {
    // All of D6/D7/D8 occupied by friendly pieces; a Blue tempo move triggers
    // the start-of-turn resolution for Green.
    const fb = piece("flagBearer", "green", "E7");
    const blockers = [
      piece("spy", "green", "D6"),
      piece("guard", "green", "D7"),
      piece("guard", "green", "D8"),
    ];
    const blue = piece("guard", "blue", "A10");
    const s = makeState([fb, ...blockers, blue], {
      walls: OPEN,
      current: "blue",
      flag: { square: null, carrierId: fb.id },
      extractionTurnsRemaining: null,
      forcedGateDeparture: true,
    });
    const after = move(s, "A10", "A11"); // Blue moves; Green's turn begins blocked
    expect(after.flag.carrierId).toBeNull();
    expect(after.flag.square).toEqual(toCoord("G7"));
    expect(after.forcedGateDeparture).toBe(false);
    expect(at(after, "G1")?.type).toBe("flagBearer"); // routed home
    expect(after.current).toBe("blue"); // the blocked turn was spent
  });

  it("the opposing Flag Bearer may capture the carrier while it sits on the gate", () => {
    const carrier = piece("flagBearer", "green", "E7");
    const blueFb = piece("flagBearer", "blue", "D7");
    const s = makeState([carrier, blueFb], {
      walls: OPEN,
      current: "blue",
      flag: { square: null, carrierId: carrier.id },
      extractionTurnsRemaining: null,
      forcedGateDeparture: true,
    });
    // Blue is not restricted by the forced-departure state (rule 15).
    expect(legalMoves(s, toCoord("D7")).some((m) => m.to.col === 4 && m.to.row === 6)).toBe(true);
    const after = move(s, "D7", "E7");
    expect(at(after, "E7")?.player).toBe("blue");
    expect(after.flag.carrierId).toBeNull();
    expect(after.flag.square).toEqual(toCoord("G7"));
    expect(after.forcedGateDeparture).toBe(false);
    expect(at(after, "G1")?.type).toBe("flagBearer"); // green carrier routed home
  });

  it("after a successful departure, normal play resumes with no countdown", () => {
    const fb = piece("flagBearer", "green", "E7");
    const s = makeState([fb], {
      walls: OPEN,
      current: "green",
      flag: { square: null, carrierId: fb.id },
      extractionTurnsRemaining: null,
      forcedGateDeparture: true,
    });
    const after = move(s, "E7", "D7");
    expect(after.forcedGateDeparture).toBe(false);
    expect(after.extractionTurnsRemaining).toBeNull();
    expect(after.flag.carrierId).toBe(fb.id); // still carrying, heading home
    expect(at(after, "D7")?.type).toBe("flagBearer");
    expect(after.current).toBe("blue");
  });
});

// ---------------------------------------------------------------------------
// Undo & serialization of the new state
// ---------------------------------------------------------------------------

describe("Extraction undo & serialization", () => {
  function idAt(s: GameState, square: string): string {
    const c = toCoord(square);
    return s.pieces.find((p) => p.col === c.col && p.row === c.row)!.id;
  }

  it("undo restores countdown, carrier, flag and active player after a decrement", () => {
    const fb = piece("flagBearer", "green", "G7");
    const guard = piece("guard", "green", "C3");
    const session = new GameSession(
      ladenState(fb, [guard], { current: "green" }),
    );
    const before = structuredClone(session.state);
    session.move({ pieceId: idAt(session.state, "C3"), to: toCoord("C4") });
    expect(session.state.extractionTurnsRemaining).toBe(2);
    session.undo();
    expect(session.state).toEqual(before);
    expect(session.state.extractionTurnsRemaining).toBe(3);
    expect(session.state.current).toBe("green");
  });

  it("undo restores the forced-departure state after reaching a gate", () => {
    const fb = piece("flagBearer", "green", "F7");
    const session = new GameSession(
      ladenState(fb, [], { current: "green", extractionTurnsRemaining: 1 }),
    );
    const before = structuredClone(session.state);
    session.move({ pieceId: fb.id, to: toCoord("E7") });
    expect(session.state.forcedGateDeparture).toBe(true);
    expect(session.state.extractionTurnsRemaining).toBeNull();
    session.undo();
    expect(session.state).toEqual(before);
    expect(session.state.forcedGateDeparture).toBe(false);
    expect(session.state.extractionTurnsRemaining).toBe(1);
  });

  it("serialization round-trips the extraction and forced-departure state", () => {
    const fb = piece("flagBearer", "green", "E7");
    const session = new GameSession(
      makeState([fb], {
        walls: OPEN,
        current: "green",
        flag: { square: null, carrierId: fb.id },
        extractionTurnsRemaining: null,
        forcedGateDeparture: true,
      }),
    );
    const restored = GameSession.deserialize(session.serialize());
    expect(restored.state).toEqual(session.state);
    expect(restored.state.forcedGateDeparture).toBe(true);
  });
});
