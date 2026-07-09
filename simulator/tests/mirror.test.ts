import { describe, expect, it } from "vitest";
import { createInitialState } from "../../src/game/setup.ts";
import { applyMove } from "../../src/game/reducer.ts";
import type { GameState, Move } from "../../src/game/types.ts";
import { diagnosticBreakdown, legalMovesForState, positionKey, selectMoveDetailed } from "../agents.ts";
import { mirrorMove, mirrorState } from "../mirror.ts";

function moveKey(move: Move): string {
  return `${move.pieceId}:${move.to.col},${move.to.row}`;
}

function legalKeys(state: GameState): string[] {
  return legalMovesForState(state).map(moveKey).sort();
}

function mirroredLegalKeys(state: GameState): string[] {
  return legalMovesForState(state).map((m) => moveKey(mirrorMove(m))).sort();
}

function expectMirrored(a: GameState, b: GameState) {
  expect(positionKey(mirrorState(a))).toBe(positionKey(b));
}

function samplePositions(limit: number): GameState[] {
  let state = createInitialState();
  const out: GameState[] = [state];
  for (let ply = 0; ply < 300 && out.length < limit; ply++) {
    const selection = selectMoveDetailed(state, "heuristic-diverse", {
      seed: 10_000 + ply * 7919 + (state.current === "green" ? 0 : 31337),
      searchDepth: 2,
      diversity: 1,
    });
    if (!selection.move) break;
    const next = applyMove(state, selection.move);
    if (next === state) break;
    state = next;
    out.push(state);
    if (state.winner) state = createInitialState();
  }
  return out;
}

describe("left-right mirror symmetry", () => {
  it("initial position legal moves mirror exactly", () => {
    const initial = createInitialState();
    expect(legalKeys(mirrorState(initial))).toEqual(mirroredLegalKeys(initial));
  });

  it("sampled completed-game positions have mirrored legal move sets", () => {
    for (const state of samplePositions(100)) {
      expect(legalKeys(mirrorState(state))).toEqual(mirroredLegalKeys(state));
    }
  });

  it("applying a move and its mirror produces mirrored states", () => {
    for (const state of samplePositions(100)) {
      for (const move of legalMovesForState(state).slice(0, 3)) {
        const next = applyMove(state, move);
        const mirroredNext = applyMove(mirrorState(state), mirrorMove(move));
        expect(next).not.toBe(state);
        expect(mirroredNext).not.toBe(mirrorState(state));
        expectMirrored(next, mirroredNext);
      }
    }
  });

  it("evaluation component scores are identical for mirrored positions", () => {
    for (const state of samplePositions(100)) {
      expect(diagnosticBreakdown(mirrorState(state), state.current)).toEqual(diagnosticBreakdown(state, state.current));
    }
  });

  it("heuristic deterministic selects mirrored moves", () => {
    for (const state of samplePositions(100)) {
      if (positionKey(state) === positionKey(mirrorState(state))) continue;
      const a = selectMoveDetailed(state, "heuristic-deterministic", { seed: 77 });
      const b = selectMoveDetailed(mirrorState(state), "heuristic-deterministic", { seed: 77 });
      if (!a.move || !b.move) continue;
      expect(moveKey(b.move)).toBe(moveKey(mirrorMove(a.move)));
    }
  });

  it("search deterministic selects mirrored moves and principal variations", () => {
    for (const state of samplePositions(25)) {
      if (positionKey(state) === positionKey(mirrorState(state))) continue;
      const a = selectMoveDetailed(state, "search-deterministic", { seed: 77, searchDepth: 2 });
      const b = selectMoveDetailed(mirrorState(state), "search-deterministic", { seed: 77, searchDepth: 2 });
      if (!a.move || !b.move) continue;
      expect(moveKey(b.move)).toBe(moveKey(mirrorMove(a.move)));
      expect(b.principalVariation.map(moveKey)).toEqual(a.principalVariation.map((m) => moveKey(mirrorMove(m))));
    }
  });

  it("diverse agents using paired seeds choose mirrored moves when scores are symmetric", () => {
    for (const state of samplePositions(100)) {
      if (positionKey(state) === positionKey(mirrorState(state))) continue;
      const a = selectMoveDetailed(state, "heuristic-diverse", { seed: 123, diversity: 1 });
      const b = selectMoveDetailed(mirrorState(state), "heuristic-diverse", { seed: 123, diversity: 1 });
      if (!a.move || !b.move) continue;
      expect(moveKey(b.move)).toBe(moveKey(mirrorMove(a.move)));
    }
  });
});
