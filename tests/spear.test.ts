import { describe, it, expect } from "vitest";
import {
  makeState,
  piece,
  moveTargets,
  captureTargets,
  allTargets,
} from "./helpers.ts";

describe("Spear", () => {
  it("moves exactly 1 horizontally or diagonally, never straight forward/back", () => {
    const s = makeState([piece("spear", "green", "C4")]); // C is not a flank
    const t = moveTargets(s, "C4");
    expect(t.sort()).toEqual(["B3", "B4", "B5", "D3", "D4", "D5"].sort());
    expect(t).not.toContain("C5"); // straight forward
    expect(t).not.toContain("C3"); // straight backward
  });

  it("captures 1 horizontally or diagonally", () => {
    const s = makeState([
      piece("spear", "green", "C4"),
      piece("spy", "blue", "D4"), // horizontal
      piece("spy", "blue", "D5"), // diagonal forward
    ]);
    expect(captureTargets(s, "C4").sort()).toEqual(["D4", "D5"].sort());
  });

  it("cannot capture straight forward normally", () => {
    const s = makeState([
      piece("spear", "green", "C4"),
      piece("spy", "blue", "C5"), // straight ahead
    ]);
    expect(captureTargets(s, "C4")).not.toContain("C5");
  });

  it("Flank Charge: forward orthogonal charge-capture up to 4 from a flank", () => {
    const s = makeState([
      piece("spear", "green", "A4"),
      piece("spy", "blue", "A7"), // 3 squares ahead in the flank column
    ]);
    expect(captureTargets(s, "A4")).toContain("A7");
  });

  it("Flank Charge reaches at most 4 squares", () => {
    const far = makeState([
      piece("spear", "green", "A4"),
      piece("spy", "blue", "A9"), // 5 ahead — too far
    ]);
    expect(captureTargets(far, "A4")).not.toContain("A9");
    const edge = makeState([
      piece("spear", "green", "A4"),
      piece("spy", "blue", "A8"), // exactly 4 ahead
    ]);
    expect(captureTargets(edge, "A4")).toContain("A8");
  });

  it("Flank Charge is blocked by an intervening piece", () => {
    const s = makeState([
      piece("spear", "green", "A4"),
      piece("guard", "green", "A6"), // blocks the path
      piece("spy", "blue", "A7"),
    ]);
    expect(captureTargets(s, "A4")).not.toContain("A7");
  });

  it("has no Flank Charge when not on a flank column", () => {
    const s = makeState([
      piece("spear", "green", "C4"),
      piece("spy", "blue", "C7"), // ahead but not a flank column
    ]);
    expect(captureTargets(s, "C4")).not.toContain("C7");
  });

  it("cannot move or capture backward while on a flank column", () => {
    const s = makeState([
      piece("spear", "green", "A7"), // on flank A
      piece("spy", "blue", "B6"), // backward diagonal enemy
    ]);
    const t = allTargets(s, "A7");
    expect(t).toContain("B7"); // horizontal is fine
    expect(t).toContain("B8"); // forward diagonal is fine
    expect(t).not.toContain("B6"); // backward diagonal blocked on the flank
  });

  it("regains backward options after leaving the flank", () => {
    const s = makeState([piece("spear", "green", "C7")]); // off the flank
    const t = moveTargets(s, "C7");
    expect(t).toContain("B6"); // backward diagonal allowed again
    expect(t).toContain("D6");
  });
});
