import { describe, expect, it } from "vitest";
import { createInitialState } from "../src/game/setup.ts";
import { applyMove } from "../src/game/reducer.ts";
import type { GameState, Move } from "../src/game/types.ts";
import { diagnosticBreakdown, EVALUATION_WEIGHTS, legalMovesForState, positionKey } from "../simulator/agents.ts";
import { isMeaningfulProgressTransition, runForcedLineForRepetitionTest, runStandard } from "../simulator-ui/src/simulation-runner.ts";

const control = { isCancelled: () => false, waitIfPaused: async () => {}, onProgress: () => {} };

function clone(state: GameState): GameState {
  return structuredClone(state);
}

function fourPlyCycle(): Move[] {
  const s0 = createInitialState();
  const m1 = legalMovesForState(s0).find((m) => m.pieceId === "green-spear-1" && m.to.col === 1 && m.to.row === 0)!;
  const s1 = applyMove(s0, m1);
  const m2 = legalMovesForState(s1).find((m) => m.pieceId === "blue-guard-1" && m.to.col === 3 && m.to.row === 9)!;
  const s2 = applyMove(s1, m2);
  const m3 = legalMovesForState(s2).find((m) => m.pieceId === "green-spear-1" && m.to.col === 2 && m.to.row === 0)!;
  const s3 = applyMove(s2, m3);
  const m4 = legalMovesForState(s3).find((m) => m.pieceId === "blue-guard-1" && m.to.col === 3 && m.to.row === 10)!;
  return [m1, m2, m3, m4];
}

describe("position repetition keys", () => {
  it("a four-ply A-B-A-B cycle returns to the same canonical key despite a different lastMove", () => {
    const s0 = createInitialState();
    const [m1, m2, m3, m4] = fourPlyCycle();
    const s4 = applyMove(applyMove(applyMove(applyMove(s0, m1), m2), m3), m4);
    expect(s4.lastMove).not.toEqual(s0.lastMove);
    expect(positionKey(s4)).toBe(positionKey(s0));
  });

  it("distinguishes player to move, timer, wall, flag, forced-departure, unladen, and engineer-removal state", () => {
    const base = createInitialState();
    const blueTurn = clone(base); blueTurn.current = "blue";
    const gateOpen = clone(base); gateOpen.walls.west = false;
    const timed = clone(base); timed.extractionTurnsRemaining = 2;
    const carried = clone(base); carried.flag = { square: null, carrierId: base.pieces.find((p) => p.type === "flagBearer" && p.player === "green")!.id };
    const forced = clone(base); forced.forcedGateDeparture = true;
    const unladen = clone(base); unladen.unladenSanctuary = { pieceId: "green-flagBearer-1", player: "green", stage: "bufferPending" };
    const removed = clone(base); removed.engineersRemoved = true;
    expect(positionKey(base)).not.toEqual(positionKey(blueTurn));
    expect(positionKey(base)).not.toEqual(positionKey(gateOpen));
    expect(positionKey(base)).not.toEqual(positionKey(timed));
    expect(positionKey(base)).not.toEqual(positionKey(carried));
    expect(positionKey(base)).not.toEqual(positionKey(forced));
    expect(positionKey(base)).not.toEqual(positionKey(unladen));
    expect(positionKey(base)).not.toEqual(positionKey(removed));
  });

  it("applies graduated repetition and stagnation penalties", () => {
    const state = createInitialState();
    const recent = new Map([[positionKey(state), 2]]);
    const b = diagnosticBreakdown(state, "green", { recentPositions: recent, currentNoProgressPlies: 3 });
    expect(b.repetitionPenalty).toBe(EVALUATION_WEIGHTS.repeatedPositionSecond);
    expect(b.stagnationPenalty).toBe(3 * EVALUATION_WEIGHTS.stagnationPerPly);
  });
});

describe("simulation repetition termination", () => {
  it("detects threefold repetition in the four-ply cycle before max plies", () => {
    const cycle = fourPlyCycle();
    const result = runForcedLineForRepetitionTest([...cycle, ...cycle], 100, 40);
    expect(result.drawReason).toBe("threefold-repetition");
    expect(result.plies).toBe(8);
    expect(result.repetitionDiagnostics.repetitionDraw).toBe(true);
    expect(result.repetitionDiagnostics.fourPlyCycles).toBeGreaterThan(0);
  });

  it("terminates deterministic no-progress games before max plies", async () => {
    const result = await runStandard({
      games: 1,
      greenAgent: "random",
      blueAgent: "random",
      greenDiversity: 0,
      blueDiversity: 0,
      searchDepth: 1,
      seed: 1,
      maxPlies: 100,
      noProgressPlyLimit: 2,
      positionSampling: "none",
    }, control);
    expect(result.games[0].drawReason).toBe("no-progress");
    expect(result.games[0].plies).toBeLessThan(100);
    expect(result.games[0].repetitionDiagnostics.noProgressDraw).toBe(true);
  });

  it("immediate-reversal diagnostics count each legitimately played reversal once", () => {
    const [m1, m2, m3] = fourPlyCycle();
    const result = runForcedLineForRepetitionTest([m1, m2, m3], 100, 40);
    const reversedMoves = result.selectedMoveDiagnostics
      .filter((diagnostic) => diagnostic.reversedPreviousMove)
      .map((diagnostic) => diagnostic.move);

    expect(reversedMoves).toEqual([
      "green-spear-1:B1-C1",
      "blue-horse-1:F10-G12",
      "blue-guard-2:I12-I11",
      "blue-flagBearer-1:E11-E12",
    ]);
    expect(result.repetitionDiagnostics.immediateReversals).toBe(reversedMoves.length);
  });
});

describe("meaningful progress", () => {
  it("uses structured state comparisons for timer changes even without event wording", () => {
    const before = createInitialState();
    const after = clone(before);
    after.extractionTurnsRemaining = 2;
    expect(isMeaningfulProgressTransition(before, after, "")).toBe(true);
  });

  it("keeps event wording covered by centralized parsing", () => {
    const before = createInitialState();
    const after = clone(before);
    expect(isMeaningfulProgressTransition(before, after, "Green Flag Bearer took the flag")).toBe(true);
  });
});

describe("search repetition awareness", () => {
  it("penalizes returning to an already visited position", () => {
    const state = createInitialState();
    const move = legalMovesForState(state)[0];
    const next = applyMove(state, move);
    expect(next).not.toBe(state);
    const recent = new Map([[positionKey(next), 2]]);
    const b = diagnosticBreakdown(next, state.current, { recentPositions: recent });
    expect(b.repetitionPenalty).toBe(EVALUATION_WEIGHTS.repeatedPositionSecond);
  });
});
