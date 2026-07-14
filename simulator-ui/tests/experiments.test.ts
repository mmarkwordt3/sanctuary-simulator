import { describe, expect, it } from "bun:test";
import { DEFAULT_SETTINGS } from "../src/config.ts";
import { estimateExperiment, generateJobs, runJobGame } from "../src/experiments.ts";
import { replayStoredGame, targetedOpeningOptions } from "../src/simulation-runner.ts";

const acceptance = {
  mode: "targeted" as const,
  ...DEFAULT_SETTINGS.targeted,
  selectedGreenOpenings: targetedOpeningOptions().filter((o) => o.label.includes("C1-B1") || o.label.includes("K1-L1")).map((o) => o.label),
  blueResponseMode: "automatic" as const,
  selectedBlueRepliesByOpening: {},
  gamesPerMatchup: 2,
  greenAgent: "search-alpha-beta-deterministic" as const,
  blueAgent: "search-alpha-beta-deterministic" as const,
  searchDepth: 1,
  greenDiversity: 0 as const,
  blueDiversity: 0 as const,
  seed: 424242,
  maxPlies: 40,
  positionSampling: "none" as const,
};

describe("automated experiment job generation", () => {
  it("standard generation produces the requested count and deterministic seeds", () => {
    const settings = { mode: "standard" as const, ...DEFAULT_SETTINGS.standard, games: 3, seed: 10 };
    expect(generateJobs("exp-a", settings).map((j) => j.seed)).toEqual([10, 11, 12]);
    expect(generateJobs("exp-a", settings).map((j) => j.jobId)).toEqual(generateJobs("exp-a", settings).map((j) => j.jobId));
  });

  it("opening exploration covers every legal Green opening", () => {
    const settings = { mode: "opening" as const, ...DEFAULT_SETTINGS.opening, gamesPerOpening: 1, forceBlueReplies: false };
    expect(generateJobs("exp-b", settings)).toHaveLength(targetedOpeningOptions().length);
  });

  it("targeted automatic creates one job per selected opening per game", () => {
    expect(estimateExperiment(acceptance).totalJobs).toBe(4);
    const jobs = generateJobs("exp-c", acceptance);
    expect(jobs).toHaveLength(4);
    expect(jobs.every((j) => j.blueResponseMode === "automatic" && !j.forcedBlueReply)).toBe(true);
  });

  it("targeted forced sums selected reply pairings", () => {
    const [first, second] = targetedOpeningOptions();
    const settings = { mode: "targeted" as const, ...DEFAULT_SETTINGS.targeted, blueResponseMode: "forced" as const, selectedGreenOpenings: [first.label, second.label], selectedBlueRepliesByOpening: { [first.label]: first.replies.slice(0, 2).map((r) => r.label), [second.label]: second.replies.slice(0, 1).map((r) => r.label) } };
    expect(generateJobs("exp-d", settings)).toHaveLength(3);
  });
});

describe("automated experiment acceptance smoke", () => {
  it("runs the low-cost acceptance jobs with replay verification", () => {
    const jobs = generateJobs("exp-accept", acceptance);
    const games = jobs.map((job) => runJobGame({ experimentId: "exp-accept", name: "Automated Self-Play Acceptance", createdAt: "", updatedAt: "", status: "running", mode: "targeted", settings: acceptance, totalJobs: jobs.length, queuedJobs: 0, runningJobs: 1, completedJobs: 0, failedJobs: 0, cancelledJobs: 0, greenWins: 0, blueWins: 0, draws: 0, currentJobId: job.jobId, lastCompletedJobId: null, simulatorVersion: "test", repositoryCommit: "test", schemaVersion: 1, activeMs: 0 }, job));
    expect(games).toHaveLength(4);
    expect(new Set(games.map((g) => `${g.seed}:${g.moves.join(" ")}`)).size).toBe(4);
    expect(games.every((game) => replayStoredGame(game).ok)).toBe(true);
  });
});
