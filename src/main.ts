// UI layer. All game rules live in src/game/*; this file only renders state and
// translates clicks into move requests validated by the rules engine. It never
// decides legality itself — it asks `legalMoves` and calls the reducer via the
// GameSession, so the UI can never produce an illegal move.

import "./styles.css";
import type { Coord, GameState, LegalMove, Piece } from "./game/types.ts";
import { GameSession } from "./game/session.ts";
import { legalMoves } from "./game/movement.ts";
import { fromCoord, key } from "./game/coords.ts";
import {
  EAST_CANNON_KEYS,
  GATE_KEYS,
  INNER_CIRCLE_KEYS,
  PERMANENT_WALL_KEYS,
  PIECE_LABEL,
  PIECE_NAME,
  RESERVED_KEYS,
  WEST_CANNON_KEYS,
} from "./game/constants.ts";
import { gateWall, isBlockedGate } from "./game/terrain.ts";
import { gateSideName } from "./game/rules.ts";
import { playerName } from "./game/notation.ts";
import { RULES_SECTIONS, PIECE_SUMMARY } from "./ui/rules.ts";
import { getBoardDisplayModel } from "./ui/orientation.ts";
import type { Player } from "./game/types.ts";

// ---------------------------------------------------------------------------
// UI state (separate from game state)
// ---------------------------------------------------------------------------

const session = new GameSession();
let selected: string | null = null; // selected piece id
let legal: LegalMove[] = [];
let showCoords = true;
let showHighlights = true;
let rulesOpen = false;
let lastOrientation: Player | null = null; // for the one-shot flip fade

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <header class="app-header">
    <h1>Sanctuary</h1>
    <p class="tagline">A two-player fortress strategy game — local pass-and-play.</p>
  </header>
  <main class="layout">
    <section class="board-area" aria-label="Game board">
      <div id="board" class="board" role="grid"></div>
      <div id="selection-summary" class="selection-summary" aria-live="polite"></div>
    </section>
    <aside class="panels">
      <div class="controls" id="controls">
        <button id="btn-undo" type="button">Undo</button>
        <button id="btn-restart" type="button">Restart</button>
        <button id="btn-new" type="button">New game</button>
        <button id="btn-coords" type="button" aria-pressed="true">Coordinates: On</button>
        <button id="btn-highlights" type="button" aria-pressed="true">Highlights: On</button>
        <button id="btn-rules" type="button" aria-pressed="false">Rules</button>
      </div>
      <section class="status" id="status" aria-label="Game status"></section>
      <section class="legend" aria-label="Piece reference">
        <h2>Pieces</h2>
        <ul id="legend-list"></ul>
      </section>
      <section class="history" aria-label="Move history">
        <h2>History</h2>
        <ol id="history-list"></ol>
      </section>
    </aside>
  </main>
  <div id="rules-panel" class="rules-panel" hidden aria-label="Rules reference"></div>
`;

const boardEl = document.querySelector<HTMLDivElement>("#board")!;
const statusEl = document.querySelector<HTMLElement>("#status")!;
const historyEl = document.querySelector<HTMLOListElement>("#history-list")!;
const legendEl = document.querySelector<HTMLUListElement>("#legend-list")!;
const summaryEl = document.querySelector<HTMLDivElement>("#selection-summary")!;
const rulesPanelEl = document.querySelector<HTMLDivElement>("#rules-panel")!;

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function state(): GameState {
  return session.state;
}

function pieceAtCoord(s: GameState, c: Coord): Piece | undefined {
  return s.pieces.find((p) => p.col === c.col && p.row === c.row);
}

function legalMoveTo(c: Coord): LegalMove | undefined {
  return legal.find((m) => m.to.col === c.col && m.to.row === c.row);
}

function renderBoard(): void {
  const s = state();
  // Visual orientation follows the active player so their home row is at the
  // bottom. This only reorders the rendered squares — every cell still carries
  // its true internal coordinate, so the coordinate system is unchanged.
  const model = getBoardDisplayModel(s.current);

  boardEl.innerHTML = "";
  boardEl.classList.toggle("no-coords", !showCoords);

  // Top-left blank corner + column labels (in display order).
  boardEl.appendChild(cornerCell());
  for (const label of model.columnLabels) {
    boardEl.appendChild(labelCell(label, "col-label"));
  }

  // Rows top → bottom, columns left → right, both per the display model.
  model.rows.forEach((row, i) => {
    boardEl.appendChild(labelCell(model.rowLabels[i], "row-label"));
    for (const col of model.columns) {
      boardEl.appendChild(squareCell(s, { col, row }));
    }
  });

  // Subtle one-shot fade when the orientation actually flips (no rotation, no
  // interaction delay — pointer events are never disabled).
  if (lastOrientation !== null && lastOrientation !== s.current) {
    boardEl.classList.remove("is-flipping");
    void boardEl.offsetWidth; // restart the animation
    boardEl.classList.add("is-flipping");
  }
  lastOrientation = s.current;
}

function cornerCell(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "coord-label corner";
  return el;
}

function labelCell(text: string, cls: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = `coord-label ${cls}`;
  el.textContent = text;
  return el;
}

function squareCell(s: GameState, c: Coord): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "cell";
  el.setAttribute("role", "gridcell");
  const k = key(c);
  const alg = fromCoord(c);
  el.dataset.col = String(c.col);
  el.dataset.row = String(c.row);
  el.setAttribute("aria-label", alg);

  // Terrain classes.
  if (PERMANENT_WALL_KEYS.has(k)) el.classList.add("wall");
  if (INNER_CIRCLE_KEYS.has(k)) el.classList.add("inner");
  if (RESERVED_KEYS.has(k)) el.classList.add("reserved");
  if (WEST_CANNON_KEYS.has(k)) el.classList.add("cannon", "cannon-west");
  if (EAST_CANNON_KEYS.has(k)) el.classList.add("cannon", "cannon-east");
  if (GATE_KEYS.has(k)) {
    el.classList.add("gate");
    const blocked = isBlockedGate(s, c);
    el.classList.add(blocked ? "gate-closed" : "gate-open");
    const w = gateWall(c);
    el.dataset.gate = w ?? "plain";
  }
  // Promotion boundary hints. The line is a top-edge rule, so the board row it
  // sits on depends on orientation to keep it on the same logical boundary. The
  // green line marks the board row 8/9 boundary: in Green's view row 9 is above
  // row 8 (top edge of row 8 = c.row 7); in Blue's rotated view row 8 is above
  // row 9 (top edge of row 9 = c.row 8). This is visual only — Spy promotion
  // rules are unchanged.
  const greenBoundaryRow = s.current === "green" ? 7 : 8;
  if (c.row === greenBoundaryRow) el.classList.add("boundary-green");
  if (c.row === 5) el.classList.add("boundary-blue");

  // Last-move indicator (logical coordinates — stays correct after rotation).
  if (s.lastMove) {
    if (s.lastMove.from.col === c.col && s.lastMove.from.row === c.row) {
      el.classList.add("last-move-from");
    }
    if (s.lastMove.to.col === c.col && s.lastMove.to.row === c.row) {
      el.classList.add("last-move-to");
    }
  }

  // Flag marker on its resting square.
  if (s.flag.square && s.flag.square.col === c.col && s.flag.square.row === c.row) {
    const flag = document.createElement("span");
    flag.className = "flag-marker";
    flag.textContent = "⚑";
    flag.title = "Neutral flag";
    el.appendChild(flag);
  }

  // Terrain glyphs for gates/walls (text as well as color, per brief).
  if (GATE_KEYS.has(k)) {
    const g = document.createElement("span");
    g.className = "terrain-glyph";
    g.textContent = isBlockedGate(s, c) ? "▦" : "⌂";
    el.appendChild(g);
  }

  // Piece.
  const piece = pieceAtCoord(s, c);
  if (piece) {
    el.appendChild(renderPiece(s, piece));
    if (piece.player === s.current && !s.winner) el.classList.add("mine");
  }

  // Selection + highlight state.
  if (selected && piece && piece.id === selected) el.classList.add("selected");
  if (showHighlights) {
    const lm = legalMoveTo(c);
    if (lm) el.classList.add(lm.kind === "capture" ? "legal-capture" : "legal-move");
  }

  el.addEventListener("click", () => onCellClick(c));
  return el;
}

function renderPiece(s: GameState, piece: Piece): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = `piece ${piece.player}`;
  el.dataset.type = piece.type;
  const label = document.createElement("span");
  label.className = "piece-label";
  label.textContent = PIECE_LABEL[piece.type];
  el.appendChild(label);
  el.title = `${playerName(piece.player)} ${PIECE_NAME[piece.type]}`;
  if (s.flag.carrierId === piece.id) {
    el.classList.add("carrier");
    const flag = document.createElement("span");
    flag.className = "carry-flag";
    flag.textContent = "⚑";
    el.appendChild(flag);
    el.title += " (carrying the flag)";
  }
  return el;
}

// ---------------------------------------------------------------------------
// Status, legend, history
// ---------------------------------------------------------------------------

function renderStatus(): void {
  const s = state();
  const rows: string[] = [];
  const turn = s.winner
    ? `${playerName(s.winner)} wins!`
    : `${playerName(s.current)} to move`;
  rows.push(statusRow("Turn", turn, s.winner ? "win" : s.current));

  const sel = selected ? s.pieces.find((p) => p.id === selected) : undefined;
  rows.push(
    statusRow(
      "Selected",
      sel ? `${playerName(sel.player)} ${PIECE_NAME[sel.type]} (${fromCoord(sel)})` : "—",
    ),
  );

  rows.push(statusRow("West Wall (E7)", s.walls.west ? "Closed" : "Open"));
  rows.push(statusRow("East Wall (I7)", s.walls.east ? "Closed" : "Open"));

  let flagText: string;
  if (s.flag.carrierId) {
    const carrier = s.pieces.find((p) => p.id === s.flag.carrierId);
    flagText = carrier
      ? `Carried by ${playerName(carrier.player)} Flag Bearer (${fromCoord(carrier)})`
      : "Carried";
  } else if (s.flag.square) {
    flagText = `Resting at ${fromCoord(s.flag.square)}`;
  } else {
    flagText = "—";
  }
  rows.push(statusRow("Flag", flagText));

  // Extraction: the countdown belongs to the carrier's owner, and once the
  // carrier reaches a side gate it must be moved off it (forced departure).
  const carrier = s.flag.carrierId
    ? s.pieces.find((p) => p.id === s.flag.carrierId)
    : undefined;
  if (s.forcedGateDeparture && carrier) {
    rows.push(
      statusRow(
        "Extraction",
        `${playerName(carrier.player)} must move the Flag Bearer off ${gateSideName(carrier)} Gate`,
        "win",
      ),
    );
  } else if (s.extractionTurnsRemaining !== null && carrier) {
    rows.push(
      statusRow(
        "Extraction",
        `${playerName(carrier.player)} — ${s.extractionTurnsRemaining} turn(s) remaining`,
        carrier.player,
      ),
    );
  } else {
    rows.push(statusRow("Extraction", "—"));
  }

  const sanctuaryMsg = sanctuaryStatus(s);
  if (sanctuaryMsg) rows.push(statusRow("Sanctuary", sanctuaryMsg, "win"));

  rows.push(statusRow("Engineers", engineerStatus(s)));

  const assassins = s.pieces.filter((p) => p.type === "assassin");
  const green = assassins.filter((p) => p.player === "green").length;
  const blue = assassins.filter((p) => p.player === "blue").length;
  rows.push(statusRow("Assassins", `Green ${green} · Blue ${blue}`));

  statusEl.innerHTML = `<h2>Status</h2>${rows.join("")}`;
}

/** Status message for an active unladen Sanctuary sequence, keyed on stage and
 * whose turn it is. Returns null when no sequence is active. */
function sanctuaryStatus(s: GameState): string | null {
  const us = s.unladenSanctuary;
  if (!us) return null;
  const owner = playerName(us.player);
  const ownerTurn = s.current === us.player;
  if (us.stage === "bufferPending") {
    return ownerTurn
      ? "Sanctuary buffer turn: collect the flag, retreat, or make any legal move."
      : `${owner} has a Sanctuary buffer turn remaining.`;
  }
  // decisionPending
  return ownerTurn
    ? "After this move, the Flag Bearer will be routed unless it collects the flag or completely exits the Sanctuary."
    : `${owner} must collect the flag or retreat on its next turn, or the Flag Bearer will be routed.`;
}

function engineerStatus(s: GameState): string {
  if (s.engineersRemoved) return "Removed from play (both walls opened)";
  const parts: string[] = [];
  for (const player of ["green", "blue"] as const) {
    const en = s.pieces.find((p) => p.type === "engineer" && p.player === player);
    parts.push(`${playerName(player)}: ${en ? fromCoord(en) : "—"}`);
  }
  return parts.join(" · ");
}

function statusRow(label: string, value: string, cls = ""): string {
  return `<div class="status-row"><span class="status-label">${label}</span><span class="status-value ${cls}">${escapeHtml(value)}</span></div>`;
}

function renderHistory(): void {
  const s = state();
  historyEl.innerHTML = s.history
    .map((h) => `<li>${escapeHtml(h)}</li>`)
    .join("");
  historyEl.scrollTop = historyEl.scrollHeight;
}

function renderLegend(): void {
  legendEl.innerHTML = (Object.keys(PIECE_LABEL) as Array<keyof typeof PIECE_LABEL>)
    .map(
      (type) =>
        `<li><span class="legend-badge">${PIECE_LABEL[type]}</span> ${PIECE_NAME[type]}</li>`,
    )
    .join("");
}

function renderSelectionSummary(): void {
  const s = state();
  const sel = selected ? s.pieces.find((p) => p.id === selected) : undefined;
  if (!sel) {
    summaryEl.textContent = s.winner
      ? `${playerName(s.winner)} has returned the flag home and won the game.`
      : "Select one of your pieces to see its legal moves.";
    return;
  }
  const moves = legal.filter((m) => m.kind === "move").length;
  const caps = legal.filter((m) => m.kind === "capture").length;
  summaryEl.innerHTML = `<strong>${playerName(sel.player)} ${PIECE_NAME[sel.type]}</strong> — ${escapeHtml(
    PIECE_SUMMARY[sel.type],
  )} <em>${moves} move(s), ${caps} capture(s).</em>`;
}

// ---------------------------------------------------------------------------
// Rules panel
// ---------------------------------------------------------------------------

function renderRulesPanel(): void {
  rulesPanelEl.hidden = !rulesOpen;
  if (!rulesOpen) {
    rulesPanelEl.innerHTML = "";
    return;
  }
  const sections = RULES_SECTIONS.map(
    (sec) =>
      `<section><h3>${escapeHtml(sec.title)}</h3>${sec.body
        .map((p) => `<p>${escapeHtml(p)}</p>`)
        .join("")}</section>`,
  ).join("");
  rulesPanelEl.innerHTML = `
    <div class="rules-inner" role="dialog" aria-modal="false" aria-label="Rules reference">
      <div class="rules-head">
        <h2>Sanctuary — Rules Reference</h2>
        <button id="btn-rules-close" type="button">Close</button>
      </div>
      <div class="rules-body">${sections}</div>
    </div>`;
  rulesPanelEl
    .querySelector<HTMLButtonElement>("#btn-rules-close")!
    .addEventListener("click", () => toggleRules(false));
}

// ---------------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------------

function onCellClick(c: Coord): void {
  const s = state();
  if (s.winner) return;

  // If a piece is selected and this is a legal destination, move.
  if (selected) {
    const lm = legalMoveTo(c);
    if (lm) {
      session.move({ pieceId: selected, to: c });
      selected = null;
      legal = [];
      renderAll();
      return;
    }
  }

  // Otherwise (re)select a friendly piece, or clear.
  const piece = pieceAtCoord(s, c);
  if (piece && piece.player === s.current) {
    selected = piece.id;
    legal = legalMoves(s, c);
  } else {
    selected = null;
    legal = [];
  }
  renderAll();
}

function toggleRules(open?: boolean): void {
  rulesOpen = open ?? !rulesOpen;
  document
    .querySelector<HTMLButtonElement>("#btn-rules")!
    .setAttribute("aria-pressed", String(rulesOpen));
  renderRulesPanel();
}

function resetSelection(): void {
  selected = null;
  legal = [];
}

function renderAll(): void {
  renderBoard();
  renderStatus();
  renderHistory();
  renderSelectionSummary();
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

document.querySelector<HTMLButtonElement>("#btn-undo")!.addEventListener("click", () => {
  if (session.undo()) {
    resetSelection();
    renderAll();
  }
});

document.querySelector<HTMLButtonElement>("#btn-restart")!.addEventListener("click", () => {
  session.restart();
  resetSelection();
  renderAll();
});

document.querySelector<HTMLButtonElement>("#btn-new")!.addEventListener("click", () => {
  session.newGame();
  resetSelection();
  renderAll();
});

const coordsBtn = document.querySelector<HTMLButtonElement>("#btn-coords")!;
coordsBtn.addEventListener("click", () => {
  showCoords = !showCoords;
  coordsBtn.textContent = `Coordinates: ${showCoords ? "On" : "Off"}`;
  coordsBtn.setAttribute("aria-pressed", String(showCoords));
  renderBoard();
});

const highlightsBtn = document.querySelector<HTMLButtonElement>("#btn-highlights")!;
highlightsBtn.addEventListener("click", () => {
  showHighlights = !showHighlights;
  highlightsBtn.textContent = `Highlights: ${showHighlights ? "On" : "Off"}`;
  highlightsBtn.setAttribute("aria-pressed", String(showHighlights));
  renderBoard();
});

document.querySelector<HTMLButtonElement>("#btn-rules")!.addEventListener("click", () => toggleRules());

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Initial paint.
renderLegend();
renderRulesPanel();
renderAll();
