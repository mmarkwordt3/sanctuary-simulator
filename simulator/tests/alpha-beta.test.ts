import { describe, expect, it } from "vitest";
import { createInitialState } from "../../src/game/setup.ts";
import { applyMove } from "../../src/game/reducer.ts";
import { benchmarkSearchSelection, legalMovesForState, selectMoveDetailed } from "../agents.ts";
import { mirrorMove, mirrorState } from "../mirror.ts";

const key = (m: any) => `${m?.pieceId}:${m?.to.col},${m?.to.row}`;

function representativePositions() {
  let state = createInitialState();
  const out = [state];
  for (let i = 0; i < 4; i++) {
    const move = selectMoveDetailed(state, "heuristic-deterministic", { seed: 100 + i }).move!;
    state = applyMove(state, move);
    out.push(state);
  }
  return out;
}

describe("alpha-beta search", () => {
  it("matches full minimax search at small depths", () => {
    for (const state of representativePositions()) {
      const full = selectMoveDetailed(state, "search-deterministic", { seed: 7, searchDepth: 2 });
      const ab = selectMoveDetailed(state, "search-alpha-beta-deterministic", { seed: 7, searchDepth: 2 });
      expect(key(ab.move)).toBe(key(full.move));
      expect(ab.selectedScore).toBe(full.selectedScore);
    }
  });

  it("returns mirrored selected moves", () => {
    for (const state of representativePositions().slice(1)) {
      const ab = selectMoveDetailed(state, "search-alpha-beta-deterministic", { seed: 77, searchDepth: 2 });
      const mirrored = selectMoveDetailed(mirrorState(state), "search-alpha-beta-deterministic", { seed: 77, searchDepth: 2 });
      expect(key(mirrored.move)).toBe(key(mirrorMove(ab.move!)));
    }
  });

  it("reports diagnostics, cache hits/cutoffs, and legal principal variation moves", () => {
    const result = selectMoveDetailed(createInitialState(), "search-alpha-beta-deterministic", { seed: 5, searchDepth: 3 });
    expect(result.diagnostics?.completedDepth).toBe(3);
    expect(result.diagnostics?.nodesSearched).toBeGreaterThan(0);
    expect(result.diagnostics?.leafEvaluations).toBeGreaterThan(0);
    expect(result.diagnostics?.alphaBetaCutoffs).toBeGreaterThan(0);
    let state = createInitialState();
    for (const move of result.principalVariation) {
      expect(legalMovesForState(state).some((m) => key(m) === key(move))).toBe(true);
      state = applyMove(state, move);
    }
  });

  it("uses the last fully completed depth when timed out", () => {
    const result = selectMoveDetailed(createInitialState(), "search-alpha-beta-deterministic", { seed: 5, searchDepth: 4, timeLimitMs: 100 });
    expect(result.diagnostics?.completedDepth).toBeGreaterThanOrEqual(1);
    expect(result.diagnostics?.completedDepth).toBeLessThan(4);
  });

  it("is deterministic for the same seed", () => {
    const a = selectMoveDetailed(createInitialState(), "search-alpha-beta-deterministic", { seed: 22, searchDepth: 2 });
    const b = selectMoveDetailed(createInitialState(), "search-alpha-beta-deterministic", { seed: 22, searchDepth: 2 });
    expect(key(a.move)).toBe(key(b.move));
    expect(a.selectedScore).toBe(b.selectedScore);
  });

  it("benchmark equivalence instruments full minimax and alpha-beta", () => {
    const full = benchmarkSearchSelection(createInitialState(), "search-deterministic", { seed: 1, searchDepth: 3 });
    const ab = benchmarkSearchSelection(createInitialState(), "search-alpha-beta-deterministic", { seed: 1, searchDepth: 3 });
    expect(key(ab.selectedMove)).toBe(key(full.selectedMove));
    expect(ab.score).toBe(full.score);
    expect(ab.nodesSearched).toBeLessThanOrEqual(full.nodesSearched);
    expect(ab.alphaBetaCutoffs).toBeGreaterThan(0);
    expect({ selectedMove: key(ab.selectedMove), score: ab.score, fullNodes: full.nodesSearched, alphaBetaNodes: ab.nodesSearched, elapsedMs: ab.elapsedMs, cutoffCount: ab.alphaBetaCutoffs, cacheHitCount: ab.transpositionTableHits }).toBeTruthy();
  });
});
