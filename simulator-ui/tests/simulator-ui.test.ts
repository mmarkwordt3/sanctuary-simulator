import { describe, expect, it } from "bun:test";
import { applyMove } from "../../src/game/reducer.ts";
import { createInitialState } from "../../src/game/setup.ts";
import { legalMovesForState, selectMoveDetailed } from "../../simulator/agents.ts";
import { DEFAULT_SETTINGS, agentUsesDiversity, agentUsesSearchDepth } from "../src/config.ts";
import { makeZip } from "../src/exporters.ts";
import { runOpening, runStandard, type RunnerControl } from "../src/simulation-runner.ts";
import type { WorkerRequest, WorkerResponse } from "../src/worker.ts";

function control(cancelAfter = Infinity): RunnerControl {
  let progressCount = 0;
  return {
    isCancelled: () => progressCount >= cancelAfter,
    waitIfPaused: async () => {},
    onProgress: () => { progressCount++; },
  };
}

describe("simulator UI runner", () => {
  it("has beginner-friendly form defaults", () => {
    expect(DEFAULT_SETTINGS.standard.games).toBe(100);
    expect(DEFAULT_SETTINGS.standard.greenAgent).toBe("heuristic-diverse");
    expect(DEFAULT_SETTINGS.standard.blueAgent).toBe("heuristic-diverse");
    expect(DEFAULT_SETTINGS.standard.greenDiversity).toBe(1);
    expect(DEFAULT_SETTINGS.standard.searchDepth).toBe(2);
    expect(DEFAULT_SETTINGS.standard.seed).toBe(12345);
    expect(DEFAULT_SETTINGS.standard.maxPlies).toBe(500);
  });

  it("identical settings and seeds produce identical results", async () => {
    const settings = { ...DEFAULT_SETTINGS.standard, games: 2, seed: 7, maxPlies: 80 };
    const a = await runStandard(settings, control());
    const b = await runStandard(settings, control());
    expect(a.games.map((g) => g.moves)).toEqual(b.games.map((g) => g.moves));
    expect(a.summary).toEqual(b.summary);
  });

  it("different seeds produce varied results in diverse mode", async () => {
    const base = { ...DEFAULT_SETTINGS.standard, games: 3, maxPlies: 100, greenAgent: "heuristic-diverse" as const, blueAgent: "heuristic-diverse" as const };
    const a = await runStandard({ ...base, seed: 1 }, control());
    const b = await runStandard({ ...base, seed: 99 }, control());
    expect(a.games.map((g) => g.first10).join("|")).not.toEqual(b.games.map((g) => g.first10).join("|"));
  });

  it("all selected moves are legal", () => {
    const state = createInitialState();
    const selected = selectMoveDetailed(state, "heuristic-diverse", { seed: 1, diversity: 1 }).move!;
    expect(legalMovesForState(state).some((m) => m.pieceId === selected.pieceId && m.to.col === selected.to.col && m.to.row === selected.to.row)).toBe(true);
    expect(applyMove(state, selected)).not.toBe(state);
  });

  it("replay verification passes for generated games", async () => {
    const result = await runStandard({ ...DEFAULT_SETTINGS.standard, games: 2, maxPlies: 80 }, control());
    expect(result.summary.replayFailures).toBe(0);
    expect(result.games.every((g) => g.replayOk)).toBe(true);
  });

  it("supports cancellation", async () => {
    const result = await runStandard({ ...DEFAULT_SETTINGS.standard, games: 10, maxPlies: 80 }, control(1));
    expect(result.cancelled).toBe(true);
    expect(result.games.length).toBeLessThan(10);
  });

  it("generates output files and a zip blob", async () => {
    const result = await runStandard({ ...DEFAULT_SETTINGS.standard, games: 1, maxPlies: 80 }, control());
    const names = result.files.map((f) => f.name);
    expect(names).toContain("games.jsonl");
    expect(names).toContain("positions.jsonl");
    expect(names).toContain("game_summary.csv");
    expect(names).toContain("run_metadata.json");
    expect(names).toContain("analysis_summary.md");
    expect(makeZip(result.files).size).toBeGreaterThan(0);
  });

  it("covers every legal Green first move in opening exploration", async () => {
    const result = await runOpening({ ...DEFAULT_SETTINGS.opening, gamesPerOpening: 1, maxPlies: 40 }, control());
    expect(new Set(result.openingRows.map((r) => String(r.opening))).size).toBe(legalMovesForState(createInitialState()).length);
  }, 15_000);

  it("identifies irrelevant depth and diversity settings for visual de-emphasis", () => {
    expect(agentUsesDiversity("heuristic-diverse")).toBe(true);
    expect(agentUsesDiversity("heuristic-deterministic")).toBe(false);
    expect(agentUsesSearchDepth("search-diverse")).toBe(true);
    expect(agentUsesSearchDepth("legacy-heuristic")).toBe(false);
  });

  it("exchanges messages with the Web Worker", async () => {
    const worker = new Worker(new URL("../src/worker.ts", import.meta.url), { type: "module" });
    const done = new Promise<WorkerResponse>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("worker timed out")), 10_000);
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        if (event.data.type === "complete") { clearTimeout(timeout); resolve(event.data); }
      };
      worker.onerror = (event) => { clearTimeout(timeout); reject(event.error ?? new Error(event.message)); };
    });
    worker.postMessage({ type: "start-standard", settings: { ...DEFAULT_SETTINGS.standard, games: 1, maxPlies: 60, greenAgent: "random", blueAgent: "random" } } satisfies WorkerRequest);
    const message = await done;
    worker.terminate();
    expect(message.type).toBe("complete");
  });
});

import { readFileSync } from "node:fs";

describe("simulator UI layout", () => {
  it("keeps advanced move constraints collapsed and summarizes forced moves", () => {
    const source = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
    expect(source).toContain("<details id=\"advanced-constraints\">");
    expect(source).toContain("Advanced move constraints");
    expect(source).toContain("targeted-summary");
    expect(source).toContain("if (!document.querySelector<HTMLDetailsElement>(\"#advanced-constraints\")?.open)");
  });


  it("documents Phase 4 queue loading, empty, success, and failure UI states", () => {
    const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
    expect(main).toContain("Queue load failed:");
    expect(main).toContain("No queued tuning jobs yet.");
    expect(main).toContain("Job added:");
    expect(main).toContain("Job add failed:");
    expect(main).toContain("queueInitialized");
  });

  it("loads small validation presets into every Section 9 field needed by the queue", () => {
    const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
    for (const id of ["#tune-name", "#tune-baseline", "#tune-candidates", "#tune-generations", "#tune-depth", "#tune-games", "#tune-seeds", "#tune-seed-start", "#tune-rate", "#tune-magnitude", "#tune-elites", "#tune-max-plies", "#tune-no-progress", "#tune-openings", "#tune-auto-pause", "#tune-mirrored", "#tune-baseline-matches", "#tune-peer-matches"]) {
      expect(main).toContain(id);
    }
    expect(main).toContain("Preset loaded into editor");
  });

  it("keeps run controls in a sticky panel with visible progress", () => {
    const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
    const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
    expect(main).toContain("run-panel");
    expect(main).toContain("sticky-progress-text");
    expect(css).toContain("position: sticky");
    expect(css).toContain("position: fixed");
    expect(css).toContain(".scroll-list { max-height");
  });

  it("documents Phase 5 planner controls and safety copy", () => {
    const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
    expect(main).toContain("11. Phase 5 / Automated Tuning Planner");
    for (const id of ["#planner-analyze", "#planner-generate", "#planner-add", "#planner-export", "#planner-dashboard"]) expect(main).toContain(id);
    expect(main).toContain("never auto-promotes candidates and never starts the queue");
    expect(main).toContain("Queue remains paused");
  });

  it("documents positive manual-review recommendation UI fields for Section 9 and Phase 4 queue", () => {
    const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
    expect(main).toContain("Champion is baseline");
    expect(main).toContain("Selected baseline");
    expect(main).toContain("Final-generation best");
    expect(main).toContain("Manual review required");
    expect(main).toContain("Approve as experimental profile");
    expect(main).toContain("Reject candidate");
    expect(main).toContain("eligible manual promotion");
    expect(main).toContain("never auto-promotes candidates");
  });
});
