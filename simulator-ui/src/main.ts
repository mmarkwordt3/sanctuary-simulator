import { buildTargetedJobs, targetedForcedPairingCount, targetedOpeningOptions, suspectedBlueFlagBearerPreset, validateTargetedSettings } from "./simulation-runner.ts";
import { AGENT_CHOICES, DEFAULT_SETTINGS, agentUsesDiversity, agentUsesSearchDepth, type SimulatorUiSettings } from "./config.ts";
import type { AgentName } from "../../simulator/agents.ts";
import { makeZip, type ExportFile } from "./exporters.ts";
import type { RunResult } from "./simulation-runner.ts";
import type { WorkerRequest, WorkerResponse } from "./worker.ts";
import "./styles.css";

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
    <section class="card"><h2>8. Help</h2><ul><li><b>Deterministic</b> agents always choose the top evaluated move for a seed.</li><li><b>Diverse</b> agents choose among near-best legal moves.</li><li><b>Search</b> agents look ahead by depth; higher depth is slower.</li><li><b>Seeds</b> make runs reproducible.</li><li><b>Maximum plies</b> ends games that run too long.</li></ul></section>
  </div><aside class="run-panel" aria-label="Run controls"><h2>Run Simulation</h2><button id="start">Start</button><button id="pause" disabled>Pause</button><button id="resume" disabled>Resume</button><button id="cancel" disabled>Cancel</button><button id="reset">Reset</button><div class="mini-progress"><progress id="sticky-bar" value="0" max="100"></progress><div id="sticky-progress-text">No run started.</div></div></aside></main>`;

renderForms();
wireEvents();
updateApplicability();

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
