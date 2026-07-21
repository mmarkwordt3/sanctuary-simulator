import { buildTargetedJobs, replayStoredGameTimeline, targetedForcedPairingCount, targetedOpeningOptions, suspectedBlueFlagBearerPreset, validateTargetedSettings } from "./simulation-runner.ts";
import { AGENT_CHOICES, DEFAULT_SETTINGS, agentUsesDiversity, agentUsesSearchDepth, type SimulatorUiSettings } from "./config.ts";
import type { AgentName } from "../../simulator/agents.ts";
import { type ExportFile } from "./exporters.ts";
import { triggerDownloadFile, triggerDownloadZip } from "./downloads.ts";
import { ExperimentStore, estimateExperiment, exportExperiment, replayStoredGame, type CompletedGameRecord, type ExperimentSettings, type GameQuery, type GameJobRecord } from "./experiments.ts";
import { compareExperiments, type AnalysisFlag, type ExperimentAnalysis, type FollowUpProposal } from "./analysis.ts";
import type { ExperimentWorkerResponse } from "./experiment-worker.ts";
import type { RunResult } from "./simulation-runner.ts";
import type { WorkerRequest, WorkerResponse } from "./worker.ts";
import { acceptanceTuningSettings, DEFAULT_MIRRORED_OPENING_SUITE } from "../../simulator/tuning.ts";
import { TuningStore, tuningMatchProgressLabel, tuningQueuePreset, plannerReportExportFiles, type BackupPreview, type TuningPlannerReport, type TuningQueueItem, type TuningSnapshot } from "./tuning-store.ts";
import "./styles.css";

const experimentStore = new ExperimentStore();
const tuningStore = new TuningStore();
let activeExperimentRun: { experimentId: string; pauseRequested: boolean; cancelRequested: boolean; running: boolean; worker: Worker | null } | null = null;
let activeQueueRun: { worker: Worker | null; running: boolean; cancelRequested: boolean } | null = null;
let queueInitialized = false;
let currentPlannerReport: TuningPlannerReport | null = null;
let pendingBackupImport: unknown | null = null;
let currentExperimentView: { experimentId: string; page: number; pageSize: number; query: GameQuery; replayTimer: number | null; replayPly: number } | null = null;
const state: { settings: SimulatorUiSettings; worker: Worker | null; result: RunResult | null; startedAt: number; paused: boolean } = {
  settings: structuredClone(DEFAULT_SETTINGS),
  worker: null,
  result: null,
  startedAt: 0,
  paused: false,
};

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <header><h1>Sanctuary Simulator Lab</h1><p>Run local browser simulations without terminal commands or external APIs.</p></header>
  <main class="app-shell"><div class="main-stack">
    <section class="card"><h2>1. Simulation mode</h2><label><input type="radio" name="mode" value="standard" checked> Standard self-play</label><label><input type="radio" name="mode" value="opening"> Opening exploration</label><label><input type="radio" name="mode" value="targeted"> Targeted Opening Test</label></section>
    <section id="standard" class="card"><h2>2. Standard self-play settings</h2><div class="grid" id="standard-fields"></div></section>
    <section id="opening" class="card hidden"><h2>3. Opening-exploration settings</h2><p class="warning">Forcing every Green opening and every Blue reply can create a very large run.</p><div class="grid" id="opening-fields"></div></section><section id="targeted" class="card hidden"><h2>4. Targeted Opening Test</h2><p class="warning">Select Green openings, then choose whether Blue replies automatically or from forced replies.</p><div class="grid" id="targeted-fields"></div><details id="advanced-constraints"><summary><span>Advanced move constraints</span><small id="targeted-summary">No forced moves selected.</small></summary><div class="advanced-actions"><button id="targeted-preset" type="button">Test suspected Blue Flag Bearer replies</button><button id="targeted-all" type="button">Select all</button><button id="targeted-clear" type="button">Clear</button><button id="targeted-mirror" type="button">Select mirror pair</button></div><div id="targeted-moves" class="scroll-list"></div></details><p id="targeted-estimate"></p></section>
    <section class="card live-card"><h2>5. Live progress</h2><progress id="bar" value="0" max="100"></progress><div id="progress-text">No run started.</div></section>
    <section class="card"><h2>6. Results summary</h2><p class="warning">Simulation win rates measure these agents under the selected settings. They are not mathematical proof of game balance or a forced strategy.</p><div id="summary">No results yet.</div><div id="opening-table"></div></section>
    <section class="card"><h2>7. Downloads</h2><div id="downloads">Downloads appear after a completed or cancelled run.</div></section>
    <section class="card"><h2>8. Automated Experiments</h2><p class="warning">Browser-local Phase 1: experiments persist in IndexedDB and can resume after reload, but computation does not continue while the tab is closed, suspended, the device sleeps, or the computer is off.</p><div class="grid"><label>Experiment name<input id="exp-name" value="Automated Self-Play Acceptance"></label><label><input id="exp-auto-analysis" type="checkbox"> Run analysis automatically when experiment completes</label></div><p class="warning">Auto-analysis is off by default so long experiments finish without extra work; enable it to analyze once after completion.</p><p id="exp-estimate"></p><button id="exp-create">Create persisted experiment from current settings</button><div id="experiment-dashboard">Loading experiments…</div><div id="experiment-detail"></div></section>

    <section class="card"><h2>9. Evolutionary Tuning</h2><p class="warning">Browser-local Phase 3: one tuning worker runs one match at a time. Candidates never replace the production profile automatically; promotion requires explicit approval.</p><div class="grid"><label>Tuning run name<input id="tune-name" value="Evolution Acceptance"></label><label>Baseline evaluation profile<select id="tune-baseline"><option value="production-baseline-v1">Production baseline (production-baseline-v1)</option></select></label><label>Candidate count<input id="tune-candidates" type="number" value="8"></label><label>Generations<input id="tune-generations" type="number" value="2"></label><label>Search depth<input id="tune-depth" type="number" value="2"></label><label>Games per matchup<input id="tune-games" type="number" value="1"></label><label>Seed count<input id="tune-seeds" type="number" value="4"></label><label>Seed start<input id="tune-seed-start" type="number" value="1"></label><label>Mutation rate<input id="tune-rate" type="number" step="0.05" value="0.55"></label><label>Mutation magnitude<input id="tune-magnitude" type="number" step="0.05" value="0.25"></label><label>Elite count<input id="tune-elites" type="number" value="2"></label><label>Parent selection<select id="tune-parent"><option>rank</option><option>tournament</option></select></label><label><input id="tune-mirrored" type="checkbox" checked> Mirrored openings required</label><label><input id="tune-baseline-matches" type="checkbox" checked> Candidate-vs-baseline matches</label><label><input id="tune-peer-matches" type="checkbox" checked> Candidate-vs-candidate compact peer matches</label><label><input id="tune-auto-pause" type="checkbox" checked> Auto-pause after each generation</label><label>Maximum plies<input id="tune-max-plies" type="number" value="40"></label><label>No-progress limit<input id="tune-no-progress" type="number" value="24"></label><label>Time limit / move ms<input id="tune-time-limit" type="number" value="0"></label></div><label>Opening suite<textarea id="tune-openings">C1-B1
K1-L1
D3-E3
J3-I3
D3-D4
J3-J4
E1-F1
I1-H1</textarea></label><p id="tune-estimate"></p><button id="tune-create">Create tuning run</button><button id="tune-acceptance">Run real acceptance scenario</button><div id="tune-dashboard"></div><div id="tune-profile-info"></div></section>

    <section class="card"><h2>10. Phase 4 / Tuning Queue</h2><p class="warning">Automated queue runs one tuning match at a time while this browser tab remains open and awake. It survives reloads, recovers running tuning runs, and never auto-promotes candidates; eligible candidates are marked Manual review required.</p><div class="grid"><label>Queue preset<select id="queue-preset"><option>Small validation</option><option>Broad search</option><option>Confirmation</option></select></label><label>Queue run name<input id="queue-name" value="Small validation"></label></div><p class="warning">Choose/edit baseline and tuning settings in the Evolutionary Tuning panel above, or load a preset here before adding it to the queue.</p><div class="advanced-actions"><button id="queue-load-preset" disabled>Load preset into editor</button><button id="queue-add" disabled>Add edited job to queue</button><button id="queue-start" disabled>Start queue</button><button id="queue-pause-match" disabled>Pause after current match</button><button id="queue-pause-run" disabled>Pause after current run</button><button id="queue-resume" disabled>Resume queue</button></div><div id="queue-dashboard">Loading queue…</div></section>
    <section class="card"><h2>11. Phase 5 / Automated Tuning Planner</h2><p class="warning">The planner analyzes completed tuning history and drafts Phase 4 queue jobs only. It never auto-promotes candidates and never starts the queue.</p><div class="advanced-actions"><button id="planner-analyze">Analyze tuning history</button><button id="planner-generate" disabled>Generate proposed queue</button><button id="planner-add" disabled>Add proposed jobs to Phase 4 queue</button><button id="planner-export" disabled>Export planner report</button></div><div id="planner-dashboard">No planner analysis yet.</div></section>
    <section class="card"><h2>12. Phase 6 / Backup and Restore</h2><p class="warning">Export a full local JSON backup before moving computers. Import replace mode overwrites this browser's local IndexedDB data only after preview and explicit confirmation; queues remain paused and nothing is approved, promoted, or auto-started.</p><div class="advanced-actions"><button id="backup-export">Export full local data backup</button><button id="backup-choose">Import local data backup</button><button id="backup-validate" disabled>Validate backup file</button><button id="backup-confirm" disabled>Confirm replace import</button><input id="backup-file" type="file" accept="application/json,.json" class="hidden"></div><div id="backup-preview">No backup selected.</div></section>
    <section class="card"><h2>13. Help</h2><ul><li><b>Deterministic</b> agents always choose the top evaluated move for a seed.</li><li><b>Diverse</b> agents choose among near-best legal moves.</li><li><b>Search</b> agents look ahead by depth; higher depth is slower.</li><li><b>Seeds</b> make runs reproducible.</li><li><b>Maximum plies</b> ends games that run too long.</li></ul></section>
  </div><aside class="run-panel" aria-label="Run controls"><h2>Run Simulation</h2><button id="start">Start</button><button id="pause" disabled>Pause</button><button id="resume" disabled>Resume</button><button id="cancel" disabled>Cancel</button><button id="reset">Reset</button><div class="mini-progress"><progress id="sticky-bar" value="0" max="100"></progress><div id="sticky-progress-text">No run started.</div></div></aside></main>`;

renderForms();
wireEvents();
updateApplicability();
experimentStore.pauseRecovery().then(renderExperiments).catch(console.error);
initializeTuningQueueUi();

async function initializeTuningQueueUi(): Promise<void> {
  setQueueControlsEnabled(false);
  try {
    const qs = await tuningStore.recoverQueueAfterReload();
    try { await refreshBaselineDropdown(); } catch (err) { setDownloadFeedback(`Profile/baseline load failed: ${err instanceof Error ? err.message : String(err)}`, true); }
    await renderTuningRuns().catch((err) => setDownloadFeedback(`Tuning run render failed: ${err instanceof Error ? err.message : String(err)}`, true));
    queueInitialized = true;
    setQueueControlsEnabled(true);
    await renderQueue(`Recovery completed. ${qs.message ?? "Queue loaded."}`);
    if (qs.autoRunEnabled) void startQueueRunner();
  } catch (err) {
    queueInitialized = false;
    setQueueControlsEnabled(false);
    const message = err instanceof Error ? err.message : String(err);
    document.querySelector("#queue-dashboard")!.innerHTML = `<p class="warning">Queue load failed: ${message}</p>`;
    setDownloadFeedback(`Queue load failed: ${message}`, true);
  }
}

function setQueueControlsEnabled(enabled: boolean): void {
  for (const id of ["queue-load-preset", "queue-add", "queue-start", "queue-pause-match", "queue-pause-run", "queue-resume"]) {
    const button = document.querySelector<HTMLButtonElement>(`#${id}`);
    if (button) button.disabled = !enabled;
  }
}

function renderForms(): void {
  document.querySelector("#standard-fields")!.innerHTML = [
    input("Games", "std-games", state.settings.standard.games, "number", "Number of games to run."),
    selectAgent("Green agent", "std-green", state.settings.standard.greenAgent),
    selectAgent("Blue agent", "std-blue", state.settings.standard.blueAgent),
    input("Search depth", "std-depth", state.settings.standard.searchDepth, "number", "Used by search agents."),
    input("Green diversity", "std-green-div", state.settings.standard.greenDiversity, "number", "0 deterministic, 1 low, 2 moderate, 3 high."),
    input("Blue diversity", "std-blue-div", state.settings.standard.blueDiversity, "number", "0 deterministic, 1 low, 2 moderate, 3 high."),
    input("Random seed", "std-seed", state.settings.standard.seed, "number", "Same settings and seed reproduce the same run."),
    input("Maximum plies", "std-max", state.settings.standard.maxPlies, "number", "Draw threshold for long games."),
    select("Position sampling", "std-sampling", state.settings.standard.positionSampling, ["none", "final", "every-ply"]),
  ].join("");
  document.querySelector("#opening-fields")!.innerHTML = [
    input("Games per Green opening", "op-games", state.settings.opening.gamesPerOpening, "number", "Every legal Green first move is forced this many times."),
    checkbox("Force every legal Blue reply", "op-force", state.settings.opening.forceBlueReplies),
    selectAgent("Green agent", "op-green", state.settings.opening.greenAgent),
    selectAgent("Blue agent", "op-blue", state.settings.opening.blueAgent),
    input("Search depth", "op-depth", state.settings.opening.searchDepth, "number", "Used by search agents."),
    input("Green diversity", "op-green-div", state.settings.opening.greenDiversity, "number", "0 deterministic, 1 low, 2 moderate, 3 high."),
    input("Blue diversity", "op-blue-div", state.settings.opening.blueDiversity, "number", "0 deterministic, 1 low, 2 moderate, 3 high."),
    input("Random seed", "op-seed", state.settings.opening.seed, "number", "Starting seed for reproducible exploration."),
    input("Maximum plies", "op-max", state.settings.opening.maxPlies, "number", "Draw threshold for long games."),
    select("Position sampling", "op-sampling", state.settings.opening.positionSampling, ["none", "final", "every-ply"]),
  ].join("");
  document.querySelector("#targeted-fields")!.innerHTML = [
    select("Blue response mode", "tar-blue-mode", state.settings.targeted.blueResponseMode, ["automatic", "forced"]),
    input(state.settings.targeted.blueResponseMode === "automatic" ? "Games per Green opening" : "Games per pairing", "tar-games", state.settings.targeted.gamesPerMatchup, "number", state.settings.targeted.blueResponseMode === "automatic" ? "Each selected Green opening is forced this many times; Blue chooses its own reply." : "Every selected opening/reply pair is forced this many times."),
    selectAgent("Green agent", "tar-green", state.settings.targeted.greenAgent),
    selectAgent("Blue agent", "tar-blue", state.settings.targeted.blueAgent),
    input("Search depth", "tar-depth", state.settings.targeted.searchDepth, "number", "Used by search agents."),
    input("Green diversity", "tar-green-div", state.settings.targeted.greenDiversity, "number", "0 deterministic, 1 low, 2 moderate, 3 high."),
    input("Blue diversity", "tar-blue-div", state.settings.targeted.blueDiversity, "number", "0 deterministic, 1 low, 2 moderate, 3 high."),
    input("Random seed", "tar-seed", state.settings.targeted.seed, "number", "Starting seed."),
    input("Maximum plies", "tar-max", state.settings.targeted.maxPlies, "number", "Draw threshold."),
    input("Time limit per move (ms)", "tar-time", state.settings.targeted.timeLimitMs, "number", "0 means no time limit."),
    select("Position sampling", "tar-sampling", state.settings.targeted.positionSampling, ["none", "final", "every-ply"]),
  ].join("");
  renderTargetedMoves();
}

function wireEvents(): void {
  app.addEventListener("change", (event) => { const changedId = (event.target as HTMLElement).id; readForms(); if (changedId === "tar-blue-mode") renderForms(); updateApplicability(); });
  document.querySelector("#start")!.addEventListener("click", start);
  document.querySelector("#pause")!.addEventListener("click", () => send({ type: "pause" }));
  document.querySelector("#resume")!.addEventListener("click", () => send({ type: "resume" }));
  document.querySelector("#cancel")!.addEventListener("click", () => send({ type: "cancel" }));
  document.querySelector("#reset")!.addEventListener("click", reset);
  document.querySelector("#exp-create")!.addEventListener("click", createAutomatedExperiment);
  document.querySelector("#tune-create")!.addEventListener("click", createTuningRunDraft);
  document.querySelector("#tune-acceptance")!.addEventListener("click", runTuningAcceptance);
  document.querySelector("#tune-dashboard")!.addEventListener("click", tuningAction);
  document.querySelector("#queue-dashboard")!.addEventListener("click", queueAction);
  document.querySelector("#queue-load-preset")!.addEventListener("click", loadQueuePreset);
  document.querySelector("#queue-add")!.addEventListener("click", addQueueJob);
  document.querySelector("#queue-start")!.addEventListener("click", startQueueRunner);
  document.querySelector("#queue-pause-match")!.addEventListener("click", async () => { await tuningStore.pauseQueue("match"); await renderQueue(); });
  document.querySelector("#queue-pause-run")!.addEventListener("click", async () => { await tuningStore.pauseQueue("run"); await renderQueue(); });
  document.querySelector("#queue-resume")!.addEventListener("click", startQueueRunner);
  document.querySelector("#planner-analyze")!.addEventListener("click", analyzePlannerUi);
  document.querySelector("#planner-generate")!.addEventListener("click", generatePlannerUi);
  document.querySelector("#planner-add")!.addEventListener("click", addPlannerJobsUi);
  document.querySelector("#planner-export")!.addEventListener("click", exportPlannerUi);
  document.querySelector("#backup-export")!.addEventListener("click", exportLocalBackupUi);
  document.querySelector("#backup-choose")!.addEventListener("click", () => document.querySelector<HTMLInputElement>("#backup-file")!.click());
  document.querySelector("#backup-validate")!.addEventListener("click", validateSelectedBackupUi);
  document.querySelector("#backup-confirm")!.addEventListener("click", importBackupReplaceUi);
  document.querySelector("#backup-file")!.addEventListener("change", validateSelectedBackupUi);
  document.querySelector("#experiment-dashboard")!.addEventListener("click", experimentAction);
  document.querySelector("#experiment-detail")!.addEventListener("click", experimentDetailAction);
  document.querySelector("#experiment-detail")!.addEventListener("change", experimentDetailChanged);
  document.querySelector("#targeted-preset")!.addEventListener("click", () => { state.settings.targeted = suspectedBlueFlagBearerPreset(); renderForms(); updateApplicability(); });
  document.querySelector("#targeted-all")!.addEventListener("click", () => { const options = targetedOpeningOptions(); state.settings.targeted.selectedGreenOpenings = options.map((o) => o.label); state.settings.targeted.selectedBlueRepliesByOpening = Object.fromEntries(options.map((o) => [o.label, o.replies.map((r) => r.label)])); renderForms(); updateApplicability(); });
  document.querySelector("#targeted-clear")!.addEventListener("click", () => { state.settings.targeted.selectedGreenOpenings = []; state.settings.targeted.selectedBlueRepliesByOpening = {}; renderForms(); updateApplicability(); });
  document.querySelector("#advanced-constraints")!.addEventListener("toggle", renderTargetedMoves);
  document.querySelector("#targeted-mirror")!.addEventListener("click", () => { const jobs = targetedOpeningOptions(); for (const opening of jobs) state.settings.targeted.selectedGreenOpenings = [...new Set([...state.settings.targeted.selectedGreenOpenings, opening.label])]; renderForms(); updateApplicability(); });
}

function readForms(): void {
  state.settings.mode = (document.querySelector<HTMLInputElement>("input[name=mode]:checked")!.value as SimulatorUiSettings["mode"]);
  state.settings.standard = {
    games: num("std-games"), greenAgent: agent("std-green"), blueAgent: agent("std-blue"), searchDepth: num("std-depth"), greenDiversity: div("std-green-div"), blueDiversity: div("std-blue-div"), seed: num("std-seed"), maxPlies: num("std-max"), positionSampling: val("std-sampling") as any,
  };
  state.settings.opening = {
    gamesPerOpening: num("op-games"), forceBlueReplies: checked("op-force"), greenAgent: agent("op-green"), blueAgent: agent("op-blue"), searchDepth: num("op-depth"), greenDiversity: div("op-green-div"), blueDiversity: div("op-blue-div"), seed: num("op-seed"), maxPlies: num("op-max"), positionSampling: val("op-sampling") as any,
  };
  state.settings.targeted = { ...state.settings.targeted, blueResponseMode: val("tar-blue-mode") as any, gamesPerMatchup: num("tar-games"), greenAgent: agent("tar-green"), blueAgent: agent("tar-blue"), searchDepth: num("tar-depth"), greenDiversity: div("tar-green-div"), blueDiversity: div("tar-blue-div"), seed: num("tar-seed"), maxPlies: num("tar-max"), timeLimitMs: num("tar-time"), positionSampling: val("tar-sampling") as any };
}

function updateApplicability(): void {
  document.querySelector("#standard")!.classList.toggle("hidden", state.settings.mode !== "standard");
  document.querySelector("#opening")!.classList.toggle("hidden", state.settings.mode !== "opening");
  document.querySelector("#targeted")!.classList.toggle("hidden", state.settings.mode !== "targeted");
  const openingCount = state.settings.targeted.selectedGreenOpenings.length;
  const forcedPairings = targetedForcedPairingCount(state.settings.targeted);
  const jobCount = buildTargetedJobs(state.settings.targeted).length;
  const totalGames = jobCount * state.settings.targeted.gamesPerMatchup;
  const modeText = state.settings.targeted.blueResponseMode === "automatic" ? "Automatic: Blue agent chooses reply" : "Forced: test selected Blue replies";
  document.querySelector("#targeted-estimate")!.textContent = `Selected Green openings: ${openingCount} • Response mode: ${modeText} • ${state.settings.targeted.blueResponseMode === "forced" ? `Forced reply pairings: ${forcedPairings} • ` : ""}Estimated total games: ${totalGames}`;
  document.querySelector("#targeted-summary")!.textContent = openingCount || forcedPairings ? `${openingCount} openings • ${modeText}${state.settings.targeted.blueResponseMode === "forced" ? ` • ${forcedPairings} forced pairings` : ""}` : "No Green openings selected.";
  document.querySelector("#targeted-moves")?.classList.toggle("muted", state.settings.targeted.blueResponseMode === "automatic");
  updateExperimentEstimate();
  updateTuningEstimate();
  for (const [agentId, divId] of [["std-green", "std-green-div"], ["std-blue", "std-blue-div"], ["op-green", "op-green-div"], ["op-blue", "op-blue-div"], ["tar-green", "tar-green-div"], ["tar-blue", "tar-blue-div"]]) {
    document.querySelector(`#${divId}`)?.closest("label")?.classList.toggle("muted", !agentUsesDiversity(agent(agentId)));
  }
  for (const [greenId, blueId, depthId] of [["std-green", "std-blue", "std-depth"], ["op-green", "op-blue", "op-depth"]]) {
    document.querySelector(`#${depthId}`)?.closest("label")?.classList.toggle("muted", !(agentUsesSearchDepth(agent(greenId)) || agentUsesSearchDepth(agent(blueId))));
  }
}

function start(): void {
  readForms();
  if (state.settings.mode === "targeted") {
    const errors = validateTargetedSettings(state.settings.targeted);
    if (errors.length) { document.querySelector("#summary")!.textContent = errors.join(" "); return; }
  }
  state.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  state.startedAt = performance.now();
  state.result = null;
  setRunning(true);
  state.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    if (event.data.type === "progress") renderProgress(event.data.progress);
    if (event.data.type === "complete" || event.data.type === "cancelled") { state.result = event.data.result; renderResult(event.data.result); setRunning(false); }
    if (event.data.type === "error") { document.querySelector("#summary")!.textContent = event.data.message; setRunning(false); }
  };
  send(state.settings.mode === "standard" ? { type: "start-standard", settings: state.settings.standard } : state.settings.mode === "opening" ? { type: "start-opening", settings: state.settings.opening } : { type: "start-targeted", settings: state.settings.targeted });
}

function send(message: WorkerRequest): void { state.worker?.postMessage(message); }
function reset(): void { state.worker?.terminate(); state.worker = null; state.result = null; location.reload(); }
function setRunning(running: boolean): void { ["start"].forEach((id) => (document.querySelector<HTMLButtonElement>(`#${id}`)!.disabled = running)); ["pause", "cancel"].forEach((id) => (document.querySelector<HTMLButtonElement>(`#${id}`)!.disabled = !running)); document.querySelector<HTMLButtonElement>("#resume")!.disabled = !running; }

function renderProgress(p: { completedGames: number; totalGames: number; greenWins: number; blueWins: number; draws: number; replayFailures: number; currentOpening?: string }): void {
  const pct = p.totalGames ? (p.completedGames / p.totalGames) * 100 : 0;
  const elapsed = (performance.now() - state.startedAt) / 1000;
  const eta = p.completedGames ? elapsed * (p.totalGames - p.completedGames) / p.completedGames : 0;
  document.querySelector<HTMLProgressElement>("#bar")!.value = pct;
  document.querySelector<HTMLProgressElement>("#sticky-bar")!.value = pct;
  document.querySelector("#progress-text")!.textContent = `${p.completedGames}/${p.totalGames} (${pct.toFixed(1)}%) • elapsed ${elapsed.toFixed(1)}s • ETA ${eta.toFixed(1)}s • Green ${p.greenWins}, Blue ${p.blueWins}, Draws ${p.draws}, Replay failures ${p.replayFailures}${p.currentOpening ? ` • Opening ${p.currentOpening}` : ""}`;
  document.querySelector("#sticky-progress-text")!.textContent = `${p.completedGames}/${p.totalGames} • ${pct.toFixed(1)}% • ${p.currentOpening ?? "running"}`;
}

function renderResult(result: RunResult): void {
  const s = result.summary;
  document.querySelector("#summary")!.innerHTML = `<div class="metrics">${Object.entries(s).map(([k, v]) => `<div><b>${k}</b><span>${JSON.stringify(v)}</span></div>`).join("")}</div>`;
  if (result.openingRows.length) document.querySelector("#opening-table")!.innerHTML = `<table><thead><tr>${Object.keys(result.openingRows[0]).map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${result.openingRows.map((row) => `<tr>${Object.values(row).map((v) => `<td>${String(v)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  renderDownloads(result.files);
}

function renderDownloads(files: ExportFile[]): void {
  const zip = { name: "sanctuary-simulator-results.zip", mime: "application/zip", content: "" };
  document.querySelector("#downloads")!.innerHTML = files.map((f, i) => `<button data-file="${i}">${f.name}</button>`).join("") + `<button data-zip="1">ZIP containing all results</button>`;
  document.querySelectorAll<HTMLButtonElement>("[data-file]").forEach((button) => button.addEventListener("click", () => download(files[Number(button.dataset.file)])));
  document.querySelector<HTMLButtonElement>("[data-zip]")!.addEventListener("click", () => { try { setDownloadFeedback(`Downloaded ${triggerDownloadZip(zip.name, files).filename}.`); } catch (err) { setDownloadFeedback(err instanceof Error ? err.message : String(err), true); } });
}

function download(file: ExportFile): void { setDownloadFeedback(`Downloaded ${triggerDownloadFile(file).filename}.`); }
function setDownloadFeedback(message: string, error = false): void { const el = document.querySelector("#downloads"); if (el) el.insertAdjacentHTML("afterbegin", `<p class="${error ? "warning" : "success"}">${message}</p>`); const tuning = document.querySelector("#tune-profile-info"); if (tuning) tuning.textContent = message; }
async function exportLocalBackupUi(): Promise<void> {
  try {
    const backup = await tuningStore.exportLocalBackup();
    const file = { name: `sanctuary-local-backup-${backup.exportedAt.slice(0, 10)}.json`, mime: "application/json", content: JSON.stringify(backup, null, 2) };
    const result = triggerDownloadFile(file);
    renderBackupMessage(`Downloaded ${result.filename}. Keep this file private; it contains full local simulator history.`, false);
  } catch (err) { renderBackupMessage(err instanceof Error ? err.message : String(err), true); }
}
async function readSelectedBackupFile(): Promise<unknown> {
  const file = document.querySelector<HTMLInputElement>("#backup-file")!.files?.[0];
  if (!file) throw new Error("Choose a backup JSON file first.");
  return JSON.parse(await file.text());
}
async function validateSelectedBackupUi(): Promise<void> {
  try {
    pendingBackupImport = await readSelectedBackupFile();
    const preview = tuningStore.previewLocalBackup(pendingBackupImport);
    renderBackupPreview(preview);
    document.querySelector<HTMLButtonElement>("#backup-validate")!.disabled = false;
    document.querySelector<HTMLButtonElement>("#backup-confirm")!.disabled = false;
  } catch (err) {
    pendingBackupImport = null;
    document.querySelector<HTMLButtonElement>("#backup-confirm")!.disabled = true;
    renderBackupMessage(`Backup validation failed: ${err instanceof Error ? err.message : String(err)}`, true);
  }
}
async function importBackupReplaceUi(): Promise<void> {
  try {
    if (!pendingBackupImport) throw new Error("Validate a backup before importing.");
    if (!confirm("Replace this browser's local simulator data with the validated backup? Export your current local backup first if you need it. Queues will remain paused.")) return;
    const preview = await tuningStore.importLocalBackupReplace(pendingBackupImport);
    await refreshBaselineDropdown(); await renderTuningRuns(); await renderQueue("Imported backup. Queue remains paused until you explicitly start it."); await renderExperiments(); currentPlannerReport = null;
    renderBackupPreview(preview, "Import complete. Approved baselines, tuning runs, queue history, planner/experiment history, and exports were restored. Queue is paused.");
  } catch (err) { renderBackupMessage(`Import failed: ${err instanceof Error ? err.message : String(err)}`, true); }
}
function renderBackupPreview(p: BackupPreview, message = "Backup is valid. Review the contents, then confirm replace import if this is the file you want."): void {
  document.querySelector("#backup-preview")!.innerHTML = `<p class="success">${message}</p><p class="warning">Replace import will overwrite local browser data. Export current local backup first if needed.</p><div class="metrics"><div><b>Profiles</b><span>${p.profileCount}</span></div><div><b>Approved profiles</b><span>${p.approvedProfileCount}</span></div><div><b>Tuning runs</b><span>${p.tuningRunCount}</span></div><div><b>Queue items</b><span>${p.queueItemCount}</span></div><div><b>Match records</b><span>${p.matchRecordCount}</span></div><div><b>Planner records</b><span>${p.plannerReportCount}</span></div><div><b>Experiments</b><span>${p.experimentCount}</span></div><div><b>Completed games</b><span>${p.completedGameCount}</span></div><div><b>Backup timestamp</b><span>${p.exportedAt}</span></div><div><b>Schema version</b><span>${p.schemaVersion}</span></div></div>`;
}
function renderBackupMessage(message: string, error = false): void { document.querySelector("#backup-preview")!.innerHTML = `<p class="${error ? "warning" : "success"}">${message}</p>`; }
function input(label: string, id: string, value: number, type: string, title: string): string { return `<label title="${title}">${label}<input id="${id}" type="${type}" value="${value}"></label>`; }
function checkbox(label: string, id: string, value: boolean): string { return `<label>${label}<input id="${id}" type="checkbox" ${value ? "checked" : ""}></label>`; }
function selectAgent(label: string, id: string, value: AgentName): string { return select(label, id, value, AGENT_CHOICES); }
function select(label: string, id: string, value: string, choices: string[]): string { return `<label>${label}<select id="${id}">${choices.map((c) => `<option ${c === value ? "selected" : ""}>${c}</option>`).join("")}</select></label>`; }
function val(id: string): string { return (document.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)!).value; }
function num(id: string): number { return Number(val(id)); }
function div(id: string): 0 | 1 | 2 | 3 { return Math.max(0, Math.min(3, Number(val(id)))) as 0 | 1 | 2 | 3; }
function agent(id: string): AgentName { return val(id) as AgentName; }
function checked(id: string): boolean { return document.querySelector<HTMLInputElement>(`#${id}`)!.checked; }

function renderTargetedMoves() {
  const el = document.querySelector("#targeted-moves"); if (!el) return;
  const options = targetedOpeningOptions();
  if (!document.querySelector<HTMLDetailsElement>("#advanced-constraints")?.open) { el.innerHTML = ""; return; }
  const automatic = state.settings.targeted.blueResponseMode === "automatic";
  const explanation = automatic ? `<p class="warning">Automatic mode: Blue is not forced; the selected Blue agent chooses its own first move. Saved forced-reply selections are ignored until Forced mode is selected again.</p>` : `<p class="warning">Forced mode: choose at least one legal Blue reply for every selected Green opening.</p>`;
  el.innerHTML = explanation + options.map((o) => `<fieldset><legend><label><input type="checkbox" data-green="${o.label}" ${state.settings.targeted.selectedGreenOpenings.includes(o.label) ? "checked" : ""}>${o.label}</label></legend><div class="${automatic ? "muted" : ""}">${o.replies.map((r) => `<label><input type="checkbox" data-opening="${o.label}" data-reply="${r.label}" ${automatic ? "disabled" : ""} ${(state.settings.targeted.selectedBlueRepliesByOpening[o.label] ?? []).includes(r.label) ? "checked" : ""}>${r.label}</label>`).join("")}</div></fieldset>`).join("");
  el.querySelectorAll<HTMLInputElement>("input[data-green]").forEach((box) => box.onchange = () => { const label = box.dataset.green!; state.settings.targeted.selectedGreenOpenings = box.checked ? [...new Set([...state.settings.targeted.selectedGreenOpenings, label])] : state.settings.targeted.selectedGreenOpenings.filter((x) => x !== label); updateApplicability(); });
  el.querySelectorAll<HTMLInputElement>("input[data-reply]").forEach((box) => box.onchange = () => { const opening = box.dataset.opening!, reply = box.dataset.reply!; const current = state.settings.targeted.selectedBlueRepliesByOpening[opening] ?? []; state.settings.targeted.selectedBlueRepliesByOpening[opening] = box.checked ? [...new Set([...current, reply])] : current.filter((x) => x !== reply); updateApplicability(); });
}


function currentExperimentSettings(): ExperimentSettings {
  readForms();
  return state.settings.mode === "standard" ? { mode: "standard", ...state.settings.standard } : state.settings.mode === "opening" ? { mode: "opening", ...state.settings.opening } : { mode: "targeted", ...state.settings.targeted };
}
function updateExperimentEstimate(): void {
  const el = document.querySelector("#exp-estimate"); if (!el) return;
  try { const settings = currentExperimentSettings(); const e = estimateExperiment(settings); el.textContent = `Estimated persisted experiment: ${e.totalJobs} games • selected openings ${e.openingCount} • forced reply pairings ${e.replyPairingCount} • storage grows with completed move lists. Create is disabled for zero jobs.`; }
  catch (err) { el.textContent = err instanceof Error ? err.message : String(err); }
}
async function createAutomatedExperiment(): Promise<void> {
  const settings = currentExperimentSettings();
  if (settings.mode === "targeted") { const errors = validateTargetedSettings(settings); if (errors.length) { alert(errors.join("\n")); return; } }
  const estimate = estimateExperiment(settings); if (!estimate.totalJobs) { alert("Experiment would create zero jobs."); return; }
  await experimentStore.createExperiment((document.querySelector<HTMLInputElement>("#exp-name")?.value || "Automated Experiment").trim(), settings, { autoRunAnalysisOnCompletion: checked("exp-auto-analysis") });
  await renderExperiments();
}
async function renderExperiments(): Promise<void> {
  const exps = await experimentStore.listExperiments(); const info = await experimentStore.storageInfo();
  const dash = document.querySelector("#experiment-dashboard"); if (!dash) return;
  dash.innerHTML = comparisonPanel(exps) + `<p>Storage: ${info.experiments} experiments, ${info.completedGames} completed games, ~${info.estimatedBytes} bytes of completed-game JSON.</p><table><thead><tr><th>Name</th><th>Type</th><th>Status</th><th>Progress</th><th>W/L/D</th><th>Failed</th><th>Updated</th><th>Actions</th></tr></thead><tbody>${exps.map(e=>`<tr><td>${e.name}</td><td>${e.mode}</td><td>${e.status}</td><td>${e.completedJobs}/${e.totalJobs} (${((e.completedJobs/Math.max(1,e.totalJobs))*100).toFixed(1)}%)</td><td>${e.greenWins}/${e.blueWins}/${e.draws}</td><td>${e.failedJobs}</td><td>${new Date(e.updatedAt).toLocaleString()}</td><td><button data-exp="${e.experimentId}" data-action="view">View</button>${e.status!=="running"&&e.status!=="completed"&&e.status!=="cancelled"?`<button data-exp="${e.experimentId}" data-action="resume">Resume</button>`:""}${e.status==="running"?`<button data-exp="${e.experimentId}" data-action="pause-exp">Pause</button>`:""}${e.status!=="completed"&&e.status!=="cancelled"?`<button data-exp="${e.experimentId}" data-action="cancel">Cancel</button>`:""}<button data-exp="${e.experimentId}" data-action="analysis">Run Analysis</button><button data-exp="${e.experimentId}" data-action="export">Export</button>${e.failedJobs?`<button data-exp="${e.experimentId}" data-action="retry">Retry Failed</button>`:""}${e.status!=="running"?`<button data-exp="${e.experimentId}" data-action="delete">Delete</button>`:""}</td></tr>`).join("")}</tbody></table>`;
}
async function experimentAction(event: Event): Promise<void> {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-exp],button[data-compare-action]");
  if (!button) return;
  if (button.dataset.compareAction === "run-comparison") return runComparisonUi();
  const experimentId = button.dataset.exp!;
  const action = button.dataset.action!;
  if (action === "view") return viewExperiment(experimentId);
  if (action === "resume") return resumeExperiment(experimentId);
  if (action === "analysis") { await experimentStore.runAnalysis(experimentId); return viewExperiment(experimentId); }
  if (action === "pause-exp" && activeExperimentRun) activeExperimentRun.pauseRequested = true;
  if (action === "cancel" && confirm("Cancel queued jobs for this experiment? Completed games will be preserved.")) {
    if (activeExperimentRun?.experimentId === experimentId) {
      activeExperimentRun.cancelRequested = true;
      activeExperimentRun.worker?.postMessage({ type: "cancel" });
    }
    await experimentStore.cancelExperiment(experimentId);
  }
  if (action === "export") { try { setDownloadFeedback(`Downloaded ${triggerDownloadZip(`${experimentId}.zip`, await exportExperiment(experimentStore, experimentId)).filename}.`); } catch (err) { setDownloadFeedback(err instanceof Error ? err.message : String(err), true); } return; }
  if (action === "retry") await experimentStore.retryFailedJobs(experimentId);
  if (action === "delete" && confirm("Delete this experiment, jobs, and games?")) await experimentStore.deleteExperiment(experimentId);
  await renderExperiments();
}

async function resumeExperiment(experimentId: string): Promise<void> {
  if (activeExperimentRun?.running) return;
  activeExperimentRun = { experimentId, pauseRequested: false, cancelRequested: false, running: true, worker: null };
  while (activeExperimentRun?.running && !activeExperimentRun.pauseRequested && !activeExperimentRun.cancelRequested) {
    const job = await experimentStore.nextQueuedJob(experimentId);
    if (!job) break;
    await experimentStore.markJobRunning(experimentId, job.jobId);
    const exp = (await experimentStore.getExperiment(experimentId))!;
    await runJobInWorker(exp, job);
    await renderExperiments();
    if (currentExperimentView?.experimentId === experimentId) await viewExperiment(experimentId);
  }
  if (activeExperimentRun?.pauseRequested) await experimentStore.pauseExperiment(experimentId);
  if (activeExperimentRun?.cancelRequested) await experimentStore.cancelExperiment(experimentId);
  const finalExp = await experimentStore.getExperiment(experimentId);
  if (finalExp && finalExp.queuedJobs === 0 && finalExp.runningJobs === 0 && finalExp.completedJobs + finalExp.failedJobs + finalExp.cancelledJobs >= finalExp.totalJobs) {
    document.querySelector("#progress-text")!.textContent = `Experiment ${finalExp.name} completed ${finalExp.completedJobs}/${finalExp.totalJobs}.`;
    if (finalExp.status === "completed" && finalExp.autoRunAnalysisOnCompletion) setTimeout(() => experimentStore.maybeAutoAnalyzeExperiment(experimentId).then(() => viewExperiment(experimentId)).catch(console.error), 0);
  }
  activeExperimentRun?.worker?.terminate();
  activeExperimentRun = null;
  await renderExperiments();
}

function runJobInWorker(exp: NonNullable<Awaited<ReturnType<ExperimentStore["getExperiment"]>>>, job: GameJobRecord): Promise<void> {
  return new Promise((resolve) => {
    const worker = new Worker(new URL("./experiment-worker.ts", import.meta.url), { type: "module" });
    if (activeExperimentRun) activeExperimentRun.worker = worker;
    worker.onmessage = async (event: MessageEvent<ExperimentWorkerResponse>) => {
      const msg = event.data;
      if (msg.type === "job-started") document.querySelector("#progress-text")!.textContent = `Worker started job ${msg.ordinal}.`;
      if (msg.type === "progress") document.querySelector("#sticky-progress-text")!.textContent = msg.message;
      if (msg.type === "job-completed") { await experimentStore.completeJob(exp.experimentId, job, msg.game); worker.terminate(); resolve(); }
      if (msg.type === "job-failed") { await experimentStore.failJob(exp.experimentId, job, msg.message); worker.terminate(); resolve(); }
      if (msg.type === "cancelled") { worker.terminate(); resolve(); }
    };
    worker.onerror = async (error) => { await experimentStore.failJob(exp.experimentId, job, error.message); worker.terminate(); resolve(); };
    worker.postMessage({ type: "run-job", experiment: exp, job });
  });
}

async function viewExperiment(experimentId: string): Promise<void> {
  currentExperimentView ??= { experimentId, page: 0, pageSize: 25, query: { sortBy: "game", sortDir: "asc" }, replayTimer: null, replayPly: 0 };
  if (currentExperimentView.experimentId !== experimentId) currentExperimentView = { experimentId, page: 0, pageSize: 25, query: { sortBy: "game", sortDir: "asc" }, replayTimer: null, replayPly: 0 };
  const exp = await experimentStore.getExperiment(experimentId);
  if (!exp) return;
  const jobs = await experimentStore.getJobs(experimentId);
  const offset = currentExperimentView.page * currentExperimentView.pageSize;
  const { games, total } = await experimentStore.completedGames(experimentId, { ...currentExperimentView.query, offset, limit: currentExperimentView.pageSize });
  const summary = summarizeStoredGames(games);
  const analysis = await experimentStore.getLatestAnalysis(experimentId);
  const flags = analysis ? await experimentStore.getAnalysisFlags(analysis.analysisId) : [];
  const proposals = analysis ? await experimentStore.getFollowUpProposals(analysis.analysisId) : [];
  const analysisControls = ((currentExperimentView as any).analysisControls ??= { openingSort: "greenWinRate", openingFlagged: "any", openingMin: 0, mirrorSort: "winRateDifference", mirrorSampled: "any", mirrorPriority: "any", replySort: "frequencySelected", replyDominant: "any", replyMin: 0, flagCategory: "any", flagPriority: "any", flagDismissed: "active", flagSort: "priority" });
  const visibleAnalysis = analysis ? filteredAnalysis(analysis, flags, analysisControls) : null;
  const proposalEditor = ((currentExperimentView as any).proposalEditor as FollowUpProposal | undefined);
  const analysisHtml = analysis ? `<section class="analysis-view"><h4>Analysis (${analysis.status}${analysis.stale ? ", stale" : ""})</h4><p>Last updated ${new Date(analysis.updatedAt).toLocaleString()} • Analyzer ${analysis.analyzerVersion} • highest priority ${analysis.highestPriority}</p><div class="metrics"><div><b>W/L/D</b><span>${analysis.overallResults.greenWins}/${analysis.overallResults.blueWins}/${analysis.overallResults.draws}</span></div><div><b>Draw breakdown</b><span>rep ${analysis.drawAnalysis.repetitionDraws}, no-progress ${analysis.drawAnalysis.noProgressDraws}, max ${analysis.drawAnalysis.maxPliesDraws}</span></div><div><b>Avg/median plies</b><span>${analysis.lengthAnalysis.averagePlies}/${analysis.lengthAnalysis.medianPlies}</span></div></div><h5>Opening rankings</h5>${analysisControlsHtml(analysisControls)}<table><thead><tr><th>Opening</th><th>Games</th><th>Green%</th><th>Blue%</th><th>Draw%</th><th>Avg plies</th><th>Unique first10</th><th>Most common Blue</th></tr></thead><tbody>${visibleAnalysis!.openings.map(o=>`<tr><td>${o.opening}</td><td>${o.games}</td><td>${(o.greenWinRate*100).toFixed(1)}</td><td>${(o.blueWinRate*100).toFixed(1)}</td><td>${(o.drawRate*100).toFixed(1)}</td><td>${o.averagePlies}</td><td>${o.uniqueFirst10PlySequences}</td><td>${Object.entries(o.actualBlueFirstMoveDistribution).sort((a,b)=>b[1]-a[1])[0]?.[0]??""}</td></tr>`).join("")}</tbody></table><h5>Mirror comparison</h5><table><tbody>${visibleAnalysis!.mirrors.map(m=>`<tr><td>${m.opening}</td><td>${m.mirroredOpening}</td><td>${m.sampleSize}/${m.mirroredSampleSize}</td><td>${(m.winRateDifference*100).toFixed(1)}pt</td><td>${(m.drawRateDifference*100).toFixed(1)}pt</td><td>${m.averagePliesDifference}</td><td>${m.priority}</td></tr>`).join("")}</tbody></table><h5>Blue replies</h5><table><tbody>${visibleAnalysis!.replies.map(r=>`<tr><td>${r.reply}</td><td>${r.games}</td><td>${(r.frequencySelected*100).toFixed(1)}%</td><td>${r.openingsFaced.length}</td><td>${(r.blueWinRate*100).toFixed(1)}% Blue</td><td>${r.averagePlies}</td></tr>`).join("")}</tbody></table><h5>Flags queue</h5>${visibleAnalysis!.flags.map(f=>`<article class="flag ${f.priority}"><b>${f.priority}: ${f.title}</b><p>${f.explanation}</p><small>${f.category} • sample ${f.sampleSize} • confidence ${f.confidenceLevel}</small><pre>${JSON.stringify(f.evidence,null,2)}</pre><p>${f.recommendedAction}</p><button data-detail-action="dismiss-flag" data-flag="${f.flagId}">${f.dismissed?"Dismissed":"Dismiss flag"}</button>${f.proposedFollowUpId?`<button data-detail-action="create-proposal" data-proposal="${f.proposedFollowUpId}">Create Follow-Up Experiment</button>`:""}</article>`).join("")}<h5>Replay-worthy games</h5><ul>${analysis.replayWorthyGames.map(g=>`<li><button data-game="${g.gameId}" data-detail-action="replay">Replay</button> ${g.reason}</li>`).join("")}</ul><h5>Follow-up proposals</h5><ul>${proposals.map(p=>`<li>${p.title}: ${p.rationale} (${p.estimatedTotalGames} games)</li>`).join("")}</ul>${proposalEditor ? proposalFormHtml(proposalEditor) : ""}</section>` : `<p><button data-detail-action="run-analysis">Run Analysis</button> No analysis has been computed yet.</p>`;
  document.querySelector("#experiment-detail")!.innerHTML = `<h3>${exp.name}</h3><p>Status ${exp.status}; current job ${exp.currentJobId ?? "none"}; remaining ${exp.queuedJobs}; failed ${exp.failedJobs}; cancelled ${exp.cancelledJobs}</p><progress value="${exp.completedJobs}" max="${exp.totalJobs}"></progress><pre>${JSON.stringify(exp.settings, null, 2)}</pre><p>Completed games showing ${games.length}/${total}. Average plies ${summary.averagePlies}; median ${summary.medianPlies}; replay failures ${summary.replayFailures}; repetition draws ${summary.repetitionDraws}; no-progress draws ${summary.noProgressDraws}.</p>${gameFiltersHtml(currentExperimentView.query)}<table><thead><tr><th>#</th><th>Seed</th><th>Result</th><th>Opening</th><th>Blue first</th><th>Plies</th><th>Replay</th><th>Actions</th></tr></thead><tbody>${games.map(g => `<tr><td>${g.id}</td><td>${g.seed}</td><td>${g.winner ?? g.drawReason}</td><td>${g.opening ?? ""}</td><td>${g.actualBlueFirstMove ?? ""}</td><td>${g.plies}</td><td>${replayStoredGame(g).ok ? "ok" : "FAILED"}</td><td><button data-game="${g.gameId}" data-detail-action="replay">Replay</button><details><summary>Raw</summary><pre>${g.moves.join("\n")}</pre></details></td></tr>`).join("")}</tbody></table><p><button data-detail-action="prev-page" ${offset <= 0 ? "disabled" : ""}>Previous page</button> Page ${currentExperimentView.page + 1}/${Math.max(1, Math.ceil(total / currentExperimentView.pageSize))} <button data-detail-action="next-page" ${offset + games.length >= total ? "disabled" : ""}>Next page</button></p>${analysisHtml}<div id="replay-board"></div><h4>Failed jobs</h4><ul>${jobs.filter(j => j.status === "failed").map(j => `<li>${j.ordinal}: ${j.failureMessage}</li>`).join("")}</ul>`;
}

function comparisonPanel(exps: Array<{experimentId:string; name:string}>): string {
  return `<section class="comparison-ui"><h3>Cross-experiment comparison</h3><label>Source experiment<select id="compare-source">${exps.map(e=>`<option value="${e.experimentId}">${e.name}</option>`).join("")}</select></label><div>${exps.map(e=>`<label><input type="checkbox" data-compare-target="${e.experimentId}"> ${e.name}</label>`).join("")}</div><button data-compare-action="run-comparison">Compare selected experiments</button><div id="comparison-output"></div></section>`;
}
async function runComparisonUi(): Promise<void> {
  const sourceId = document.querySelector<HTMLSelectElement>("#compare-source")?.value; if(!sourceId) return;
  const targetIds = [...document.querySelectorAll<HTMLInputElement>("[data-compare-target]:checked")].map(x=>x.dataset.compareTarget!).filter(id=>id!==sourceId);
  const source = await experimentStore.getExperiment(sourceId); if(!source) return;
  const sourceGames = (await experimentStore.completedGames(sourceId,{limit:1_000_000})).games; await experimentStore.runAnalysis(sourceId, targetIds);
  const rows=[] as string[];
  for(const id of targetIds){ const target=await experimentStore.getExperiment(id); if(!target) continue; const targetGames=(await experimentStore.completedGames(id,{limit:1_000_000})).games; const comparison=compareExperiments(source,sourceGames,target,targetGames); const fields=compatibilityFields(source.settings as any,target.settings as any); rows.push(`<article><h4>${source.name} vs ${target.name}</h4><p>${comparison.compatible?"Compatible comparison":"Warning: incompatible settings"}${comparison.warning?` — ${comparison.warning}`:""}</p><table><tbody>${fields.map(f=>`<tr><td>${f.field}</td><td>${f.match?"match":"differs"}</td><td>${f.source}</td><td>${f.target}</td></tr>`).join("")}</tbody></table><p>Depth delta: ${comparison.depthDelta ?? 0}; source W/L/D ${source.greenWins}/${source.blueWins}/${source.draws}; target W/L/D ${target.greenWins}/${target.blueWins}/${target.draws}; draw-rate change and average/median plies are summarized in the opening rows below.</p><table><thead><tr><th>Opening</th><th>Result-rate gap</th><th>Winner reversed</th></tr></thead><tbody>${comparison.openingLevelChanges.map(c=>`<tr><td>${c.opening}</td><td>${(c.rateDifference*100).toFixed(1)}pt</td><td>${c.winnerReversed}</td></tr>`).join("")}</tbody></table><p>Flags added or changed: ${comparison.flags.map(f=>f.title).join(", ") || "none detected"}. Flags resolved require both experiments to have saved analyses.</p></article>`); }
  document.querySelector("#comparison-output")!.innerHTML = rows.join("") || "Select at least one target experiment.";
}
function compatibilityFields(a:any,b:any){ const pick=(k:string)=>JSON.stringify(a[k]??null)===JSON.stringify(b[k]??null); return ["mode","selectedGreenOpenings","blueResponseMode","greenAgent","blueAgent","greenDiversity","blueDiversity","searchDepth","maxPlies","noProgressPlyLimit","seed"].map(field=>({field,match:pick(field),source:JSON.stringify(a[field]??null),target:JSON.stringify(b[field]??null)})); }
function prio(p:string){return p==="high priority"?4:p==="suspicious"?3:p==="watch"?2:1;}
function filteredAnalysis(analysis: ExperimentAnalysis, flags: AnalysisFlag[], c:any){ const flagOpenings=new Set(flags.flatMap(f=>f.affectedOpenings)); const openings=[...analysis.openingResults].filter(o=>(c.openingFlagged==="flagged"?flagOpenings.has(o.opening):c.openingFlagged==="unflagged"?!flagOpenings.has(o.opening):true)&&o.games>=Number(c.openingMin||0)).sort((a:any,b:any)=>String(c.openingSort)==="opening"?a.opening.localeCompare(b.opening):(b[c.openingSort]-a[c.openingSort])).slice(0,50); const mirrors=[...analysis.mirrorResults].filter(m=>(c.mirrorSampled==="sampled"?m.adequatelySampled:c.mirrorSampled==="unsampled"?!m.adequatelySampled:true)&&(c.mirrorPriority==="any"||m.priority===c.mirrorPriority)).sort((a:any,b:any)=>String(c.mirrorSort)==="priority"?prio(b.priority)-prio(a.priority):(b[c.mirrorSort]-a[c.mirrorSort])).slice(0,50); const dominantReplies=new Set(flags.filter(f=>f.category==="dominant-blue-reply").flatMap(f=>f.affectedReplies)); const replies=[...analysis.blueReplyResults].filter(r=>(c.replyDominant==="dominant"?dominantReplies.has(r.reply):c.replyDominant==="not-dominant"?!dominantReplies.has(r.reply):true)&&r.games>=Number(c.replyMin||0)).sort((a:any,b:any)=>b[c.replySort]-a[c.replySort]).slice(0,50); const outFlags=[...flags].filter(f=>(c.flagCategory==="any"||f.category===c.flagCategory)&&(c.flagPriority==="any"||f.priority===c.flagPriority)&&(c.flagDismissed==="all"|| (c.flagDismissed==="dismissed"?f.dismissed:!f.dismissed))).sort((a,b)=>c.flagSort==="createdAt"?b.createdAt.localeCompare(a.createdAt):c.flagSort==="sampleSize"?b.sampleSize-a.sampleSize:prio(b.priority)-prio(a.priority)).slice(0,50); return {openings,mirrors,replies,flags:outFlags}; }
function analysisControlsHtml(c:any){ return `<fieldset><legend>Analysis table controls</legend><label>Opening sort<select data-analysis-control="openingSort"><option>opening</option><option>games</option><option>greenWinRate</option><option>blueWinRate</option><option>drawRate</option><option>averagePlies</option><option>uniqueFirst10PlySequences</option></select></label><label>Opening flags<select data-analysis-control="openingFlagged"><option value="any">Any</option><option value="flagged">Flagged</option><option value="unflagged">Unflagged</option></select></label><label>Opening min sample<input type="number" data-analysis-control="openingMin" value="${c.openingMin}"></label><label>Mirror sort<select data-analysis-control="mirrorSort"><option>winRateDifference</option><option>drawRateDifference</option><option>averagePliesDifference</option><option>priority</option></select></label><label>Mirror sampled<select data-analysis-control="mirrorSampled"><option value="any">Any</option><option value="sampled">Adequately sampled</option><option value="unsampled">Under-sampled</option></select></label><label>Mirror priority<select data-analysis-control="mirrorPriority"><option value="any">Any</option><option>watch</option><option>suspicious</option><option>high priority</option></select></label><label>Blue reply sort<select data-analysis-control="replySort"><option>frequencySelected</option><option>blueWinRate</option><option>games</option><option>averagePlies</option></select></label><label>Dominant reply<select data-analysis-control="replyDominant"><option value="any">Any</option><option value="dominant">Dominant only</option><option value="not-dominant">Not dominant</option></select></label><label>Blue reply min sample<input type="number" data-analysis-control="replyMin" value="${c.replyMin}"></label><label>Flag category<input data-analysis-control="flagCategory" value="${c.flagCategory}"></label><label>Flag priority<select data-analysis-control="flagPriority"><option value="any">Any</option><option>watch</option><option>suspicious</option><option>high priority</option></select></label><label>Dismissed<select data-analysis-control="flagDismissed"><option value="active">Active</option><option value="dismissed">Dismissed</option><option value="all">All</option></select></label><label>Flag sort<select data-analysis-control="flagSort"><option>priority</option><option>sampleSize</option><option>createdAt</option></select></label></fieldset>`;}
function proposalFormHtml(p: FollowUpProposal): string { const s:any=p.proposedSettings; return `<form class="proposal-editor"><h5>Edit follow-up proposal</h5><p>${p.rationale}</p><p>Source flag: ${p.sourceFlagId}</p><label>Selected Green openings<textarea id="proposal-openings">${(s.selectedGreenOpenings??[]).join("\n")}</textarea></label><label>Blue response mode<input id="proposal-blue-mode" value="${s.blueResponseMode??"automatic"}"></label><label>Selected forced replies JSON<textarea id="proposal-replies">${JSON.stringify(s.selectedBlueRepliesByOpening??{},null,2)}</textarea></label><label>Games per opening/pairing<input id="proposal-games" type="number" value="${s.gamesPerMatchup??s.gamesPerOpening??s.games??1}"></label><label>Green agent<input id="proposal-green" value="${s.greenAgent}"></label><label>Blue agent<input id="proposal-blue" value="${s.blueAgent}"></label><label>Search depth<input id="proposal-depth" type="number" value="${s.searchDepth}"></label><label>Green diversity<input id="proposal-green-div" type="number" value="${s.greenDiversity}"></label><label>Blue diversity<input id="proposal-blue-div" type="number" value="${s.blueDiversity}"></label><label>Seed start<input id="proposal-seed" type="number" value="${s.seed}"></label><label>Maximum plies<input id="proposal-max" type="number" value="${s.maxPlies}"></label><label>No-progress limit<input id="proposal-np" type="number" value="${s.noProgressPlyLimit??40}"></label><label>Time limit<input id="proposal-time" type="number" value="${s.timeLimitMs??0}"></label><label>Position sampling<input id="proposal-sampling" value="${s.positionSampling}"></label><p>Estimated total games: ${p.estimatedTotalGames}</p><pre>Fields changed from source: ${JSON.stringify(p.changedFields,null,2)}</pre><button type="button" data-detail-action="submit-proposal" data-proposal="${p.proposalId}">Create Experiment</button></form>`; }
function readProposalSettings(): ExperimentSettings { const openings=document.querySelector<HTMLTextAreaElement>("#proposal-openings")?.value.split(/\n+/).filter(Boolean)??[]; let replies={}; try{replies=JSON.parse(document.querySelector<HTMLTextAreaElement>("#proposal-replies")?.value||"{}");}catch{} return {mode:"targeted", gamesPerMatchup:Number(val("proposal-games")), blueResponseMode:val("proposal-blue-mode") as any, greenAgent:agent("proposal-green"), blueAgent:agent("proposal-blue"), searchDepth:num("proposal-depth"), greenDiversity:div("proposal-green-div"), blueDiversity:div("proposal-blue-div"), seed:num("proposal-seed"), maxPlies:num("proposal-max"), noProgressPlyLimit:num("proposal-np"), timeLimitMs:num("proposal-time"), positionSampling:val("proposal-sampling") as any, selectedGreenOpenings:openings, selectedBlueRepliesByOpening:replies} as ExperimentSettings; }

function gameFiltersHtml(q: GameQuery): string {
  return `<fieldset><legend>Completed-game filters</legend><label>Winner<select data-filter="winner"><option value="">Any</option><option ${q.winner === "green" ? "selected" : ""}>green</option><option ${q.winner === "blue" ? "selected" : ""}>blue</option><option ${q.winner === "draw" ? "selected" : ""}>draw</option></select></label><label>Draw reason<input data-filter="drawReason" value="${q.drawReason ?? ""}"></label><label>Green opening<input data-filter="opening" value="${q.opening ?? ""}"></label><label>Actual Blue first move<input data-filter="actualBlueFirstMove" value="${q.actualBlueFirstMove ?? ""}"></label><label>Forced Blue reply<input data-filter="forcedBlueReply" value="${q.forcedBlueReply ?? ""}"></label><label>Min plies<input type="number" data-filter="minPlies" value="${q.minPlies ?? ""}"></label><label>Max plies<input type="number" data-filter="maxPlies" value="${q.maxPlies ?? ""}"></label><label>Replay failure<select data-filter="replayFailure"><option value="">Any</option><option value="true" ${q.replayFailure === true ? "selected" : ""}>Only failures</option><option value="false" ${q.replayFailure === false ? "selected" : ""}>Only passing</option></select></label><label>Sort<select data-filter="sortBy">${["game", "seed", "plies", "result", "opening", "completion"].map(v => `<option value="${v}" ${q.sortBy === v ? "selected" : ""}>${v}</option>`).join("")}</select></label><label>Direction<select data-filter="sortDir"><option value="asc" ${q.sortDir !== "desc" ? "selected" : ""}>asc</option><option value="desc" ${q.sortDir === "desc" ? "selected" : ""}>desc</option></select></label></fieldset>`;
}

async function experimentDetailAction(event: Event): Promise<void> {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-detail-action]");
  if (!button || !currentExperimentView) return;
  const action = button.dataset.detailAction!;
  if (action === "next-page") currentExperimentView.page++;
  if (action === "prev-page") currentExperimentView.page = Math.max(0, currentExperimentView.page - 1);
  if (action === "replay" && button.dataset.game) await renderReplay(button.dataset.game);
  if (action === "run-analysis") { await experimentStore.runAnalysis(currentExperimentView.experimentId); await viewExperiment(currentExperimentView.experimentId); return; }
  if (action === "dismiss-flag" && button.dataset.flag) { await experimentStore.dismissFlag(button.dataset.flag); await viewExperiment(currentExperimentView.experimentId); return; }
  if (action === "create-proposal" && button.dataset.proposal) { const analysis = await experimentStore.getLatestAnalysis(currentExperimentView.experimentId); const proposals = analysis ? await experimentStore.getFollowUpProposals(analysis.analysisId) : []; (currentExperimentView as any).proposalEditor = proposals.find(p=>p.proposalId===button.dataset.proposal); await viewExperiment(currentExperimentView.experimentId); return; }
  if (action === "submit-proposal" && button.dataset.proposal) { await experimentStore.createExperimentFromProposal(button.dataset.proposal, readProposalSettings()); (currentExperimentView as any).proposalEditor = undefined; await renderExperiments(); await viewExperiment(currentExperimentView.experimentId); return; }
  if (action !== "replay") await viewExperiment(currentExperimentView.experimentId);
}

async function experimentDetailChanged(event: Event): Promise<void> {
  const el = event.target as HTMLInputElement | HTMLSelectElement;
  if (!el.dataset.filter || !currentExperimentView) return;
  if (el.dataset.analysisControl && currentExperimentView) { const c=((currentExperimentView as any).analysisControls ??= {}); c[el.dataset.analysisControl]=el.type==="number"?Number(el.value):el.value; currentExperimentView.page=0; await viewExperiment(currentExperimentView.experimentId); return; }
  const key = el.dataset.filter as keyof GameQuery;
  const value = el.value;
  (currentExperimentView.query as any)[key] = value === "" ? undefined : key === "minPlies" || key === "maxPlies" ? Number(value) : key === "replayFailure" ? value === "true" : value;
  currentExperimentView.page = 0;
  await viewExperiment(currentExperimentView.experimentId);
}

async function renderReplay(gameId: string): Promise<void> {
  const game = await experimentStore.getCompletedGame(gameId);
  const host = document.querySelector("#replay-board");
  if (!game || !host || !currentExperimentView) return;
  currentExperimentView.replayPly = 0;
  const timeline = replayStoredGameTimeline(game);
  const draw = () => {
    const ply = currentExperimentView?.replayPly ?? 0;
    const state = timeline.states[Math.min(ply, timeline.states.length - 1)];
    const prev = timeline.previousMoves[Math.min(ply, timeline.previousMoves.length - 1)];
    host.innerHTML = `${!timeline.ok ? `<p class="warning">Replay verification failed at ply ${timeline.failedAt}; raw metadata and moves are retained above.</p>` : ""}<h4>Replay ${game.gameId}</h4><p>Ply ${ply}/${game.moves.length}; current player ${state.current}; flag ${state.flag.carrierId ? `carried by ${state.flag.carrierId}` : state.flag.square ? `${state.flag.square.col},${state.flag.square.row}` : "none"}; walls west=${state.walls.west ? "closed" : "open"}, east=${state.walls.east ? "closed" : "open"}; result ${game.winner ?? game.drawReason ?? "in progress"}</p><div><button data-replay="start">Start</button><button data-replay="prev">Previous</button><button data-replay="play">Play</button><button data-replay="pause">Pause</button><button data-replay="next">Next</button><button data-replay="end">End</button><label>Speed <select data-replay-speed><option value="1000">1x</option><option value="500">2x</option><option value="200">5x</option></select></label></div>${boardHtml(state, prev)}`;
    host.querySelectorAll<HTMLButtonElement>("button[data-replay]").forEach(btn => btn.onclick = () => replayControl(btn.dataset.replay!, game, draw));
  };
  draw();
}

function replayControl(action: string, game: CompletedGameRecord, draw: () => void) {
  if (!currentExperimentView) return;
  if (currentExperimentView.replayTimer) { clearInterval(currentExperimentView.replayTimer); currentExperimentView.replayTimer = null; }
  if (action === "start") currentExperimentView.replayPly = 0;
  if (action === "prev") currentExperimentView.replayPly = Math.max(0, currentExperimentView.replayPly - 1);
  if (action === "next") currentExperimentView.replayPly = Math.min(game.moves.length, currentExperimentView.replayPly + 1);
  if (action === "end") currentExperimentView.replayPly = game.moves.length;
  if (action === "play") {
    const speed = Number(document.querySelector<HTMLSelectElement>("[data-replay-speed]")?.value ?? 500);
    currentExperimentView.replayTimer = window.setInterval(() => {
      if (!currentExperimentView) return;
      currentExperimentView.replayPly = Math.min(game.moves.length, currentExperimentView.replayPly + 1);
      draw();
      if (currentExperimentView.replayPly >= game.moves.length && currentExperimentView.replayTimer) clearInterval(currentExperimentView.replayTimer);
    }, speed);
  }
  draw();
}

function boardHtml(state: any, prev: any): string {
  const pieceAt = new Map(state.pieces.map((p: any) => [`${p.col},${p.row}`, p]));
  let rows = "";
  for (let r = 0; r < 13; r++) {
    rows += "<tr>";
    for (let c = 0; c < 13; c++) {
      const p = pieceAt.get(`${c},${r}`) as any;
      const cls = prev && ((prev.from.col === c && prev.from.row === r) || (prev.to.col === c && prev.to.row === r)) ? " class=\"last-move\"" : "";
      rows += `<td${cls}>${p ? `${p.player[0].toUpperCase()}${p.type[0]}` : state.flag.square?.col === c && state.flag.square?.row === r ? "⚑" : ""}</td>`;
    }
    rows += "</tr>";
  }
  return `<table class="replay-grid"><tbody>${rows}</tbody></table>`;
}

function summarizeStoredGames(games: Array<{ plies: number; finalReplayOk: boolean; repetitionDiagnostics: any }>) {
  const plies = games.map(g => g.plies).sort((a, b) => a - b);
  return { averagePlies: Number((plies.reduce((a, b) => a + b, 0) / Math.max(1, plies.length)).toFixed(2)), medianPlies: plies.length ? plies[Math.floor((plies.length - 1) / 2)] : 0, replayFailures: games.filter(g => !g.finalReplayOk).length, repetitionDraws: games.filter(g => g.repetitionDiagnostics?.repetitionDraw).length, noProgressDraws: games.filter(g => g.repetitionDiagnostics?.noProgressDraw).length };
}

async function refreshBaselineDropdown(selectProfileId?: string): Promise<void> {
  const select = document.querySelector<HTMLSelectElement>("#tune-baseline"); if (!select) return;
  const current = selectProfileId ?? (select.value || "production-baseline-v1");
  let approved = [];
  try { approved = await tuningStore.listApprovedExperimentalProfiles(); }
  catch (err) { setDownloadFeedback(`Profile/baseline load failed: ${err instanceof Error ? err.message : String(err)}`, true); throw err; }
  select.innerHTML = `<option value="production-baseline-v1">Production baseline (production-baseline-v1)</option>` + approved.map((p) => {
    const approvedAt = new Date(p.experimentalApproval.approvedAt).toLocaleString();
    return `<option value="${p.profileId}">${p.name} (${p.profileId}) — from ${p.experimentalApproval.sourceTuningRunId}, approved ${approvedAt}</option>`;
  }).join("");
  select.value = [...select.options].some((o) => o.value === current) ? current : "production-baseline-v1";
}

function currentTuningSettings() {
  const base = acceptanceTuningSettings();
  const seeds = Array.from({length: Math.max(1, num("tune-seeds"))}, (_, i) => num("tune-seed-start") + i);
  const baselineProfileId = val("tune-baseline") || "production-baseline-v1";
  return { ...base, baselineProfileId, name: (document.querySelector<HTMLInputElement>("#tune-name")?.value || "Evolutionary Tuning").trim(), candidateCount: Math.max(1, num("tune-candidates")), generationsRequested: Math.max(1, num("tune-generations")), searchDepth: Math.max(1, num("tune-depth")), gamesPerPairing: Math.max(1, num("tune-games")), openingSuite: (document.querySelector<HTMLTextAreaElement>("#tune-openings")?.value || DEFAULT_MIRRORED_OPENING_SUITE.join("\n")).split(/\s+/).filter(Boolean), mirroredOpeningsRequired: checked("tune-mirrored"), seedSet: seeds, candidateVsBaseline: checked("tune-baseline-matches"), candidateVsCandidate: checked("tune-peer-matches"), maxPlies: num("tune-max-plies"), noProgressPlyLimit: num("tune-no-progress"), timeLimitMs: num("tune-time-limit"), autoPauseAfterGeneration: checked("tune-auto-pause"), mutationSettings: { ...base.mutationSettings, mutationRate: Number(val("tune-rate")), mutationMagnitude: Number(val("tune-magnitude")), eliteCount: Math.max(1, num("tune-elites")), parentSelection: val("tune-parent") as any } };
}
function updateTuningEstimate(): void {
  const el = document.querySelector("#tune-estimate"); if (!el || !document.querySelector("#tune-candidates")) return;
  const s = currentTuningSettings();
  const baseline = s.candidateVsBaseline ? s.candidateCount * s.seedSet.length * s.openingSuite.length * 2 : 0;
  const peer = s.candidateVsCandidate ? s.candidateCount * s.seedSet.length * Math.min(2, s.openingSuite.length) * 2 : 0;
  const perGeneration = baseline + peer;
  el.textContent = `Estimated matches: ${perGeneration * s.generationsRequested} • games: ${perGeneration * s.generationsRequested * s.gamesPerPairing} • mirrored suite: ${s.mirroredOpeningsRequired ? "required" : "optional"} • baseline validation: ${s.candidateVsBaseline ? "enabled" : "disabled"} • storage grows after each match • browser runtime pauses when the tab or browser stops.`;
}
async function createTuningRunDraft(): Promise<void> {
  const s = currentTuningSettings();
  const matches = (s.candidateVsBaseline ? s.candidateCount * s.seedSet.length * s.openingSuite.length * 2 : 0) + (s.candidateVsCandidate ? s.candidateCount * s.seedSet.length * Math.min(2, s.openingSuite.length) * 2 : 0);
  if (!matches) { alert("Tuning run would create zero matches."); return; }
  try { await tuningStore.createTuningRun(s); setDownloadFeedback(`Created tuning run with baseline ${s.baselineProfileId}.`); } catch (err) { setDownloadFeedback(err instanceof Error ? err.message : String(err), true); return; }
  await refreshBaselineDropdown();
  await renderTuningRuns();
}
async function runTuningAcceptance(): Promise<void> {
  const run = await tuningStore.createTuningRun(acceptanceTuningSettings());
  await renderTuningRuns();
  const worker = new Worker(new URL("./tuning-worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = async (event: MessageEvent<any>) => {
    if (event.data.type === "progress" || event.data.type === "idle" || event.data.type === "created") await renderTuningRuns(event.data.snapshot);
    if (event.data.type === "error") document.querySelector("#tune-profile-info")!.textContent = event.data.message;
  };
  worker.postMessage({ type: "run", tuningRunId: run.tuningRunId });
}
async function renderTuningRuns(snapshot?: TuningSnapshot | null): Promise<void> {
  const dash = document.querySelector("#tune-dashboard"); if (!dash) return;
  const runs = await tuningStore.listTuningRuns();
  const selected = snapshot ?? (runs[0] ? await tuningStore.loadTuningRun(runs[0].tuningRunId) : null);
  if (!selected) { dash.innerHTML = "No tuning runs yet."; return; }
  const approvedProfiles = await tuningStore.listApprovedExperimentalProfiles();
  dash.innerHTML = tuningRunSummaryHtml(selected, approvedProfiles);
}

export function tuningRunSummaryHtml(selected: TuningSnapshot, approvedProfiles: Awaited<ReturnType<TuningStore["listApprovedExperimentalProfiles"]>> = []): string {
  const r = selected.run; const best = selected.candidates.find(c => c.candidateId === (r.overallChampionCandidateId ?? r.bestCandidateId)); const finalBest = selected.candidates.find(c => c.candidateId === r.finalGenerationBestCandidateId);
  const approvedBest = best ? approvedProfiles.find((p) => p.experimentalApproval.sourceTuningRunId === r.tuningRunId && p.experimentalApproval.sourceCandidateId === best.candidateId) : null;
  const current = selected.matches.find(m => m.matchId === r.currentMatchId);
  const rows = selected.candidates.filter(c => c.generation === r.currentGeneration).sort((a,b)=>(a.rank??99)-(b.rank??99)||b.score-a.score).slice(0, 12);
  return `<h3>${r.name}</h3><div class="metrics"><div><b>Status</b><span>${r.status}</span></div><div><b>Generation</b><span>${r.currentGeneration + 1} of ${r.generationsRequested}</span></div><div><b>Phase</b><span>${r.currentPhase}</span></div><div><b>Matches</b><span>${tuningMatchProgressLabel(r)}</span></div><div><b>Active time</b><span>${Math.round(r.activeMs/1000)}s</span></div><div><b>Current match</b><span>${current?.matchId ?? "none"}</span></div><div><b>Failed</b><span>${r.failedMatches}</span></div><div><b>Overall champion</b><span>${best?.candidateId ?? "pending"}</span></div><div><b>Champion is baseline</b><span>${r.overallChampionIsSelectedBaseline ? "yes" : "no"}</span></div><div><b>Selected baseline</b><span>${r.selectedBaselineProfileId ?? r.baselineProfileId}</span></div><div><b>Final-generation best</b><span>${finalBest?.candidateId ?? "pending"}</span></div><div><b>Recommendation</b><span>${selected.reports[0]?.recommendation ?? "pending"}</span></div><div><b>Reason</b><span>${String(selected.reports[0]?.summary?.recommendationReason ?? selected.reports[0]?.summary?.reason ?? "pending")}</span></div><div><b>Validation</b><span>${best?.scoreBreakdown?.validationScore ?? "pending"}</span></div><div><b>Holdout</b><span>${best?.scoreBreakdown?.holdoutScore ?? "pending"}</span></div><div><b>Manual review</b><span>${r.promotionCandidateId ? "Manual review required" : "—"}</span></div><div><b>Approved profile</b><span>${approvedBest?.profileId ?? "not approved"}</span></div></div><div class="advanced-actions"><button data-tune="resume" data-id="${r.tuningRunId}">Start / Resume</button><button data-tune="pause" data-id="${r.tuningRunId}">Pause</button><button data-tune="cancel" data-id="${r.tuningRunId}">Cancel</button><button data-tune="retry" data-id="${r.tuningRunId}">Retry Failed</button><button data-tune="export" data-id="${r.tuningRunId}">Export</button><button data-tune="delete" data-id="${r.tuningRunId}">Delete</button>${best ? `${approvedBest ? `<button data-tune="select-baseline" data-profile="${approvedBest.profileId}">Use approved profile as baseline</button><button disabled>Approved as experimental profile</button>` : `<button data-tune="approve" data-id="${r.tuningRunId}" data-candidate="${best.candidateId}">Approve as experimental profile</button>`}<button data-tune="reject" data-id="${r.tuningRunId}" data-candidate="${best.candidateId}">Reject candidate</button><button data-tune="confirm" data-id="${r.tuningRunId}" data-candidate="${best.candidateId}">Create confirmation experiment</button><button data-tune="report" data-id="${r.tuningRunId}">Export promotion report</button>` : ""}</div><table><thead><tr><th>Rank</th><th>Candidate</th><th>Score</th><th>W/L/D</th><th>Baseline</th><th>Peer</th><th>Mirror</th><th>Repetition</th><th>Line diversity</th><th>Validation</th><th>Holdout</th><th>Lineage</th><th>Mutation</th></tr></thead><tbody>${rows.map(c => `<tr><td>${c.rank ?? "-"}</td><td>${c.candidateId}</td><td>${c.score}</td><td>${c.wins}/${c.losses}/${c.draws}</td><td>${c.baselineScore}</td><td>${c.leagueScore}</td><td>${c.mirrorPenalty}</td><td>${c.repetitionPenalty}</td><td>${c.diversityPenalty}</td><td>${c.scoreBreakdown?.validationScore ?? "pending"}</td><td>${c.scoreBreakdown?.holdoutScore ?? "pending"}</td><td>${c.parentCandidateIds.join(", ") || "baseline"}</td><td>${c.mutationSummary.slice(0,2).join("; ")}</td></tr>`).join("")}</tbody></table>`;
}
async function tuningAction(event: Event): Promise<void> {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-tune]"); if (!button) return;
  const id = button.dataset.id!; const action = button.dataset.tune!;
  if (action === "select-baseline") { await refreshBaselineDropdown(button.dataset.profile); setDownloadFeedback(`Selected baseline ${button.dataset.profile} for the next tuning run.`); return; }
  if (action === "resume") { const worker = new Worker(new URL("./tuning-worker.ts", import.meta.url), { type: "module" }); worker.onmessage = async (e: MessageEvent<any>) => { if (e.data.snapshot) await renderTuningRuns(e.data.snapshot); }; worker.postMessage({ type: "run", tuningRunId: id }); }
  if (action === "pause") await tuningStore.pauseTuningRun(id);
  if (action === "cancel") await tuningStore.cancelTuningRun(id);
  if (action === "retry") await tuningStore.retryFailedMatches(id);
  if (action === "delete") await tuningStore.deleteTuningRun(id);
  try {
    if (action === "export") {
      const snap = await tuningStore.loadTuningRun(id);
      if (!snap) throw new Error("Tuning run not found; nothing was exported.");
      if (!snap.matches.length || !snap.candidates.length || !snap.profiles.length) throw new Error("Tuning run is not exportable yet because persisted profiles, candidates, or matches are missing.");
      const files = await tuningStore.exportTuningRun(id);
      const result = triggerDownloadZip(`${id}-tuning-export.zip`, files);
      setDownloadFeedback(`Downloaded ${result.filename} (${result.bytes} bytes).`);
    }
    if (action === "approve") { const profile = await tuningStore.approveCandidate(id, button.dataset.candidate!); setDownloadFeedback(`Approved as experimental profile: ${profile.profileId} — ${profile.name}.`); await refreshBaselineDropdown(profile.profileId); }
    if (action === "reject") await tuningStore.rejectCandidate(id, button.dataset.candidate!);
    if (action === "confirm") alert("Create confirmation experiment is available as an explicit manual next step; production defaults are unchanged.");
    if (action === "report") {
      const snap = await tuningStore.loadTuningRun(id);
      if (!snap?.reports.length) throw new Error("No promotion report exists yet. Complete validation and holdout before exporting the report.");
      const files = (await tuningStore.exportTuningRun(id)).filter(f => f.name === "promotion_report.md" || f.name === "promotion_report.json");
      const result = triggerDownloadZip(`${id}-promotion-report.zip`, files);
      setDownloadFeedback(`Downloaded ${result.filename} (${result.bytes} bytes).`);
    }
  } catch (err) { setDownloadFeedback(err instanceof Error ? err.message : String(err), true); }
  await renderTuningRuns();
}

function applyTuningSettingsToEditor(s: ReturnType<typeof currentTuningSettings>): void {
  (document.querySelector<HTMLInputElement>("#tune-name")!).value = s.name;
  (document.querySelector<HTMLSelectElement>("#tune-baseline")!).value = s.baselineProfileId;
  (document.querySelector<HTMLInputElement>("#tune-candidates")!).value = String(s.candidateCount);
  (document.querySelector<HTMLInputElement>("#tune-generations")!).value = String(s.generationsRequested);
  (document.querySelector<HTMLInputElement>("#tune-depth")!).value = String(s.searchDepth);
  (document.querySelector<HTMLInputElement>("#tune-games")!).value = String(s.gamesPerPairing);
  (document.querySelector<HTMLInputElement>("#tune-seeds")!).value = String(s.seedSet.length);
  (document.querySelector<HTMLInputElement>("#tune-seed-start")!).value = String(s.seedSet[0] ?? 1);
  (document.querySelector<HTMLInputElement>("#tune-rate")!).value = String(s.mutationSettings.mutationRate);
  (document.querySelector<HTMLInputElement>("#tune-magnitude")!).value = String(s.mutationSettings.mutationMagnitude);
  (document.querySelector<HTMLInputElement>("#tune-elites")!).value = String(s.mutationSettings.eliteCount);
  (document.querySelector<HTMLInputElement>("#tune-max-plies")!).value = String(s.maxPlies);
  (document.querySelector<HTMLInputElement>("#tune-no-progress")!).value = String(s.noProgressPlyLimit);
  (document.querySelector<HTMLTextAreaElement>("#tune-openings")!).value = s.openingSuite.join("\n");
  (document.querySelector<HTMLInputElement>("#tune-auto-pause")!).checked = s.autoPauseAfterGeneration;
  (document.querySelector<HTMLInputElement>("#tune-mirrored")!).checked = s.mirroredOpeningsRequired;
  (document.querySelector<HTMLInputElement>("#tune-baseline-matches")!).checked = s.candidateVsBaseline;
  (document.querySelector<HTMLInputElement>("#tune-peer-matches")!).checked = s.candidateVsCandidate;
  updateTuningEstimate();
}
function plannerReportHtml(report: TuningPlannerReport): string {
  return `<div class="metrics"><div><b>Selected baseline profile</b><span>${report.selectedBaselineProfileId}</span></div><div><b>Completed tuning runs analyzed</b><span>${report.totalCompletedRuns}</span></div><div><b>Recent recommendations summary</b><span>${Object.entries(report.recommendationSummary).map(([k,v])=>`${k}: ${v}`).join(", ") || "none"}</span></div><div><b>Best recent candidate</b><span>${report.topCandidateSummary[0]?.candidateId ?? "none"} (${report.topCandidateSummary[0]?.score ?? "n/a"})</span></div><div><b>Baseline keeps winning</b><span>${report.baselineKeepsWinning ? "yes" : "no"}</span></div><div><b>Manual review</b><span>${report.manualReviewRequired ? "required" : "not required"}</span></div><div><b>Detected pattern/category</b><span>${report.detectedPattern}</span></div><div><b>Proposed next action</b><span>${report.proposedNextAction}</span></div></div><h4>Warnings</h4><ul>${report.warnings.map(w=>`<li class="warning">${w}</li>`).join("") || "<li>none</li>"}</ul><h4>Rationale</h4><ul>${report.rationale.map(r=>`<li>${r}</li>`).join("")}</ul><h4>Proposed queue jobs</h4>${report.proposedJobs.length ? `<table><thead><tr><th>Run</th><th>Baseline</th><th>Candidates</th><th>Generations</th><th>Depth</th><th>Games</th><th>Seeds</th><th>Mutation</th><th>Openings</th><th>Rationale</th></tr></thead><tbody>${report.proposedJobs.map(j=>`<tr><td>${j.runName}</td><td>${j.baselineProfileId}</td><td>${j.candidateCount}</td><td>${j.generations}</td><td>${j.searchDepth}</td><td>${j.gamesPerMatchup}</td><td>${j.seedCount} @ ${j.seedStart}</td><td>${j.mutationRate}/${j.mutationMagnitude}; elites ${j.eliteCount}; ${j.parentSelection}</td><td>${j.openingSuite.join(", ")}</td><td>${j.rationale}</td></tr>`).join("")}</tbody></table>` : "<p>No jobs proposed.</p>"}<details><summary>Planner report JSON</summary><pre>${JSON.stringify(report, null, 2)}</pre></details>`;
}
async function analyzePlannerUi(): Promise<void> {
  const baseline = val("tune-baseline") || "production-baseline-v1";
  currentPlannerReport = await tuningStore.analyzeTuningPlanner(baseline);
  document.querySelector("#planner-dashboard")!.innerHTML = plannerReportHtml(currentPlannerReport);
  (document.querySelector<HTMLButtonElement>("#planner-generate")!).disabled = false;
  (document.querySelector<HTMLButtonElement>("#planner-export")!).disabled = false;
  (document.querySelector<HTMLButtonElement>("#planner-add")!).disabled = true;
}
async function generatePlannerUi(): Promise<void> {
  await analyzePlannerUi();
  if (currentPlannerReport?.proposedJobs.length) (document.querySelector<HTMLButtonElement>("#planner-add")!).disabled = false;
}
async function addPlannerJobsUi(): Promise<void> {
  if (!currentPlannerReport) await analyzePlannerUi();
  if (!currentPlannerReport) return;
  try { const added = await tuningStore.addPlannerJobsToQueue(currentPlannerReport); setDownloadFeedback(`Added ${added.length} Phase 5 planner job(s). Queue remains paused.`); await renderQueue(`Added ${added.length} Phase 5 planner job(s). Queue remains paused until Start queue is clicked.`); }
  catch (err) { setDownloadFeedback(`Planner add failed: ${err instanceof Error ? err.message : String(err)}`, true); }
}
async function exportPlannerUi(): Promise<void> {
  if (!currentPlannerReport) await analyzePlannerUi();
  if (!currentPlannerReport) return;
  const files = plannerReportExportFiles(currentPlannerReport);
  triggerDownloadZip(`phase5-planner-report.zip`, files);
}

function queuePresetName(): "Small validation"|"Broad search"|"Confirmation" { return (document.querySelector<HTMLSelectElement>("#queue-preset")?.value ?? "Small validation") as any; }
function loadQueuePreset(): void { try { const name = queuePresetName(); const baseline = val("tune-baseline") || "production-baseline-v1"; const settings = tuningQueuePreset(name, baseline); applyTuningSettingsToEditor(settings); (document.querySelector<HTMLInputElement>("#queue-name")!).value = name; setDownloadFeedback(`Preset loaded into editor: ${name}.`); } catch (err) { setDownloadFeedback(`Preset load failed: ${err instanceof Error ? err.message : String(err)}`, true); } }
async function addQueueJob(): Promise<void> { if (!queueInitialized) { setDownloadFeedback("Job add failed: queue is still loading.", true); return; } try { const settings = currentTuningSettings(); const runName = (document.querySelector<HTMLInputElement>("#queue-name")?.value || settings.name).trim(); const item = await tuningStore.enqueueTuningJob(runName, settings.baselineProfileId, { ...settings, name: runName, autoPauseAfterGeneration: false }); await renderQueue(`Job added: ${runName} (${item.queueItemId}).`); setDownloadFeedback(`Job added: ${runName} (${item.queueItemId}).`); } catch (err) { setDownloadFeedback(`Job add failed: ${err instanceof Error ? err.message : String(err)}`, true); await renderQueue(`Job add failed: ${err instanceof Error ? err.message : String(err)}`); } }
async function startQueueRunner(): Promise<void> { if (activeQueueRun?.running) return; await tuningStore.resumeQueue(); activeQueueRun = { worker: null, running: true, cancelRequested: false }; await renderQueue(); void runQueueLoop(); }
async function runQueueLoop(): Promise<void> {
  while (activeQueueRun?.running) {
    const state = await tuningStore.getQueueState();
    if (!state.autoRunEnabled || state.pauseAfterCurrentRun) break;
    const item = await tuningStore.nextQueuedItem();
    if (!item) break;
    let run;
    try { run = await tuningStore.createRunForQueueItem(item.queueItemId); }
    catch (err) { await tuningStore.failQueueItem(item.queueItemId, err instanceof Error ? err.message : String(err)); continue; }
    await runQueuedWorker(item.queueItemId, run.tuningRunId);
    const updated = await tuningStore.syncQueueItemFromRun(item.queueItemId);
    if (updated?.status === "completed") { await tuningStore.autoExportQueueItem(item.queueItemId); setDownloadFeedback(`Queued run completed and auto-export records are ready: ${updated.runName}.`); }
    if ((await tuningStore.getQueueState()).pauseAfterCurrentRun) break;
  }
  await tuningStore.saveQueueState({ autoRunEnabled: false, activeQueueItemId: null, message: "Queue paused or complete." });
  activeQueueRun?.worker?.terminate(); activeQueueRun = null; await renderQueue(); await renderTuningRuns();
}
function runQueuedWorker(queueItemId: string, tuningRunId: string): Promise<void> { return new Promise((resolve) => { const worker = new Worker(new URL("./tuning-worker.ts", import.meta.url), { type: "module" }); if (activeQueueRun) activeQueueRun.worker = worker; worker.onmessage = async (e: MessageEvent<any>) => { if (e.data.snapshot) await renderTuningRuns(e.data.snapshot); const qs = await tuningStore.getQueueState(); if (qs.pauseAfterCurrentMatch && e.data.type === "progress") { worker.postMessage({ type: "pause", tuningRunId }); await tuningStore.saveQueueState({ autoRunEnabled: false, pauseAfterCurrentMatch: false, message: "Queue paused after current match." }); } if (e.data.type === "idle") { worker.terminate(); resolve(); } if (e.data.type === "error") { await tuningStore.failQueueItem(queueItemId, e.data.message); worker.terminate(); resolve(); } }; worker.onerror = async (err) => { await tuningStore.failQueueItem(queueItemId, err.message); worker.terminate(); resolve(); }; worker.postMessage({ type: "run", tuningRunId }); }); }
async function renderQueue(statusMessage?: string): Promise<void> { const dash = document.querySelector("#queue-dashboard"); if (!dash) return; try { const [items, state, aggregate] = await Promise.all([tuningStore.listQueueItems(), tuningStore.getQueueState(), tuningStore.queueAggregateSummary()]); const counts = { pending: items.filter(i=>i.status==="queued").length, completed: items.filter(i=>i.status==="completed").length, failed: items.filter(i=>i.status==="failed").length, running: items.filter(i=>i.status==="running").length }; const active = items.find(i=>i.status==="running"); let activeProgress = "No active run"; if (active?.tuningRunId) { const snap = await tuningStore.loadTuningRun(active.tuningRunId); if (snap) activeProgress = `${tuningMatchProgressLabel(snap.run)} matches • generation ${snap.run.currentGeneration + 1}/${snap.run.generationsRequested} • current ${snap.run.currentMatchId ?? "none"}`; }
  dash.innerHTML = `<div class="metrics"><div><b>Queue status</b><span>${state.autoRunEnabled ? "auto-running" : "paused"}</span></div><div><b>Active run progress</b><span>${activeProgress}</span></div><div><b>Pending</b><span>${counts.pending}</span></div><div><b>Completed runs</b><span>${counts.completed}</span></div><div><b>Failed runs</b><span>${counts.failed}</span></div><div><b>Aggregate</b><span>${aggregate.completed} complete, ${aggregate.failed} failed; best recommendation ${aggregate.bestRecommendationFound}; eligible manual promotion ${aggregate.anyEligibleManualPromotionCandidate ? "yes" : "no"}; beat baseline ${aggregate.anyRunBeatSelectedBaseline ? "yes" : "no"}; strongest ${aggregate.strongestCandidateId ?? "pending"}</span></div></div><p>${statusMessage ?? state.message ?? (items.length ? "Queue loaded." : "Queue loaded. No queued jobs yet.")}</p><table><thead><tr><th>Run</th><th>Baseline</th><th>Status</th><th>Linked run</th><th>Auto-export</th><th>Recommendation</th><th>Validation</th><th>Holdout</th><th>Failed</th><th>Manual review</th><th>Actions</th></tr></thead><tbody>${items.map(queueRow).join("")}</tbody></table>${items.length ? "" : `<p>No queued tuning jobs yet.</p>`}`; } catch (err) { const message = err instanceof Error ? err.message : String(err); dash.innerHTML = `<p class="warning">Queue load failed: ${message}</p>`; setDownloadFeedback(`Queue load failed: ${message}`, true); } }
export function queueRow(i: TuningQueueItem): string { const s=i.summary; return `<tr><td>${i.runName}</td><td>${i.baselineProfileId}</td><td>${i.status}${i.errorMessage?`: ${i.errorMessage}`:""}</td><td>${i.tuningRunId ? `<button data-queue="view" data-run="${i.tuningRunId}">${i.tuningRunId}</button>` : "not created"}</td><td>${i.autoExportStatus}</td><td>${s?.recommendation ?? "pending"}</td><td>${s?.validationScore ?? "pending"}</td><td>${s?.holdoutScore ?? "pending"}</td><td>${s?.failedMatches ?? 0}</td><td>${s?.manualReviewRequired ? "Manual review required" : "—"}</td><td>${i.status === "queued" ? `<button data-queue="cancel" data-id="${i.queueItemId}">Cancel queued job</button>` : ""}${i.status === "failed" ? `<button data-queue="retry" data-id="${i.queueItemId}">Retry failed job</button>` : ""}${i.status === "running" ? `<button data-queue="cancel-run" data-run="${i.tuningRunId}">Cancel current run</button>` : ""}${i.autoExportStatus === "succeeded" ? `<button data-queue="download" data-id="${i.queueItemId}">Downloads</button>` : ""}</td></tr>`; }
async function queueAction(event: Event): Promise<void> { const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-queue]"); if (!button) return; const action = button.dataset.queue!; if (action === "view" && button.dataset.run) { const snap = await tuningStore.loadTuningRun(button.dataset.run); await renderTuningRuns(snap); } if (action === "cancel" && button.dataset.id) await tuningStore.cancelQueuedJob(button.dataset.id); if (action === "retry" && button.dataset.id) await tuningStore.retryFailedQueueJob(button.dataset.id); if (action === "cancel-run" && button.dataset.run) { activeQueueRun?.worker?.postMessage({ type: "cancel", tuningRunId: button.dataset.run }); await tuningStore.cancelTuningRun(button.dataset.run); } if (action === "download" && button.dataset.id) { const records = await tuningStore.listQueueExportRecords(button.dataset.id); for (const r of records) setDownloadFeedback(`Export-ready: ${r.filename} (${r.files.length} files).`); } await renderQueue(); await renderTuningRuns(); }
