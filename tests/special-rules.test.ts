import { describe, it, expect } from "vitest";
import {
  makeState,
  piece,
  moveTargets,
  captureTargets,
  allTargets,
  move,
  at,
} from "./helpers.ts";
import { toCoord } from "../src/game/coords.ts";
import { legalMoves } from "../src/game/movement.ts";

// ---------------------------------------------------------------------------
// Flag Bearer
// ---------------------------------------------------------------------------

describe("Flag Bearer", () => {
  it("unladen moves 1-2 orthogonally/diagonally", () => {
    const s = makeState([piece("flagBearer", "green", "C4")]);
    const t = moveTargets(s, "C4");
    expect(t).toContain("C5");
    expect(t).toContain("C6");
    expect(t).toContain("A4");
    expect(t).toContain("E2");
    expect(t).not.toContain("C7");
  });

  it("laden moves exactly 1 square", () => {
    const fb = piece("flagBearer", "green", "F7");
    const s = makeState([fb], {
      walls: { west: false, east: false },
      flag: { square: null, carrierId: fb.id },
      extractionTurnsRemaining: 3,
    });
    const t = moveTargets(s, "F7");
    expect(t).toContain("E7"); // 1 step onto the open west gate
    expect(t).not.toContain("D7"); // 2 steps not allowed while laden
  });

  it("cannot attack ordinary pieces", () => {
    const s = makeState([
      piece("flagBearer", "green", "C4"),
      piece("spy", "blue", "C5"),
    ]);
    expect(captureTargets(s, "C4")).toEqual([]);
    expect(allTargets(s, "C4")).not.toContain("C5");
  });

  it("routes an opposing carrier outside the inner circle", () => {
    const blueFb = piece("flagBearer", "blue", "D7");
    const greenFb = piece("flagBearer", "green", "C7");
    const s = makeState([greenFb, blueFb], {
      flag: { square: null, carrierId: blueFb.id },
      extractionTurnsRemaining: 2,
    });
    expect(captureTargets(s, "C7")).toContain("D7");
    const after = move(s, "C7", "D7");
    // Blue carrier routed to its home G13; flag reset to G7; countdown cleared.
    expect(at(after, "G13")?.type).toBe("flagBearer");
    expect(after.flag.carrierId).toBeNull();
    expect(after.flag.square).toEqual(toCoord("G7"));
    expect(after.extractionTurnsRemaining).toBeNull();
    expect(at(after, "D7")?.player).toBe("green");
  });

  it("cannot attack another Bearer when the target is inside the inner circle", () => {
    const blueFb = piece("flagBearer", "blue", "F8"); // inside
    const greenFb = piece("flagBearer", "green", "E7"); // on the open west gate
    const s = makeState([greenFb, blueFb], {
      walls: { west: false, east: false },
      flag: { square: null, carrierId: blueFb.id },
    });
    expect(captureTargets(s, "E7")).not.toContain("F8");
  });

  it("only a Bearer may enter gates and the inner circle", () => {
    const s = makeState([piece("flagBearer", "green", "G4")], {
      walls: { west: false, east: false },
    });
    const t = allTargets(s, "G4");
    expect(t).toContain("G5"); // north gate
    expect(t).toContain("G6"); // enters the circle through the gate
  });

  it("enters through North and South gates", () => {
    const north = makeState([piece("flagBearer", "green", "G4")]);
    expect(moveTargets(north, "G4")).toContain("G6"); // through north gate G5
    const south = makeState([piece("flagBearer", "blue", "G10")], { current: "blue" });
    expect(moveTargets(south, "G10")).toContain("G8"); // through south gate G9
  });

  it("an unladen Bearer may retreat through the North gate, but a laden one may not", () => {
    // Unladen: North/South are valid retreats (straight through the gate).
    const unladen = makeState([piece("flagBearer", "green", "G6")]);
    const t = allTargets(unladen, "G6");
    expect(t).toContain("G5"); // may step onto the north gate
    expect(t).toContain("G4"); // and continue straight out (2-square exit)

    // Laden: North/South remain invalid exits (extraction is E/W only).
    const fb = piece("flagBearer", "green", "G6");
    const laden = makeState([fb], {
      flag: { square: null, carrierId: fb.id },
      extractionTurnsRemaining: 3,
    });
    expect(allTargets(laden, "G6")).not.toContain("G5");
  });

  it("an unladen Bearer may end on an open gate via a 1-2 square diagonal (E11 → G9)", () => {
    // Regression: the two-square diagonal E11 → F10 → G9 lands on the open South
    // Gate. F10 is empty and the Bearer is unladen, so it must be legal.
    const s = makeState([piece("flagBearer", "blue", "E11")], { current: "blue" });
    expect(allTargets(s, "E11")).toContain("G9");
    // Closed side gates are still not reachable this way (West Wall closed → E7).
    const s2 = makeState([piece("flagBearer", "blue", "C9")], {
      current: "blue",
      walls: { west: true, east: true },
    });
    expect(allTargets(s2, "C9")).not.toContain("E7"); // D8→E7 diagonal blocked while closed
  });

  it("a laden Bearer cannot exit East/West while closed, but can when open", () => {
    // An unladen Bearer inside may only collect the flag, so the exit rules are
    // exercised by a laden (carrying) Bearer during extraction. Laden = move 1.
    const makeLaden = (walls: { west: boolean; east: boolean }) => {
      const fb = piece("flagBearer", "green", "F7");
      return {
        fb,
        state: makeState([fb], {
          walls,
          flag: { square: null, carrierId: fb.id },
          extractionTurnsRemaining: 3,
        }),
      };
    };
    const closed = makeLaden({ west: true, east: true });
    expect(allTargets(closed.state, "F7")).not.toContain("E7"); // west wall closed
    const open = makeLaden({ west: false, east: false });
    const t = allTargets(open.state, "F7");
    expect(t).toContain("E7"); // exit onto the open west gate (1 square)
    expect(t).not.toContain("D7"); // laden Bearers move exactly 1 square
  });

  it("pickup ends movement and sets a 3-turn extraction countdown", () => {
    const s = makeState([piece("flagBearer", "green", "G6")]);
    const after = move(s, "G6", "G7");
    const fb = at(after, "G7")!;
    expect(after.flag.carrierId).toBe(fb.id);
    expect(after.flag.square).toBeNull();
    expect(after.extractionTurnsRemaining).toBe(3);
    expect(after.current).toBe("blue"); // turn passed
  });

  it("times out: flag returns to G7 and the carrier is routed home", () => {
    const fb = piece("flagBearer", "green", "G7");
    const s = makeState([fb], {
      flag: { square: null, carrierId: fb.id },
      extractionTurnsRemaining: 1, // this move is the third — will hit zero
    });
    const after = move(s, "G7", "G6"); // stays inside, does not reach a side gate
    expect(after.flag.carrierId).toBeNull();
    expect(after.flag.square).toEqual(toCoord("G7"));
    expect(after.extractionTurnsRemaining).toBeNull();
    expect(at(after, "G1")?.type).toBe("flagBearer"); // routed home
  });
});

// ---------------------------------------------------------------------------
// Inner-circle single occupancy (the authoritative Sanctuary rules)
// ---------------------------------------------------------------------------

describe("Inner-circle single occupancy", () => {
  const OPEN = { west: false, east: false };

  it("a second Bearer cannot enter while the first Bearer is inside", () => {
    // Green Bearer already inside at F7; Blue Bearer waiting on the open east
    // gate. Blue must not be able to step into the circle (H7).
    const green = piece("flagBearer", "green", "F7");
    const blue = piece("flagBearer", "blue", "I7");
    const s = makeState([green, blue], { current: "blue", walls: OPEN });
    expect(allTargets(s, "I7")).not.toContain("H7");
  });

  it("an unladen Bearer cannot enter while the flag is being carried", () => {
    // Blue is carrying the flag (elsewhere); Green tries to enter — nothing to
    // collect, so entry is denied.
    const carrier = piece("flagBearer", "blue", "D7");
    const green = piece("flagBearer", "green", "G4");
    const s = makeState([green, carrier], {
      walls: OPEN,
      flag: { square: null, carrierId: carrier.id },
    });
    const t = allTargets(s, "G4");
    expect(t).not.toContain("G6"); // cannot enter the circle
    expect(t).toContain("G5"); // may still stand on the (open) north gate
  });

  it("an unladen Bearer inside may reshuffle, collect at G7, or retreat", () => {
    // Unladen Bearers move normally now (no forced G7). From G6 it can pick up
    // the flag, move within the circle, or retreat straight out through G5.
    const s = makeState([piece("flagBearer", "green", "G6")], { walls: OPEN });
    const t = allTargets(s, "G6");
    expect(t).toContain("G7"); // collect the flag
    expect(t).toContain("H6"); // reshuffle within the circle
    expect(t).toContain("G5"); // step onto the north gate
    expect(t).toContain("G4"); // complete northern retreat
  });

  it("moving to G7 collects the flag normally", () => {
    const s = makeState([piece("flagBearer", "green", "F7")], { walls: OPEN });
    const after = move(s, "F7", "G7");
    const fb = at(after, "G7")!;
    expect(after.flag.carrierId).toBe(fb.id);
    expect(after.flag.square).toBeNull();
    expect(after.extractionTurnsRemaining).toBe(3);
  });

  it("the opponent may enter again once the first Bearer has left/reset", () => {
    // Flag back at G7, nobody inside: the Blue Bearer may now enter.
    const blue = piece("flagBearer", "blue", "G10");
    const s = makeState([blue], { current: "blue", walls: OPEN });
    expect(moveTargets(s, "G10")).toContain("G8"); // enters via south gate
  });

  it("still enters normally when the flag is present and nobody is inside", () => {
    const s = makeState([piece("flagBearer", "green", "G4")], { walls: OPEN });
    expect(moveTargets(s, "G4")).toContain("G6");
  });

  it("leaves the extraction countdown behaviour unchanged after collection", () => {
    // Collect at G7, then a laden move that stays inside decrements 3 -> 2, and
    // reaching a side gate secures extraction (countdown cleared) — unchanged.
    const s = makeState([piece("flagBearer", "green", "F7")], { walls: OPEN });
    const picked = move(s, "F7", "G7");
    expect(picked.extractionTurnsRemaining).toBe(3);
    const carrierId = picked.flag.carrierId!;

    const stepIn = move({ ...picked, current: "green" }, "G7", "G6"); // laden, inside
    expect(stepIn.extractionTurnsRemaining).toBe(2);

    const toGate = move({ ...stepIn, current: "green" }, "G6", "H7"); // H7 -> ... move toward east
    // (H7 is inside; still counting) then out to the east gate.
    expect(toGate.extractionTurnsRemaining).toBe(1);
    const secured = move({ ...toGate, current: "green" }, "H7", "I7"); // reach east side gate
    expect(secured.extractionTurnsRemaining).toBeNull();
    expect(secured.flag.carrierId).toBe(carrierId); // still carrying
  });
});

// ---------------------------------------------------------------------------
// Engineer & walls
// ---------------------------------------------------------------------------

describe("Engineer & walls", () => {
  it("ending on A6-A8 removes the East Wall and routes the Engineer", () => {
    const s = makeState([piece("engineer", "green", "B7")]);
    const after = move(s, "B7", "A7");
    expect(after.walls.east).toBe(false); // East wall removed
    expect(after.walls.west).toBe(true); // West wall still closed
    expect(at(after, "G3")?.type).toBe("engineer"); // routed to start
  });

  it("ending on M6-M8 removes the West Wall", () => {
    const s = makeState([piece("engineer", "green", "L7")]);
    const after = move(s, "L7", "M7");
    expect(after.walls.west).toBe(false);
    expect(after.walls.east).toBe(true);
  });

  it("opening the second wall removes BOTH Engineers", () => {
    const greenEn = piece("engineer", "green", "L7");
    const blueEn = piece("engineer", "blue", "F11");
    const s = makeState([greenEn, blueEn], {
      walls: { west: true, east: false }, // East already open
    });
    const after = move(s, "L7", "M7"); // opens West -> second wall
    expect(after.walls.west).toBe(false);
    expect(after.engineersRemoved).toBe(true);
    expect(after.pieces.filter((p) => p.type === "engineer")).toHaveLength(0);
  });

  it("an already-open wall is not triggered again", () => {
    const s = makeState([piece("engineer", "green", "B7")], {
      walls: { west: true, east: false }, // East already open
    });
    const after = move(s, "B7", "A7"); // A7 targets the (open) East wall
    // Nothing changes about walls; the Engineer is not routed by a wall event.
    expect(after.walls.east).toBe(false);
    expect(at(after, "A7")?.type).toBe("engineer"); // stayed (no wall opened)
  });

  it("a captured Engineer is routed to its start", () => {
    const s = makeState([
      piece("spy", "green", "D3"),
      piece("engineer", "blue", "D4"),
    ]);
    const after = move(s, "D3", "D4"); // row 4 — not a green promotion row
    expect(at(after, "G11")?.type).toBe("engineer"); // blue engineer home
    expect(at(after, "D4")?.type).toBe("spy");
  });
});

// ---------------------------------------------------------------------------
// Spy / Assassin
// ---------------------------------------------------------------------------

describe("Spy / Assassin", () => {
  it("a Green Spy promotes when ending on rows 9-10", () => {
    const s = makeState([piece("spy", "green", "K7")]);
    const after = move(s, "K7", "K9");
    expect(at(after, "K9")?.type).toBe("assassin");
  });

  it("a Blue Spy promotes when ending on rows 4-5", () => {
    const s = makeState([piece("spy", "blue", "C7")], { current: "blue" });
    const after = move(s, "C7", "C5");
    expect(at(after, "C5")?.type).toBe("assassin");
  });

  it("promotion happens only after the move resolves", () => {
    const s = makeState([piece("spy", "green", "K8")]);
    // Still a spy before moving.
    expect(at(s, "K8")?.type).toBe("spy");
    const after = move(s, "K8", "K10");
    expect(at(after, "K10")?.type).toBe("assassin");
  });

  it("an Assassin moves up to 4 squares within its territory", () => {
    const s = makeState([piece("assassin", "green", "A11")]);
    const t = moveTargets(s, "A11");
    expect(t).toContain("E11"); // 4 to the right
    expect(t).not.toContain("F11"); // 5 is too far
    expect(t).toContain("A13"); // 2 down, still in territory
  });

  it("an Assassin demotes on the first square across the boundary and stops", () => {
    const s = makeState([piece("assassin", "green", "C9")]);
    const t = allTargets(s, "C9");
    expect(t).toContain("C8"); // first square across the row-9/8 boundary
    expect(t).not.toContain("C7"); // cannot continue past the boundary
    const after = move(s, "C9", "C8");
    expect(at(after, "C8")?.type).toBe("spy"); // demoted
  });

  it("demotion may capture an enemy on the first crossed square", () => {
    const s = makeState([
      piece("assassin", "green", "C9"),
      piece("guard", "blue", "C8"),
    ]);
    expect(captureTargets(s, "C9")).toContain("C8");
    const after = move(s, "C9", "C8");
    expect(at(after, "C8")?.type).toBe("spy");
    expect(after.pieces.find((p) => p.type === "guard")).toBeUndefined();
  });

  it("demotion onto a friendly piece is illegal", () => {
    const s = makeState([
      piece("assassin", "green", "C9"),
      piece("spy", "green", "C8"),
    ]);
    expect(allTargets(s, "C9")).not.toContain("C8");
  });

  it("an Assassin never lands on a gate or inner-circle square", () => {
    const s = makeState([piece("assassin", "green", "H10")], {
      walls: { west: false, east: false },
    });
    const gatesAndInner = new Set(["G9", "E7", "I7", "G5", "F8", "G8", "H8"]);
    for (const m of legalMoves(s, toCoord("H10"))) {
      expect(gatesAndInner.has(`${"ABCDEFGHIJKLM"[m.to.col]}${m.to.row + 1}`)).toBe(false);
    }
  });
});
