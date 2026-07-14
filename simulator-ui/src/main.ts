import { buildTargetedJobs, replayStoredGameTimeline, targetedForcedPairingCount, targetedOpeningOptions, suspectedBlueFlagBearerPreset, validateTargetedSettings } from "./simulation-runner.ts";
import { AGENT_CHOICES, DEFAULT_SETTINGS, agentUsesDiversity, agentUsesSearchDepth, type SimulatorUiSettings } from "./config.ts";
import type { AgentName } from "../../simulator/agents.ts";
import { makeZip, type ExportFile } from "./exporters.ts";
import { ExperimentStore, estimateExperiment, exportExperiment, replayStoredGame, type CompletedGameRecord, type ExperimentSettings, type GameQuery, type GameJobRecord } from "./experiments.ts";
import { compareExperiments, type AnalysisFlag, type ExperimentAnalysis, type FollowUpProposal } from "./analysis.ts";
import type { ExperimentWorkerResponse } from "./experiment-worker.ts";
import type { RunResult } from "./simulation-runner.ts";
import type { WorkerRequest, WorkerResponse } from "./worker.ts";
import { acceptanceTuningSettings, DEFAULT_MIRRORED_OPENING_SUITE } from "../../simulator/tuning.ts";
import { TuningStore, type TuningSnapshot } from "./tuning-store.ts";
import "./styles.css";

const experimentStore = new ExperimentStore();
const tuningStore = new TuningStore();
let activeExperimentRun: { experimentId: string; pauseRequested: boolean; cancelRequested: boolean; running: boolean; worker: Worker | null } | null = null;
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

    <section class="card"><h2>9. Evolutionary Tuning</h2><p class="warning">Browser-local Phase 3: one tuning worker runs one match at a time. Candidates never replace the production profile automatically; promotion requires explicit approval.</p><div class="grid"><label>Tuning run name<input id="tune-name" value="Evolution Acceptance"></label><label>Baseline evaluation profile<input id="tune-baseline" value="production-baseline-v1" readonly></label><label>Candidate count<input id="tune-candidates" type="number" value="8"></label><label>Generations<input id="tune-generations" type="number" value="2"></label><label>Search depth<input id="tune-depth" type="number" value="2"></label><label>Games per matchup<input id="tune-games" type="number" value="1"></label><label>Seed count<input id="tune-seeds" type="number" value="4"></label><label>Seed start<input id="tune-seed-start" type="number" value="1"></label><label>Mutation rate<input id="tune-rate" type="number" step="0.05" value="0.55"></label><label>Mutation magnitude<input id="tune-magnitude" type="number" step="0.05" value="0.25"></label><label>Elite count<input id="tune-elites" type="number" value="2"></label><label>Parent selection<select id="tune-parent"><option>rank</option><option>tournament</option></select></label><label><input id="tune-mirrored" type="checkbox" checked> Mirrored openings required</label><label><input id="tune-baseline-matches" type="checkbox" checked> Candidate-vs-baseline matches</label><label><input id="tune-peer-matches" type="checkbox" checked> Candidate-vs-candidate compact peer matches</label><label><input id="tune-auto-pause" type="checkbox" checked> Auto-pause after each generation</label><label>Maximum plies<input id="tune-max-plies" type="number" value="40"></label><label>No-progress limit<input id="tune-no-progress" type="number" value="24"></label><label>Time limit / move ms<input id="tune-time-limit" type="number" value="0"></label></div><label>Opening suite<textarea id="tune-openings">C1-B1
K1-L1
D3-E3
J3-I3
D3-D4
J3-J4
E1-F1
I1-H1</textarea></label><p id="tune-estimate"></p><button id="tune-create">Create tuning run</button><button id="tune-acceptance">Run real acceptance scenario</button><div id="tune-dashboard"></div><div id="tune-profile-info"></div></section>
    <section class="card"><h2>10. Help</h2><ul><li><b>Deterministic</b> agents always choose the top evaluated move for a seed.</li><li><b>Diverse</b> agents choose among near-best legal moves.</li><li><b>Search</b> agents look ahead by depth; higher depth is slower.</li><li><b>Seeds</b> make runs reproducible.</li><li><b>Maximum plies</b> ends games that run too long.</li></ul></section>
  </div><aside class="run-panel" aria-label="Run controls"><h2>Run Simulation</h2><button id="start">Start</button><button id="pause" disabled>Pause</button><button id="resume" disabled>Resume</button><button id="cancel" disabled>Cancel</button><button id="reset">Reset</button><div class="mini-progress"><progress id="sticky-bar" value="0" max="100"></progress><div id="sticky-progress-text">No run started.</div></div></aside></main>`;

renderForms();
wireEvents();
updateApplicability();
experimentStore.pauseRecovery().then(renderExperiments).catch(console.error);
tuningStore.recoverInterruptedTuningRuns().then(() => renderTuningRuns()).catch(console.error);

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
  document.querySelector<HTMLButtonElement>("[data-zip]")!.addEventListener("click", () => downloadBlob(zip.name, makeZip(files)));
}

function download(file: ExportFile): void { downloadBlob(file.name, new Blob([file.content], { type: file.mime })); }
function downloadBlob(name: string, blob: Blob): void { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href); }
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
  if (action === "export") return downloadBlob(`${experimentId}.zip`, makeZip(await exportExperiment(experimentStore, experimentId)));
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

function currentTuningSettings() {
  const base = acceptanceTuningSettings();
  const seeds = Array.from({length: Math.max(1, num("tune-seeds"))}, (_, i) => num("tune-seed-start") + i);
  return { ...base, name: (document.querySelector<HTMLInputElement>("#tune-name")?.value || "Evolutionary Tuning").trim(), candidateCount: Math.max(1, num("tune-candidates")), generationsRequested: Math.max(1, num("tune-generations")), searchDepth: Math.max(1, num("tune-depth")), gamesPerPairing: Math.max(1, num("tune-games")), openingSuite: (document.querySelector<HTMLTextAreaElement>("#tune-openings")?.value || DEFAULT_MIRRORED_OPENING_SUITE.join("\n")).split(/\s+/).filter(Boolean), mirroredOpeningsRequired: checked("tune-mirrored"), seedSet: seeds, candidateVsBaseline: checked("tune-baseline-matches"), candidateVsCandidate: checked("tune-peer-matches"), maxPlies: num("tune-max-plies"), noProgressPlyLimit: num("tune-no-progress"), timeLimitMs: num("tune-time-limit"), autoPauseAfterGeneration: checked("tune-auto-pause"), mutationSettings: { ...base.mutationSettings, mutationRate: Number(val("tune-rate")), mutationMagnitude: Number(val("tune-magnitude")), eliteCount: Math.max(1, num("tune-elites")), parentSelection: val("tune-parent") as any } };
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
  await tuningStore.createTuningRun(s);
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
  const r = selected.run; const best = selected.candidates.find(c => c.candidateId === r.bestCandidateId);
  const current = selected.matches.find(m => m.matchId === r.currentMatchId);
  const rows = selected.candidates.filter(c => c.generation === r.currentGeneration).sort((a,b)=>(a.rank??99)-(b.rank??99)||b.score-a.score).slice(0, 12);
  dash.innerHTML = `<h3>${r.name}</h3><div class="metrics"><div><b>Status</b><span>${r.status}</span></div><div><b>Generation</b><span>${r.currentGeneration + 1} of ${r.generationsRequested}</span></div><div><b>Phase</b><span>${r.currentPhase}</span></div><div><b>Matches</b><span>${r.completedMatches}/${r.totalMatches}</span></div><div><b>Active time</b><span>${Math.round(r.activeMs/1000)}s</span></div><div><b>Current match</b><span>${current?.matchId ?? "none"}</span></div><div><b>Failed</b><span>${r.failedMatches}</span></div><div><b>Best</b><span>${best?.candidateId ?? "pending"}</span></div></div><div class="advanced-actions"><button data-tune="resume" data-id="${r.tuningRunId}">Start / Resume</button><button data-tune="pause" data-id="${r.tuningRunId}">Pause</button><button data-tune="cancel" data-id="${r.tuningRunId}">Cancel</button><button data-tune="retry" data-id="${r.tuningRunId}">Retry Failed</button><button data-tune="export" data-id="${r.tuningRunId}">Export</button><button data-tune="delete" data-id="${r.tuningRunId}">Delete</button>${best ? `<button data-tune="approve" data-id="${r.tuningRunId}" data-candidate="${best.candidateId}">Approve as experimental profile</button><button data-tune="reject" data-id="${r.tuningRunId}" data-candidate="${best.candidateId}">Reject candidate</button><button data-tune="confirm" data-id="${r.tuningRunId}" data-candidate="${best.candidateId}">Create confirmation experiment</button><button data-tune="report" data-id="${r.tuningRunId}">Export promotion report</button>` : ""}</div><table><thead><tr><th>Rank</th><th>Candidate</th><th>Score</th><th>W/L/D</th><th>Baseline</th><th>Peer</th><th>Mirror</th><th>Repetition</th><th>Line diversity</th><th>Validation</th><th>Holdout</th><th>Lineage</th><th>Mutation</th></tr></thead><tbody>${rows.map(c => `<tr><td>${c.rank ?? "-"}</td><td>${c.candidateId}</td><td>${c.score}</td><td>${c.wins}/${c.losses}/${c.draws}</td><td>${c.baselineScore}</td><td>${c.leagueScore}</td><td>${c.mirrorPenalty}</td><td>${c.repetitionPenalty}</td><td>${c.diversityPenalty}</td><td>${c.scoreBreakdown?.validationScore ?? "pending"}</td><td>${c.scoreBreakdown?.holdoutScore ?? "pending"}</td><td>${c.parentCandidateIds.join(", ") || "baseline"}</td><td>${c.mutationSummary.slice(0,2).join("; ")}</td></tr>`).join("")}</tbody></table>`;
}
async function tuningAction(event: Event): Promise<void> {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-tune]"); if (!button) return;
  const id = button.dataset.id!; const action = button.dataset.tune!;
  if (action === "resume") { const worker = new Worker(new URL("./tuning-worker.ts", import.meta.url), { type: "module" }); worker.onmessage = async (e: MessageEvent<any>) => { if (e.data.snapshot) await renderTuningRuns(e.data.snapshot); }; worker.postMessage({ type: "run", tuningRunId: id }); }
  if (action === "pause") await tuningStore.pauseTuningRun(id);
  if (action === "cancel") await tuningStore.cancelTuningRun(id);
  if (action === "retry") await tuningStore.retryFailedMatches(id);
  if (action === "delete") await tuningStore.deleteTuningRun(id);
  if (action === "export") { const files = await tuningStore.exportTuningRun(id); renderDownloads(files); }
  if (action === "approve") await tuningStore.approveCandidate(id, button.dataset.candidate!);
  if (action === "reject") await tuningStore.rejectCandidate(id, button.dataset.candidate!);
  if (action === "confirm") alert("Create confirmation experiment is available as an explicit manual next step; production defaults are unchanged.");
  if (action === "report") { const files = (await tuningStore.exportTuningRun(id)).filter(f => f.name.startsWith("promotion_report")); renderDownloads(files); }
  await renderTuningRuns();
}
