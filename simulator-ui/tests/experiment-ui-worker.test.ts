import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

describe("experiment worker and replay UI integration", () => {
  it("uses a dedicated experiment worker message contract", () => {
    const worker = readFileSync(new URL("../src/experiment-worker.ts", import.meta.url), "utf8");
    expect(worker).toContain("job-started");
    expect(worker).toContain("job-completed");
    expect(worker).toContain("job-failed");
    expect(worker).toContain("progress");
    expect(worker).toContain("cancelled");
    expect(worker).toContain("runJobGame");
  });

  it("exposes completed-game browser filters, pagination, and replay controls", () => {
    const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
    for (const token of ["data-filter=\"winner\"", "data-filter=\"drawReason\"", "data-filter=\"opening\"", "data-filter=\"actualBlueFirstMove\"", "data-filter=\"forcedBlueReply\"", "data-filter=\"minPlies\"", "data-filter=\"maxPlies\"", "data-filter=\"replayFailure\"", "data-filter=\"sortBy\"", "next-page", "prev-page"]) expect(main).toContain(token);
    for (const token of ["data-replay=\"start\"", "data-replay=\"prev\"", "data-replay=\"play\"", "data-replay=\"pause\"", "data-replay=\"next\"", "data-replay=\"end\"", "data-replay-speed", "replay-grid"]) expect(main).toContain(token);
  });
});

describe("Phase 2 analysis UI controls", () => {
  it("exposes comparison, table-control, editable proposal, and auto-analysis UI", () => {
    const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
    for (const token of ["comparison-ui", "compare-source", "data-compare-target", "run-comparison", "compatibilityFields", "Warning: incompatible settings"]) expect(main).toContain(token);
    for (const token of ["data-analysis-control=\"openingSort\"", "openingFlagged", "mirrorSampled", "replyDominant", "flagCategory", "flagDismissed", "slice(0,50)"]) expect(main).toContain(token);
    for (const token of ["proposal-editor", "proposal-openings", "proposal-replies", "submit-proposal", "Estimated total games", "Fields changed from source"]) expect(main).toContain(token);
    expect(main).toContain("exp-auto-analysis");
    expect(main).toContain("maybeAutoAnalyzeExperiment");
  });
});
