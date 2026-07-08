import { describe, it, expect } from "vitest";
import { makeState, piece, move, moveTargets, allTargets, at } from "./helpers.ts";
import { GameSession } from "../src/game/session.ts";
import { toCoord } from "../src/game/coords.ts";
import type {
  GameState,
  Piece,
  UnladenSanctuaryStage,
} from "../src/game/types.ts";

const OPEN = { west: false, east: false };

/** A state with an active unladen Sanctuary sequence for `fb` at `stage`. */
function committed(
  stage: UnladenSanctuaryStage,
  fb: Piece,
  extras: Piece[] = [],
  overrides: Partial<GameState> = {},
): GameState {
  return makeState([fb, ...extras], {
    walls: OPEN,
    current: fb.player,
    unladenSanctuary: { player: fb.player, bearerId: fb.id, stage },
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Entry & stage timing
// ---------------------------------------------------------------------------

describe("Unladen Sanctuary — entry & stage timing", () => {
  it("entering the inner circle activates bufferPending (entry turn ≠ buffer turn)", () => {
    const s = makeState([piece("flagBearer", "green", "G4"), piece("guard", "blue", "A10")]);
    const after = move(s, "G4", "G6"); // enter through the north gate
    expect(after.unladenSanctuary).toEqual({
      player: "green",
      bearerId: at(after, "G6")!.id,
      stage: "bufferPending",
    });
    expect(after.current).toBe("blue");
  });

  it("the immediate opponent turn does not advance the stage", () => {
    const fb = piece("flagBearer", "green", "G6");
    const s = committed("bufferPending", fb, [piece("guard", "blue", "A10")], {
      current: "blue",
    });
    const after = move(s, "A10", "A11");
    expect(after.unladenSanctuary?.stage).toBe("bufferPending");
  });

  it("the opposing Flag Bearer cannot enter while the sequence is active", () => {
    const green = piece("flagBearer", "green", "G6");
    const blue = piece("flagBearer", "blue", "G10");
    const s = committed("bufferPending", green, [blue], { current: "blue" });
    const t = allTargets(s, "G10");
    expect(t).not.toContain("G8"); // cannot enter the circle
    expect(t).toContain("G9"); // may still sit on the (open) south gate
  });
});

// ---------------------------------------------------------------------------
// Buffer turn
// ---------------------------------------------------------------------------

describe("Unladen Sanctuary — buffer turn", () => {
  it("moving a non-Bearer advances to decisionPending", () => {
    const fb = piece("flagBearer", "green", "G6");
    const s = committed("bufferPending", fb, [piece("guard", "green", "C3")]);
    const after = move(s, "C3", "C4");
    expect(after.unladenSanctuary?.stage).toBe("decisionPending");
    expect(at(after, "G6")?.type).toBe("flagBearer"); // Bearer untouched
  });

  it("moving the Bearer within the circle advances to decisionPending", () => {
    const fb = piece("flagBearer", "green", "G6");
    const s = committed("bufferPending", fb);
    const after = move(s, "G6", "H6");
    expect(after.unladenSanctuary?.stage).toBe("decisionPending");
    expect(at(after, "H6")?.type).toBe("flagBearer");
  });

  it("collecting the flag clears the unladen state and starts the countdown at 3", () => {
    const fb = piece("flagBearer", "green", "G6");
    const s = committed("bufferPending", fb);
    const after = move(s, "G6", "G7");
    expect(after.unladenSanctuary).toBeNull();
    expect(after.flag.carrierId).toBe(at(after, "G7")!.id);
    expect(after.extractionTurnsRemaining).toBe(3); // not decremented on pickup
    expect(after.forcedGateDeparture).toBe(false);
  });

  it("completely exiting clears the unladen state without routing", () => {
    const fb = piece("flagBearer", "green", "G6");
    const s = committed("bufferPending", fb);
    const after = move(s, "G6", "G4"); // straight out through the north gate
    expect(after.unladenSanctuary).toBeNull();
    expect(at(after, "G4")?.type).toBe("flagBearer"); // NOT routed
  });

  it("ending on a gate tile is not a complete exit (state advances, stays active)", () => {
    const fb = piece("flagBearer", "green", "G6");
    const s = committed("bufferPending", fb);
    const after = move(s, "G6", "G5"); // onto the north gate only
    expect(after.unladenSanctuary?.stage).toBe("decisionPending");
    expect(at(after, "G5")?.type).toBe("flagBearer");
  });
});

// ---------------------------------------------------------------------------
// Decision turn
// ---------------------------------------------------------------------------

describe("Unladen Sanctuary — decision turn", () => {
  it("an intervening opponent turn does not clear or advance decisionPending", () => {
    const fb = piece("flagBearer", "green", "G6");
    const s = committed("decisionPending", fb, [piece("guard", "blue", "A10")], {
      current: "blue",
    });
    const after = move(s, "A10", "A11");
    expect(after.unladenSanctuary?.stage).toBe("decisionPending");
  });

  it("moving a non-Bearer resolves that move, then routes the Bearer (Green → G1)", () => {
    const fb = piece("flagBearer", "green", "G6");
    const s = committed("decisionPending", fb, [piece("guard", "green", "C3")]);
    const after = move(s, "C3", "C4");
    expect(at(after, "C4")?.type).toBe("guard"); // the chosen move resolved
    expect(at(after, "G1")?.type).toBe("flagBearer"); // Bearer routed home
    expect(after.unladenSanctuary).toBeNull();
    expect(after.flag.square).toEqual(toCoord("G7")); // flag NOT moved
    expect(after.flag.carrierId).toBeNull();
  });

  it("routes Blue → G13 on a decision failure", () => {
    const fb = piece("flagBearer", "blue", "G8");
    const s = committed("decisionPending", fb, [piece("guard", "blue", "A10")]);
    const after = move(s, "A10", "A9");
    expect(at(after, "G13")?.type).toBe("flagBearer");
    expect(after.unladenSanctuary).toBeNull();
  });

  it("moving the Bearer to another inner square still routes it", () => {
    const fb = piece("flagBearer", "green", "G6");
    const s = committed("decisionPending", fb);
    const after = move(s, "G6", "H6");
    expect(at(after, "H6")).toBeUndefined();
    expect(at(after, "G1")?.type).toBe("flagBearer");
    expect(after.unladenSanctuary).toBeNull();
  });

  it("ending on a gate tile routes the Bearer (incomplete exit)", () => {
    const fb = piece("flagBearer", "green", "G6");
    const s = committed("decisionPending", fb);
    const after = move(s, "G6", "G5");
    expect(at(after, "G1")?.type).toBe("flagBearer");
    expect(after.unladenSanctuary).toBeNull();
  });

  it("collecting the flag on G7 prevents routing and starts the countdown", () => {
    const fb = piece("flagBearer", "green", "G6");
    const s = committed("decisionPending", fb);
    const after = move(s, "G6", "G7");
    expect(after.flag.carrierId).toBe(at(after, "G7")!.id);
    expect(after.extractionTurnsRemaining).toBe(3);
    expect(after.unladenSanctuary).toBeNull();
  });

  it("completely exiting prevents routing", () => {
    const fb = piece("flagBearer", "green", "G6");
    const s = committed("decisionPending", fb);
    const after = move(s, "G6", "G4");
    expect(at(after, "G4")?.type).toBe("flagBearer");
    expect(after.unladenSanctuary).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Gate & exit geometry
// ---------------------------------------------------------------------------

describe("Unladen Sanctuary — gate & exit geometry", () => {
  it("G6 → G4 (north) and G8 → G10 (south) are complete exits", () => {
    expect(moveTargets(makeState([piece("flagBearer", "green", "G6")]), "G6")).toContain("G4");
    expect(moveTargets(makeState([piece("flagBearer", "green", "G8")]), "G8")).toContain("G10");
  });

  it("F7 → D7 through E7 is valid only when the West Wall is open", () => {
    const open = makeState([piece("flagBearer", "green", "F7")], { walls: { west: false, east: true } });
    expect(allTargets(open, "F7")).toContain("D7");
    const closed = makeState([piece("flagBearer", "green", "F7")], { walls: { west: true, east: true } });
    expect(allTargets(closed, "F7")).not.toContain("D7");
    expect(allTargets(closed, "F7")).not.toContain("E7"); // closed gate impassable
  });

  it("H7 → J7 through I7 is valid only when the East Wall is open", () => {
    const open = makeState([piece("flagBearer", "green", "H7")], { walls: { west: true, east: false } });
    expect(allTargets(open, "H7")).toContain("J7");
    const closed = makeState([piece("flagBearer", "green", "H7")], { walls: { west: true, east: true } });
    expect(allTargets(closed, "H7")).not.toContain("J7");
  });

  it("cannot exit diagonally around a gate / through ring-wall terrain", () => {
    const s = makeState([piece("flagBearer", "green", "F6")], { walls: OPEN });
    const t = allTargets(s, "F6");
    // F6 is a corner not aligned with any gate axis — no exterior square reachable.
    for (const sq of ["H4", "D8", "D4", "H8"]) {
      // (H8 is an inner square, exclude it from the "exterior" check)
      if (sq === "H8") continue;
      expect(t).not.toContain(sq);
    }
  });

  it("an unladen Bearer retreats through N/S, but a laden carrier cannot", () => {
    const unladen = makeState([piece("flagBearer", "green", "G6")]);
    expect(allTargets(unladen, "G6")).toContain("G4");
    const fb = piece("flagBearer", "green", "G6");
    const laden = makeState([fb], { flag: { square: null, carrierId: fb.id }, extractionTurnsRemaining: 3 });
    expect(allTargets(laden, "G6")).not.toContain("G5");
  });
});

// ---------------------------------------------------------------------------
// Routing / cleanup & restart / new game
// ---------------------------------------------------------------------------

describe("Unladen Sanctuary — cleanup", () => {
  it("restart and new game clear the unladen state", () => {
    const fb = piece("flagBearer", "green", "G6");
    const session = new GameSession(committed("decisionPending", fb));
    expect(session.state.unladenSanctuary).not.toBeNull();
    session.restart();
    expect(session.state.unladenSanctuary).toBeNull();

    const s2 = new GameSession(committed("bufferPending", piece("flagBearer", "green", "G6")));
    s2.newGame();
    expect(s2.state.unladenSanctuary).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Undo & serialization
// ---------------------------------------------------------------------------

describe("Unladen Sanctuary — undo & serialization", () => {
  function idAt(s: GameState, square: string): string {
    const c = toCoord(square);
    return s.pieces.find((p) => p.col === c.col && p.row === c.row)!.id;
  }

  it("undo restores bufferPending and decisionPending in turn", () => {
    const fb = piece("flagBearer", "green", "G6");
    const session = new GameSession(
      committed("bufferPending", fb, [piece("guard", "green", "C3"), piece("guard", "blue", "A10")]),
    );
    const atBuffer = structuredClone(session.state);
    // Buffer turn: move a non-Bearer -> decisionPending.
    session.move({ pieceId: idAt(session.state, "C3"), to: toCoord("C4") });
    expect(session.state.unladenSanctuary?.stage).toBe("decisionPending");
    const atDecision = structuredClone(session.state);
    session.undo();
    expect(session.state).toEqual(atBuffer);
    expect(session.state.unladenSanctuary?.stage).toBe("bufferPending");
    // Redo the move, then reach a decision failure and undo that too.
    session.move({ pieceId: idAt(session.state, "C3"), to: toCoord("C4") });
    expect(session.state).toEqual(atDecision);
  });

  it("undo reverses automatic decision-turn routing", () => {
    const fb = piece("flagBearer", "green", "G6");
    const session = new GameSession(committed("decisionPending", fb, [piece("guard", "green", "C3")]));
    const before = structuredClone(session.state);
    session.move({ pieceId: idAt(session.state, "C3"), to: toCoord("C4") });
    expect(at(session.state, "G1")?.type).toBe("flagBearer"); // routed
    session.undo();
    expect(session.state).toEqual(before);
    expect(at(session.state, "G6")?.type).toBe("flagBearer"); // back inside
    expect(session.state.unladenSanctuary?.stage).toBe("decisionPending");
  });

  it("undo reverses a completed retreat and a flag pickup", () => {
    // Retreat.
    const fbA = piece("flagBearer", "green", "G6");
    const retreat = new GameSession(committed("bufferPending", fbA));
    const beforeRetreat = structuredClone(retreat.state);
    retreat.move({ pieceId: fbA.id, to: toCoord("G4") });
    expect(retreat.state.unladenSanctuary).toBeNull();
    retreat.undo();
    expect(retreat.state).toEqual(beforeRetreat);

    // Pickup.
    const fbB = piece("flagBearer", "green", "G6");
    const pickup = new GameSession(committed("bufferPending", fbB));
    const beforePickup = structuredClone(pickup.state);
    pickup.move({ pieceId: fbB.id, to: toCoord("G7") });
    expect(pickup.state.extractionTurnsRemaining).toBe(3);
    pickup.undo();
    expect(pickup.state).toEqual(beforePickup);
    expect(pickup.state.extractionTurnsRemaining).toBeNull();
    expect(pickup.state.unladenSanctuary?.stage).toBe("bufferPending");
  });

  it("serialization round-trips both stages", () => {
    for (const stage of ["bufferPending", "decisionPending"] as const) {
      const fb = piece("flagBearer", "green", "G6");
      const session = new GameSession(committed(stage, fb));
      const restored = GameSession.deserialize(session.serialize());
      expect(restored.state).toEqual(session.state);
      expect(restored.state.unladenSanctuary?.stage).toBe(stage);
    }
  });
});
