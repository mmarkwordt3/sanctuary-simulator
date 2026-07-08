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

describe("Spy movement", () => {
  it("moves 1-2 orthogonally/diagonally", () => {
    const s = makeState([piece("spy", "green", "C4")]);
    const t = moveTargets(s, "C4");
    expect(t).toContain("C5"); // orth 1
    expect(t).toContain("C6"); // orth 2
    expect(t).toContain("A4"); // orth 2 left
    expect(t).toContain("E2"); // diag 2
    expect(t).not.toContain("C7"); // 3 away
    expect(t).not.toContain("F7"); // not on a line
  });

  it("captures by occupying an enemy square within range", () => {
    const s = makeState([piece("spy", "green", "C4"), piece("guard", "blue", "C6")]);
    expect(captureTargets(s, "C4")).toContain("C6");
  });

  it("cannot jump over a piece", () => {
    const s = makeState([piece("spy", "green", "C4"), piece("guard", "blue", "C5")]);
    expect(captureTargets(s, "C4")).toContain("C5");
    expect(allTargets(s, "C4")).not.toContain("C6");
  });

  it("cannot enter the inner circle or land on a gate", () => {
    const s = makeState([piece("spy", "green", "G3")], { walls: { west: false, east: false } });
    const t = allTargets(s, "G3");
    expect(t).not.toContain("G5"); // north gate
    expect(t).toContain("G4"); // ordinary square
  });
});

describe("Guard movement", () => {
  it("moves exactly 1 orthogonally to empty squares only", () => {
    const s = makeState([piece("guard", "green", "C4")]);
    expect(moveTargets(s, "C4").sort()).toEqual(["B4", "C3", "C5", "D4"].sort());
  });

  it("captures exactly 1 diagonally, not orthogonally", () => {
    const s = makeState([
      piece("guard", "green", "C4"),
      piece("spy", "blue", "D5"), // diagonal enemy
      piece("spy", "blue", "C5"), // orthogonal enemy
    ]);
    expect(captureTargets(s, "C4")).toEqual(["D5"]);
    expect(moveTargets(s, "C4")).not.toContain("C5");
  });

  it("cannot move diagonally to an empty square", () => {
    const s = makeState([piece("guard", "green", "C4")]);
    expect(moveTargets(s, "C4")).not.toContain("D5");
    expect(moveTargets(s, "C4")).not.toContain("B3");
  });
});

describe("Horse movement", () => {
  it("has the correct knight destinations (excluding a permanent wall)", () => {
    const s = makeState([piece("horse", "green", "C4")]);
    // C4's 8 knight squares include E5, a permanent wall, which is excluded.
    expect(allTargets(s, "C4").sort()).toEqual(
      ["A3", "A5", "B2", "B6", "D2", "D6", "E3"].sort(),
    );
  });

  it("jumps over intervening pieces", () => {
    const s = makeState([
      piece("horse", "green", "G2"),
      piece("guard", "green", "G3"),
      piece("spy", "green", "F3"),
      piece("spy", "green", "H3"),
    ]);
    expect(allTargets(s, "G2")).toContain("F4");
    expect(allTargets(s, "G2")).toContain("H4");
  });

  it("cannot land on a gate or a reserved square", () => {
    const s = makeState([piece("horse", "green", "F3")], { walls: { west: false, east: false } });
    const t = allTargets(s, "F3");
    expect(t).not.toContain("G5"); // north gate is a knight square from F3
    expect(t).not.toContain("G1"); // reserved green Flag Bearer home
  });

  it("captures ordinary pieces and routes special pieces", () => {
    const s = makeState([
      piece("horse", "green", "C4"),
      piece("guard", "blue", "D6"),
    ]);
    expect(captureTargets(s, "C4")).toContain("D6");
    const after = move(s, "C4", "D6");
    expect(at(after, "D6")?.type).toBe("horse");
    expect(after.pieces.find((p) => p.type === "guard" && p.player === "blue")).toBeUndefined();
  });
});

describe("Engineer movement", () => {
  it("moves 1-2 orthogonally/diagonally", () => {
    const s = makeState([piece("engineer", "green", "C4")]);
    const t = moveTargets(s, "C4");
    expect(t).toContain("C6");
    expect(t).toContain("E2"); // diagonal 2
    expect(t).not.toContain("C7");
  });

  it("cannot attack (no captures generated)", () => {
    const s = makeState([
      piece("engineer", "green", "C4"),
      piece("spy", "blue", "C5"),
    ]);
    expect(captureTargets(s, "C4")).toEqual([]);
    expect(moveTargets(s, "C4")).not.toContain("C6");
  });
});
