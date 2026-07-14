import { describe, expect, it } from "vitest";
import { createInitialState } from "../../src/game/setup.ts";
import { applyMove } from "../../src/game/reducer.ts";
import { DEFAULT_SETTINGS } from "../src/config.ts";
import { buildTargetedJobs, runOpening, runStandard, runTargetedOpening, suspectedBlueFlagBearerPreset, targetedForcedPairingCount, targetedOpeningOptions, validateTargetedSettings, type RunnerControl } from "../src/simulation-runner.ts";

function control(cancelAfter = Infinity): RunnerControl {
  let progressCount = 0;
  return { isCancelled: () => progressCount >= cancelAfter, waitIfPaused: async () => {}, onProgress: () => { progressCount++; } };
}

describe("targeted opening mode", () => {

  it("automatic mode with two selected openings creates two jobs and forces only Green", () => {
    const [first, second] = targetedOpeningOptions();
    const settings = { ...DEFAULT_SETTINGS.targeted, blueResponseMode: "automatic" as const, selectedGreenOpenings: [first.label, second.label], selectedBlueRepliesByOpening: { [first.label]: [first.replies[0].label] } };
    const jobs = buildTargetedJobs(settings);
    expect(jobs).toHaveLength(2);
    expect(jobs.every((job) => job.prefix.length === 1)).toBe(true);
    expect(jobs.every((job) => job.blueReply === undefined)).toBe(true);
    expect(validateTargetedSettings(settings)).toHaveLength(0);
  });

  it("automatic mode lets configured Blue agent choose and exports actual Blue first move", async () => {
    const c1 = targetedOpeningOptions().find((o) => o.label.includes("C1-B1")) ?? targetedOpeningOptions()[0];
    const k1 = targetedOpeningOptions().find((o) => o.label.includes("K1-L1")) ?? targetedOpeningOptions()[1];
    const settings = { ...DEFAULT_SETTINGS.targeted, blueResponseMode: "automatic" as const, selectedGreenOpenings: [c1.label, k1.label], gamesPerMatchup: 1, greenAgent: "search-alpha-beta-deterministic" as const, blueAgent: "search-alpha-beta-deterministic" as const, searchDepth: 2, greenDiversity: 0 as const, blueDiversity: 0 as const, seed: 424242, maxPlies: 100, positionSampling: "none" as const, selectedBlueRepliesByOpening: { [c1.label]: [c1.replies[0].label] } };
    const result = await runTargetedOpening(settings, control());
    expect(result.games).toHaveLength(2);
    expect(result.summary.games).toBe(2);
    expect(result.games.every((game) => game.replayOk && game.metrics.illegalMoves === 0)).toBe(true);
    expect(result.games.every((game) => game.blueResponseMode === "automatic" && game.forcedBlueReply === null)).toBe(true);
    expect(result.games.every((game) => !!game.actualBlueFirstMove)).toBe(true);
    expect(result.files.find((file) => file.name === "game_summary.csv")?.content).toContain("actualBlueFirstMove");
    expect(result.metadata.blueResponseMode).toBe("automatic");
  });

  it("forced mode counts unequal selected reply pairings and rejects missing replies", () => {
    const [first, second, ...rest] = targetedOpeningOptions();
    const six = [first, second, ...rest.slice(0, 4)];
    const oneEach = { ...DEFAULT_SETTINGS.targeted, blueResponseMode: "forced" as const, selectedGreenOpenings: six.map((o) => o.label), selectedBlueRepliesByOpening: Object.fromEntries(six.map((o) => [o.label, [o.replies[0].label]])) };
    expect(buildTargetedJobs(oneEach)).toHaveLength(6);
    const uneven = { ...DEFAULT_SETTINGS.targeted, blueResponseMode: "forced" as const, selectedGreenOpenings: [first.label, second.label], selectedBlueRepliesByOpening: { [first.label]: [first.replies[0].label, first.replies[1].label], [second.label]: [second.replies[0].label] } };
    expect(targetedForcedPairingCount(uneven)).toBe(3);
    expect(buildTargetedJobs(uneven)).toHaveLength(3);
    expect(validateTargetedSettings({ ...uneven, selectedBlueRepliesByOpening: { [first.label]: [first.replies[0].label] } })).toContain(`Select at least one Blue reply for ${second.label}.`);
  });

  it("rejects zero selected Green openings", () => {
    expect(validateTargetedSettings({ ...DEFAULT_SETTINGS.targeted, blueResponseMode: "automatic", selectedGreenOpenings: [] })).toContain("Select at least one Green opening.");
  });

  it("preserves forced selections when switching modes and ignores stale replies in automatic", () => {
    const first = targetedOpeningOptions()[0];
    const selectedBlueRepliesByOpening = { [first.label]: [first.replies[0].label] };
    expect(buildTargetedJobs({ ...DEFAULT_SETTINGS.targeted, blueResponseMode: "automatic", selectedGreenOpenings: [first.label], selectedBlueRepliesByOpening })[0].prefix).toHaveLength(1);
    expect(buildTargetedJobs({ ...DEFAULT_SETTINGS.targeted, blueResponseMode: "forced", selectedGreenOpenings: [first.label], selectedBlueRepliesByOpening })[0].blueReply).toBe(first.replies[0].label);
  });

  it("seeded automatic runs are reproducible and metadata distinguishes modes", async () => {
    const first = targetedOpeningOptions()[0];
    const settings = { ...DEFAULT_SETTINGS.targeted, blueResponseMode: "automatic" as const, selectedGreenOpenings: [first.label], seed: 99, maxPlies: 12 };
    const a = await runTargetedOpening(settings, control());
    const b = await runTargetedOpening(settings, control());
    expect(a.games[0].moves).toEqual(b.games[0].moves);
    expect(a.metadata.blueResponseMode).toBe("automatic");
  });
  it("schedules only selected opening pairs", () => {
    const first = targetedOpeningOptions()[0];
    const settings = { ...DEFAULT_SETTINGS.targeted, blueResponseMode: "forced" as const, selectedGreenOpenings: [first.label], selectedBlueRepliesByOpening: { [first.label]: [first.replies[0].label] } };
    const jobs = buildTargetedJobs(settings);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].opening).toBe(first.label);
    expect(jobs[0].blueReply).toBe(first.replies[0].label);
  });

  it("legally applies forced moves and replay verification passes", async () => {
    const first = targetedOpeningOptions()[0];
    const result = await runTargetedOpening({ ...DEFAULT_SETTINGS.targeted, blueResponseMode: "forced", maxPlies: 8, selectedGreenOpenings: [first.label], selectedBlueRepliesByOpening: { [first.label]: [first.replies[0].label] } }, control());
    expect(result.games).toHaveLength(1);
    expect(result.games[0].replayOk).toBe(true);
    expect(result.games[0].forcedGreenOpening).toBe(first.label);
    expect(result.games[0].blueResponseMode).toBe("forced");
    expect(result.games[0].forcedBlueReply).toBe(first.replies[0].label);
    expect(result.games[0].actualBlueFirstMove).toBe(first.replies[0].label);
    expect(applyMove(applyMove(createInitialState(), first.move), first.replies[0].move)).not.toBe(createInitialState());
  });

  it("suspected Blue Flag Bearer preset produces 68 matchups", () => {
    const jobs = buildTargetedJobs(suspectedBlueFlagBearerPreset());
    expect(jobs).toHaveLength(68);
    expect(jobs.filter((j) => /G13-E11/.test(j.blueReply))).toHaveLength(34);
    expect(jobs.filter((j) => /G13-I11/.test(j.blueReply))).toHaveLength(34);
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
    expect(result.openingRows.length).toBe(targetedOpeningOptions().length);
  });

  it("leaves standard self-play unchanged", async () => {
    const result = await runStandard({ ...DEFAULT_SETTINGS.standard, games: 1, maxPlies: 4 }, control());
    expect(result.games).toHaveLength(1);
    expect(result.metadata.runMode).toBe("standard");
  });
});
