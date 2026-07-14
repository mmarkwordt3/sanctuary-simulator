import { describe, expect, it } from "vitest";
import { createInitialState } from "../../src/game/setup.ts";
import { applyMove } from "../../src/game/reducer.ts";
import { fromCoord } from "../../src/game/coords.ts";
import { positionKey, selectMoveDetailed } from "../../simulator/agents.ts";
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
    const initial = createInitialState();
    const afterOpening = applyMove(initial, c1.move);
    const openingPiece = initial.pieces.find((piece) => piece.id === c1.move.pieceId)!;
    const settings = { ...DEFAULT_SETTINGS.targeted, blueResponseMode: "automatic" as const, selectedGreenOpenings: [c1.label], gamesPerMatchup: 1, greenAgent: "search-alpha-beta-deterministic" as const, blueAgent: "search-alpha-beta-deterministic" as const, searchDepth: 1, greenDiversity: 0 as const, blueDiversity: 0 as const, seed: 424242, maxPlies: 2, positionSampling: "none" as const, selectedBlueRepliesByOpening: { [c1.label]: [c1.replies[0].label] } };
    const expectedBlueSelection = selectMoveDetailed(afterOpening, settings.blueAgent, {
      seed: settings.seed + 7919 + 31337,
      recentPositions: new Map([[positionKey(initial), 1], [positionKey(afterOpening), 1]]),
      previousMove: { pieceId: c1.move.pieceId, from: { col: openingPiece.col, row: openingPiece.row }, to: c1.move.to },
      searchDepth: settings.searchDepth,
      diversity: settings.blueDiversity,
      timeLimitMs: settings.timeLimitMs,
      currentNoProgressPlies: 1,
    });
    const expectedBlueMove = expectedBlueSelection.move!;
    const expectedBluePiece = afterOpening.pieces.find((piece) => piece.id === expectedBlueMove.pieceId)!;
    const expectedBlueLabel = `${expectedBlueMove.pieceId}:${fromCoord(expectedBluePiece)}-${fromCoord(expectedBlueMove.to)}`;

    const result = await runTargetedOpening(settings, control());

    expect(result.games).toHaveLength(1);
    expect(result.summary.games).toBe(1);
    expect(result.games[0].moves).toHaveLength(2);
    expect(result.games[0].moves[0]).toBe(c1.label);
    expect(result.games[0].replayOk).toBe(true);
    expect(result.games[0].metrics.illegalMoves).toBe(0);
    expect(result.games[0].blueResponseMode).toBe("automatic");
    expect(result.games[0].forcedBlueReply).toBeNull();
    expect(result.games[0].actualBlueFirstMove).toBe(expectedBlueLabel);
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
    const settings = { ...DEFAULT_SETTINGS.targeted, blueResponseMode: "automatic" as const, selectedGreenOpenings: [first.label], searchDepth: 1, seed: 99, maxPlies: 4 };
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
