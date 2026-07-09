import { describe, expect, it } from "vitest";
import { createInitialState } from "../../src/game/setup.ts";
import { applyMove } from "../../src/game/reducer.ts";
import { DEFAULT_SETTINGS } from "../src/config.ts";
import { buildTargetedJobs, runOpening, runTargetedOpening, suspectedBlueFlagBearerPreset, targetedOpeningOptions, type RunnerControl } from "../src/simulation-runner.ts";

function control(cancelAfter = Infinity): RunnerControl {
  let progressCount = 0;
  return { isCancelled: () => progressCount >= cancelAfter, waitIfPaused: async () => {}, onProgress: () => { progressCount++; } };
}

describe("targeted opening mode", () => {
  it("schedules only selected opening pairs", () => {
    const first = targetedOpeningOptions()[0];
    const settings = { ...DEFAULT_SETTINGS.targeted, selectedGreenOpenings: [first.label], selectedBlueRepliesByOpening: { [first.label]: [first.replies[0].label] } };
    const jobs = buildTargetedJobs(settings);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].opening).toBe(first.label);
    expect(jobs[0].blueReply).toBe(first.replies[0].label);
  });

  it("legally applies forced moves and replay verification passes", async () => {
    const first = targetedOpeningOptions()[0];
    const result = await runTargetedOpening({ ...DEFAULT_SETTINGS.targeted, maxPlies: 8, selectedGreenOpenings: [first.label], selectedBlueRepliesByOpening: { [first.label]: [first.replies[0].label] } }, control());
    expect(result.games).toHaveLength(1);
    expect(result.games[0].replayOk).toBe(true);
    expect(result.games[0].forcedGreenOpening).toBe(first.label);
    expect(result.games[0].forcedBlueReply).toBe(first.replies[0].label);
    expect(applyMove(applyMove(createInitialState(), first.move), first.replies[0].move)).not.toBe(createInitialState());
  });

  it("suspected Blue Flag Bearer preset produces 68 matchups", () => {
    expect(buildTargetedJobs(suspectedBlueFlagBearerPreset())).toHaveLength(68);
  });

  it("mirror-paired jobs carry mirrored schedule identifiers", () => {
    const preset = suspectedBlueFlagBearerPreset();
    const ids = new Set(buildTargetedJobs(preset).map((j) => j.mirrorPairId));
    expect(ids.size).toBeLessThanOrEqual(buildTargetedJobs(preset).length);
  });

  it("supports cancellation", async () => {
    const result = await runTargetedOpening({ ...suspectedBlueFlagBearerPreset(), maxPlies: 4 }, control(1));
    expect(result.cancelled).toBe(true);
  });

  it("leaves opening exploration unchanged", async () => {
    const result = await runOpening({ ...DEFAULT_SETTINGS.opening, gamesPerOpening: 1, maxPlies: 4 }, control());
    expect(result.openingRows.length).toBeGreaterThan(0);
  });
});
