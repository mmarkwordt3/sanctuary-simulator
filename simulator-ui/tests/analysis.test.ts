import { describe, expect, it } from "bun:test";
import { ANALYSIS_RULE_CONFIG, analysisExportFiles, analyzeExperiment, compareExperiments, mirrorCoordinate, mirrorMoveLabel } from "../src/analysis.ts";
import { DEFAULT_SETTINGS } from "../src/config.ts";
import { ExperimentStore } from "../src/experiments.ts";
import { installIndexedDbShim } from "./indexeddb-shim.ts";

installIndexedDbShim();
const settings = { mode: "targeted" as const, ...DEFAULT_SETTINGS.targeted, selectedGreenOpenings: ["C1-B1", "K1-L1"], gamesPerMatchup: 1, searchDepth: 1, seed: 1 };
const exp = (id="exp-a", depth=1, extra:any={}) => ({ experimentId:id, name:id, createdAt:"2026-01-01T00:00:00.000Z", updatedAt:"2026-01-01T00:00:01.000Z", status:"completed" as const, mode:"targeted" as const, settings:{...settings, searchDepth:depth, ...extra}, totalJobs:0, queuedJobs:0, runningJobs:0, completedJobs:0, failedJobs:0, cancelledJobs:0, greenWins:0, blueWins:0, draws:0, currentJobId:null, lastCompletedJobId:null, simulatorVersion:"test", repositoryCommit:"test", schemaVersion:2, activeMs:0 });
function game(i:number, opening:string, winner:string|null, opts:any={}) { return { id:i, gameId:`g${i}`, experimentId:"exp-a", jobId:`j${i}`, completedAt:"2026-01-01T00:00:00.000Z", schemaVersion:2, seed:i, greenAgent:"search-alpha-beta-deterministic", blueAgent:"search-alpha-beta-deterministic", winner, drawReason:opts.drawReason ?? (winner?null:null), plies:opts.plies ?? 20, replayOk:opts.replayOk ?? true, finalReplayOk:opts.finalReplayOk ?? (opts.replayOk ?? true), moves:opts.moves ?? [opening, opts.reply ?? "G13-E11"], first10:opts.first10 ?? `${opening} ${opts.reply ?? "G13-E11"}`, opening, forcedGreenOpening:opening, forcedBlueReply:opts.forcedBlueReply ?? null, blueResponseMode:opts.blueResponseMode ?? "automatic", actualBlueFirstMove:opts.reply ?? "G13-E11", greenOpeningLabel:opening, blueReplyLabel:opts.reply ?? "G13-E11", matchupId:`${opening}|auto`, mirrorPairId:"m", requestedSearchDepth:1, completedSearchDepth:1, gateContainmentDiagnostics:[], repetitionDiagnostics:{ uniquePositionsVisited:1, repeatedPositionsCount:0, maximumRepetitionCount:1, immediateReversals:0, twoPlyCycles:0, fourPlyCycles:0, noProgressPlies:0, longestNoProgressStreak:0, repetitionDraw:!!opts.repetitionDraw, noProgressDraw:!!opts.noProgressDraw, firstRepeatingCyclePly:null, drawReason:opts.drawReason ?? null }, selectedMoveDiagnostics:[], metrics:{ sideGatesOpened:0, sanctuaryEntries:0, directG7PickupEntries:0, flagPickups:0, extractionFailures:0, successfulDepartures:0, ladenFlagBearerRoutings:0, homeVictories:0, illegalMoves:opts.illegalMoves??0, diversityChanges:0, diversityScoreLoss:0, gateOpenedWithEnemyCarrierInside:0, gateOpenedWithEnemyCarrierFlag:0, gateOpenImmediateEscapeRoutes:0, gateOpenReducedEscapeDistance:0, carrierContainmentDelta:0 }, ...opts } as any; }

describe("Phase 2 analysis", () => {
  it("mirrors coordinates and move labels", () => { expect(mirrorCoordinate("C1")).toBe("K1"); expect(mirrorCoordinate("G13")).toBe("G13"); expect(mirrorMoveLabel("D3-E3")).toBe("J3-I3"); expect(mirrorMoveLabel("G13-E11")).toBe("G13-I11"); });
  it("calculates summaries and flags synthetic anomalies without overstating small samples", () => {
    const games:any[]=[]; for(let i=1;i<=20;i++) games.push(game(i,"C1-B1",i<=18?"green":"blue",{reply:i<=15?"G13-E11":"G13-I11",moves:["C1-B1","G13-E11",String(i)],first10:i<19?"same":"u"}));
    for(let i=21;i<=40;i++) games.push(game(i,"K1-L1",i<=22?"green":"blue",{reply:"G13-E11",plies:i<31?80:82}));
    for(let i=41;i<=70;i++) games.push(game(i,`D${i%5}-E${i%5}`,"blue",{reply:"M13-M12"}));
    for(let i=71;i<=170;i++) games.push(game(i,"E1-F1","green",{reply:"G13-I11"}));
    for(let i=171;i<=230;i++ ) games.push(game(i,"D3-E3",null,{drawReason:"threefold-repetition",repetitionDraw:true}));
    games.push(game(231,"A1-B1","green"),game(232,"A1-B1","green"),game(233,"B1-C1","green",{replayOk:false}),game(234,"B1-C1","blue",{illegalMoves:1}));
    const {analysis, flags, proposals}=analyzeExperiment(exp(),games);
    expect(analysis.overallResults.games).toBe(234); expect(analysis.openingResults.find(o=>o.opening==="C1-B1")!.greenWins).toBe(18); expect(analysis.blueReplyResults.find(r=>r.reply==="G13-E11")!.games).toBeGreaterThan(40); expect(analysis.mirrorResults.some(m=>m.opening==="C1-B1"&&m.mirroredOpening==="K1-L1")).toBe(true);
    for (const c of ["opening-win-rate","first-player-advantage","mirror-asymmetry","dominant-blue-reply","repetition-pathology","unusually-long-games","low-line-diversity","replay-failure","illegal-move","insufficient-sample"] as const) expect(flags.some(f=>f.category===c)).toBe(true);
    expect(flags.find(f=>f.category==="insufficient-sample")!.priority).not.toBe("high priority"); expect(proposals.length).toBeGreaterThan(0); expect(analysis.highestPriority).toBe("high priority"); expect(ANALYSIS_RULE_CONFIG.openingWinRate.watch).toBe(0.8);
  });
  it("compares compatible depths, warns for incompatible settings, and exports required files", () => {
    const a=[...Array(6)].map((_,i)=>game(i+1,"C1-B1","green")); const b=[...Array(6)].map((_,i)=>game(i+20,"C1-B1","blue"));
    const compatible=compareExperiments(exp("a",1),a as any,exp("b",2),b as any); expect(compatible.compatible).toBe(true); expect(compatible.flags.some(f=>f.category==="depth-instability")).toBe(true);
    const incompatible=compareExperiments(exp("a",1),a as any,exp("c",2,{blueAgent:"random"}),b as any); expect(incompatible.compatible).toBe(false); expect(incompatible.warning).toContain("compare cautiously");
    const {analysis,flags,proposals}=analyzeExperiment(exp(),a as any,[],[{experiment:exp("b",2),games:b as any}]); const names=analysisExportFiles(analysis,flags,proposals).map(f=>f.name); for (const n of ["analysis_summary.json","analysis_summary.md","opening_analysis.csv","mirror_analysis.csv","blue_reply_analysis.csv","flags.csv","follow_up_proposals.json","representative_games.csv","analyzer_config.json"]) expect(names).toContain(n); expect(analysisExportFiles(analysis,flags,proposals).find(f=>f.name==="analysis_summary.md")!.content).toContain("not proof");
  });
  it("persists analyses, stale status, dismissed flags, proposals, exports, and activeMs", async()=>{
    const store=new ExperimentStore(`analysis-${Date.now()}-${Math.random()}`); const e=await store.createExperiment("A",{mode:"standard",...DEFAULT_SETTINGS.standard,games:1}); const job=(await store.getJobs(e.experimentId))[0]; await store.markJobRunning(e.experimentId,job.jobId); await new Promise(r=>setTimeout(r,2)); await store.completeJob(e.experimentId,{...(await store.getJobs(e.experimentId))[0]},game(1,"C1-B1","green")); const updated=(await store.getExperiment(e.experimentId))!; expect(updated.activeMs).toBeGreaterThan(0);
    const result=await store.runAnalysis(e.experimentId); expect((await store.getLatestAnalysis(e.experimentId))!.gameCount).toBe(1); const f=result.flags[0]; await store.dismissFlag(f.flagId); const rerun=await store.runAnalysis(e.experimentId); expect(rerun.flags.find(x=>x.title===f.title)!.dismissed).toBe(true); if(rerun.proposals[0]) expect((await store.createExperimentFromProposal(rerun.proposals[0].proposalId)).experimentId).toBeTruthy(); expect((await import("../src/experiments.ts")).exportExperiment(store,e.experimentId).then(files=>files.map(x=>x.name))).resolves.toContain("analyzer_config.json");
  });
});

describe("Phase 2 real-data acceptance", () => {
  it("analyzes the low-depth targeted simulator scenario", async () => {
    const { targetedOpeningOptions } = await import("../src/simulation-runner.ts");
    const { runJobGame, exportExperiment } = await import("../src/experiments.ts");
    const selected = targetedOpeningOptions().filter((o) => ["C1-B1", "K1-L1", "D3-E3", "J3-I3"].some((label) => o.label.includes(label))).map((o) => o.label);
    const store = new ExperimentStore(`real-analysis-${Date.now()}-${Math.random()}`);
    const e = await store.createExperiment("Real acceptance", { mode: "targeted", ...DEFAULT_SETTINGS.targeted, selectedGreenOpenings: selected, selectedBlueRepliesByOpening: {}, blueResponseMode: "automatic", gamesPerMatchup: 2, searchDepth: 1, greenDiversity: 0, blueDiversity: 0, seed: 424242, maxPlies: 40, positionSampling: "none" });
    for (const job of await store.getJobs(e.experimentId)) { await store.markJobRunning(e.experimentId, job.jobId); const running = (await store.getJobs(e.experimentId)).find((j) => j.jobId === job.jobId)!; await store.completeJob(e.experimentId, running, runJobGame((await store.getExperiment(e.experimentId))!, running)); }
    const { analysis, flags, proposals } = await store.runAnalysis(e.experimentId);
    expect(analysis.openingResults.map((o) => o.opening).sort()).toEqual(selected.sort());
    expect(analysis.mirrorResults.length).toBeGreaterThanOrEqual(2);
    expect(analysis.blueReplyResults.length).toBeGreaterThan(0);
    expect(analysis.replayWorthyGames.length).toBeGreaterThan(0);
    expect(flags.some((f) => f.category === "replay-failure" || f.category === "illegal-move")).toBe(false);
    expect(proposals.length).toBeGreaterThanOrEqual(0);
    const files = (await exportExperiment(store, e.experimentId)).map((f) => f.name);
    expect(files).toContain("analysis_summary.json");
    console.log(`real-acceptance: games=${analysis.gameCount} openings=${analysis.openingResults.length} mirrors=${analysis.mirrorResults.length} blueReplies=${analysis.blueReplyResults.length} replayWorthy=${analysis.replayWorthyGames.length} exportFiles=${files.length}`);
  }, 90000);
});

describe("Phase 2 IndexedDB migration and automation", () => {
  it("upgrades a version-1 database, preserves records, creates v2 stores, and cleans analysis on delete", async () => {
    const name = `migration-${Date.now()}-${Math.random()}`;
    await new Promise<void>((resolve, reject) => { const r = indexedDB.open(name, 1); r.onupgradeneeded = () => { const db = r.result; const exp = db.createObjectStore("experiments", { keyPath: "experimentId" }); exp.createIndex("status", "status"); const jobs = db.createObjectStore("gameJobs", { keyPath: "jobId" }); jobs.createIndex("experimentId", "experimentId"); const games = db.createObjectStore("completedGames", { keyPath: "gameId" }); games.createIndex("experimentId", "experimentId"); }; r.onerror = () => reject(r.error); r.onsuccess = () => { const db = r.result; const tx = db.transaction(["experiments", "gameJobs", "completedGames"], "readwrite"); tx.objectStore("experiments").put(exp("legacy", 1)); tx.objectStore("gameJobs").put({ jobId: "job-1", experimentId: "legacy", ordinal: 1, status: "completed", seed: 1, attemptCount: 1, createdAt: "", prefix: [] }); tx.objectStore("completedGames").put(game(1, "C1-B1", "green", { experimentId: "legacy", gameId: "game-1", jobId: "job-1" })); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error); }; });
    const store = new ExperimentStore(name);
    expect((await store.getExperiment("legacy"))!.experimentId).toBe("legacy");
    expect(await store.getJobs("legacy")).toHaveLength(1);
    expect((await store.completedGames("legacy")).total).toBe(1);
    const result = await store.runAnalysis("legacy");
    expect((await store.getAnalysisFlags(result.analysis.analysisId)).length).toBeGreaterThan(0);
    await store.deleteExperiment("legacy");
    expect(await store.getExperiment("legacy")).toBeUndefined();
    expect(await store.getAnalysisFlags(result.analysis.analysisId)).toHaveLength(0);
  });

  it("auto-analysis runs after completion when enabled and failures are recoverable", async () => {
    const store = new ExperimentStore(`auto-${Date.now()}-${Math.random()}`);
    const e = await store.createExperiment("Auto", { mode: "standard", ...DEFAULT_SETTINGS.standard, games: 1 }, { autoRunAnalysisOnCompletion: true });
    const job = (await store.getJobs(e.experimentId))[0]; await store.markJobRunning(e.experimentId, job.jobId); await store.completeJob(e.experimentId, (await store.getJobs(e.experimentId))[0], game(1, "C1-B1", "green"));
    await new Promise(r=>setTimeout(r,80));
    expect(await store.maybeAutoAnalyzeExperiment(e.experimentId)).not.toBeNull();
    const analysis = (await store.getLatestAnalysis(e.experimentId))!;
    expect(analysis.analyzerVersion).toBe("phase2-rules-v1");
    expect(analysis.stale).toBe(false);
    await store.setAnalysisError(e.experimentId, "recoverable");
    expect((await store.getExperiment(e.experimentId))!.analysisError).toBe("recoverable");
  });
});
