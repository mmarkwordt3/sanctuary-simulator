# CLAUDE.md — Sanctuary

Stable project reference for Claude Code sessions working on this repository.
This file describes durable architecture and rules; for what's currently in
progress, unresolved, or was just changed, see `HANDOFF.md` instead.

## What this is

Sanctuary is a two-player, local pass-and-play abstract strategy board game.
Browser app: Vite + TypeScript + vanilla HTML/CSS (no frontend framework).
Rules engine is pure, framework-free TypeScript, fully unit-tested with
Vitest. No backend.

## Commands

```bash
npm install
npm run dev         # Vite dev server (http://localhost:5173)
npm run test        # vitest run (one-shot)
npm run test:watch  # vitest watch mode
npm run typecheck   # tsc --noEmit
npm run build       # tsc --noEmit && vite build
npm run preview     # preview the production build
```

Node.js 18+ required (uses `structuredClone`). `run.bat` is the Windows
launcher (installs deps if needed, then `npm run dev`).

Standard verification loop for any change to `src/game/*`: run `npm run test`,
`npm run typecheck`, and (for anything touching rendering) `npm run build`.

## Architecture

Strict separation between the rules engine and rendering. No gameplay logic
lives in DOM event handlers.

```text
index.html            App shell (loads src/main.ts)
run.bat               Windows launcher
vite.config.ts        Vite + Vitest config (dev server port 5173)
tsconfig.json
src/
  main.ts             UI: rendering, click handling, controls. Asks the
                       engine (legalMoves) for legality; never decides it.
  styles.css          Medieval-fortress theme, responsive CSS Grid board
  ui/
    rules.ts          In-app rules-reference text + per-piece summaries (data only)
    orientation.ts    Turn-based visual board ordering (rendering-only 180° flip)
  game/               Pure, DOM-free rules engine — the source of truth
    types.ts          GameState, Piece, Move, LegalMove, UnladenSanctuary types
    coords.ts         Algebraic <-> {col,row} conversion, direction vectors
    constants.ts      Board geography, STARTING_SETUP, numbered assumptions
    terrain.ts        Square predicates: walls, gates, inner circle, reserved,
                       cannon zones, canBearerEnterInnerCircle
    movement.ts       Per-piece legal-move generation (pure functions)
    rules.ts          Isolated predicates: routing, promotion/demotion, cannon,
                       victory, extraction/gate-departure, opening restriction,
                       unladen-Sanctuary entry/exit
    reducer.ts         applyMove(state, move) — the full turn-resolution pipeline
    setup.ts           createInitialState(), cloneState() (structuredClone)
    session.ts          GameSession — undo stack + serialize/deserialize
    notation.ts         Human-readable history strings
tests/                 Vitest suites, one per concern (see below)
```

**Data flow:** `GameSession` (`src/game/session.ts`) holds a stack of
`GameState` snapshots. `applyMove(state, move)` (`src/game/reducer.ts`) is
pure: it returns a **new** state, or the **same reference** if the move is
illegal (this is how the UI/tests detect rejection — `after === before`).
Undo is just popping the stack. The whole state is plain JSON-serializable
data (no functions, no Maps, no DOM refs), so `structuredClone` and
`JSON.stringify`/`parse` round-trip it exactly — this is what makes undo,
restart, and serialization all "just work" without special-casing.

**Legality is engine-owned everywhere.** `legalMoves`/`legalMovesForPiece` in
`movement.ts` is the single source of truth for what a piece may do; the UI
only calls it for highlighting, and the reducer calls it again to validate
before applying. An illegal move requested through the UI or directly via
`applyMove` always returns the input state unchanged.

## Coordinates

- 13×13 board. Columns `A`–`M` (0-indexed 0–12), rows `1`–`13` (0-indexed
  0–12). A1 = upper-left, M13 = lower-right.
- `Coord = { col, row }` (0-indexed ints). `toCoord("G7")` / `fromCoord(c)` in
  `src/game/coords.ts` convert to/from algebraic notation. Never hand-parse
  algebraic strings elsewhere.
- **Board rotation is rendering-only.** `src/ui/orientation.ts` computes a
  display order (`getBoardDisplayModel(activePlayer)`) that the renderer
  iterates; internal `{col,row}` never changes. On Green's turn row 1 is at
  the bottom (rows render 13→1, columns A→M). On Blue's turn the view is
  rotated 180° (rows 1→13, columns M→A). Piece labels stay upright because
  squares are reordered, not CSS-rotated.

## Board geography (fixed terrain — never changed by any task so far)

- **Inner circle (Sanctuary):** F6 G6 H6 / F7 **G7** H7 / F8 G8 H8. Only Flag
  Bearers may ever enter or occupy these squares. G7 is the flag's home/reset
  square.
- **Permanent ring walls (12 squares, always impassable to every piece):** E5
  E6 F5, H5 I5 I6, E8 E9 F9, H9 I9 I8. The Horse jumps over them but cannot
  land on them.
- **Gates:** North G5, South G9 (no wall — always open), West E7, East I7
  (each carries a wall that starts closed). Only Flag Bearers may occupy any
  gate square.
- **Cannon zones (cross-map):** West Cannon A6/A7/A8 removes the **East**
  wall (I7) when an Engineer ends its move there; East Cannon M6/M7/M8
  removes the **West** wall (E7). First wall opened routes that Engineer
  home; opening the **second** wall removes **both** Engineers from the game
  permanently.
- **Reserved squares (only their own returning piece may end there):** G1
  (Green Flag Bearer home), G3 (Green Engineer home), G11 (Blue Engineer
  home), G13 (Blue Flag Bearer home). These are also the victory squares for
  each side's Flag Bearer.
- **Flank columns (Spear Flank Charge):** A, B, L, M.
- **Promotion boundary rows:** Green promotes to Assassin on rows 9–10 (demotes
  crossing row 9→8); Blue promotes on rows 4–5 (demotes crossing row 5→6).

## Starting setup (current — see `STARTING_SETUP` in `src/game/constants.ts`)

| Piece | Green | Blue |
|---|---|---|
| Spear | C1, K1 | C13, K13 |
| Spy | E1, I1 | E13, I13 |
| Flag Bearer | G1 | G13 |
| Horse | G2 | G12 |
| Guard | D3, J3 | D11, J11 |
| Engineer | G3 | G11 |

Green moves first. Both walls (E7, W; I7, E) begin closed; North/South gates
begin open. Flag starts resting at G7.

**Green's first turn only:** Green may not move its Engineer or Flag Bearer
(any other piece is fine). The restriction lifts permanently after Green's
first completed move, and never applies to Blue. See "Opening restriction"
below.

## Piece movement/capture rules (current, authoritative — verified against `src/game/movement.ts`)

- **Flag Bearer:** Unladen: 1–2 squares orthogonal/diagonal. Laden (carrying
  the flag): exactly 1 square. Cannot jump. Cannot attack ordinary pieces or
  Engineers — may capture **only** the opposing Flag Bearer, and only while
  that opponent is carrying the flag, and never while either Bearer is inside
  the inner circle. Gate/inner-circle access rules are intricate — see
  "Flag Bearer gate & Sanctuary rules" below.
- **Engineer:** 1–2 orthogonal/diagonal. Cannot attack (only moves to empty
  squares). Routed to home square if captured. Ending in a Cannon zone opens
  the corresponding wall (see Cannon zones above).
- **Spy:** 1–2 orthogonal/diagonal, captures by occupying the enemy square
  (ordinary pieces removed; Flag Bearer/Engineer routed instead). Promotes to
  Assassin at end of move on the promotion rows. Cannot enter the inner
  circle or land on a gate.
- **Assassin:** Up to 4 squares orthogonal/diagonal within its own territory
  (Green rows 9–13, Blue rows 1–5). May cross back over its boundary but
  stops on the **first** square beyond it and immediately becomes a Spy
  (may capture that square's occupant on the way down; illegal if that square
  is a friendly piece or otherwise inaccessible terrain). Cannot enter the
  inner circle, end on a gate, or capture a Flag Bearer on a gate.
- **Horse:** Standard knight jump, ignores all intervening
  pieces/walls/gates/inner-circle. Cannot land on a friendly piece,
  permanent wall, gate, inner circle, or a reserved square. Captures by
  landing (ordinary removed; Flag Bearer/Engineer routed).
- **Guard:** Exactly 1 square orthogonally to an **empty** square (cannot
  move diagonally to empty); captures exactly 1 square **diagonally** only
  (cannot capture orthogonally). Cannot enter inner circle or land on a gate.
- **Spear:** Normal move/capture is exactly 1 square horizontal or diagonal
  (never straight forward/backward). On a flank column (A/B/L/M) it may also
  make a **Flank Charge**: a forward orthogonal charge-capture against the
  first enemy up to 4 squares ahead in the same column (path must be clear;
  captures only the first enemy encountered). While on a flank column it may
  not move or capture backward in any direction (horizontal moves remain
  legal).

### Flag Bearer gate & Sanctuary rules (the most intricate part of the engine)

Two different regimes apply depending on whether the Bearer is laden
(carrying the flag) or unladen:

- **Laden (extraction):** may leave the inner circle **only** through an open
  West (E7) or East (I7) gate — North/South are never a laden exit. Moves
  exactly 1 square/turn.
- **Unladen:** may enter the inner circle only when the flag is resting at G7
  **and** no other Flag Bearer already occupies the inner circle
  (`canBearerEnterInnerCircle` in `terrain.ts`). May retreat through **any**
  open gate, including North/South. A gate may only be **crossed straight
  along its axis** (vertical for N/S, horizontal for W/E) to prevent diagonal
  corner-cutting — **except** landing on a gate **from an exterior
  (non-inner) square** is exempt from the axis rule, so an otherwise-legal
  1–2 square diagonal move may end on a gate coming from outside (fixed
  2024 bug: E11→G9 via empty F10 is legal). See `bearerStepLegal` in
  `movement.ts` for the exact logic.

Two Flag Bearers may coexist inside the inner circle without being able to
capture each other there (neither may attack while either is inside) — this
is deliberate per the original spec and is not itself a bug.

## Turn-resolution order (as implemented in `applyMove`, `src/game/reducer.ts`)

1. Reject if game over / wrong player's turn / move not legal (same-reference
   return signals rejection).
2. Resolve capture (ordinary piece removed; Flag Bearer/Engineer routed).
3. Move the piece.
4. Resolve flag pickup (landing on G7 while flag rests there; ends movement,
   sets laden countdown to 3, pickup turn doesn't count).
5. Resolve Spy promotion / Assassin demotion.
6. Resolve Cannon wall removal + possible second-wall Engineer removal.
7. Resolve the unladen-Sanctuary buffer/decision state machine (see below).
8. Resolve laden extraction countdown / forced gate-departure (see below).
9. Check victory.
10. Record `lastMove` (origin/destination, for the UI highlight).
11. Append history lines.
12. Switch player (unless game over).
13. `resolveForcedDeparture` — if the new player to move has a carrier stuck on
    a gate with zero legal departures, auto-route it and immediately pass the
    turn back (so a blocked forced departure never soft-locks the game).

## Laden extraction countdown (player-owned, not piece-owned)

Picking up the flag sets `extractionTurnsRemaining = 3` for the **carrier's
owner**. The pickup turn does not decrement it. Thereafter, at the end of
**every** completed turn by that owner (regardless of which friendly piece
moved), the counter decrements by 1 — unless the carrier reached E7/I7 that
turn, in which case the countdown clears and `forcedGateDeparture` activates
instead. If the countdown hits 0 without reaching a side gate, the flag
resets to G7 and the carrier is routed home. Opponent turns never touch the
countdown.

**Forced gate departure:** once the carrier reaches E7 or I7, on the owner's
very next turn the **only** legal action is moving the carrier off the gate
to one of the fixed outward squares (E7 → D6/D7/D8, I7 → J6/J7/J8) — no other
friendly piece may move that turn, and the carrier can't step back into the
circle. The opposing Flag Bearer may still capture the carrier while it sits
on the gate (gates are outside the inner circle). If no outward square is
legal at the start of the owner's turn, the flag resets and the carrier is
routed automatically (the turn is spent, not skipped).

## Unladen Sanctuary buffer/decision system

When an **unladen** Flag Bearer ends its move on any inner-circle square
other than G7, it activates `state.unladenSanctuary = { player, bearerId,
stage: "bufferPending" }`. This is **not** the old "must move to G7 next
turn" rule — that was replaced. The sequence:

1. **Entry turn** — just activates `bufferPending`; no consequence yet.
2. **Buffer turn** (owner's next turn) — owner may move **any** friendly
   piece. Collecting the flag at G7, or completing a full exit (ending on an
   exterior non-gate square), clears the sequence with no penalty. Anything
   else (including moving the Bearer within the circle, or only as far as a
   gate tile) advances the stage to `decisionPending`.
3. **Decision turn** (owner's following turn) — same freedom. Collecting or
   fully exiting still clears the sequence cleanly. Otherwise the Bearer is
   **automatically routed home** (flag left untouched at G7, since it was
   never picked up) and the sequence clears.

Opponent turns never advance or clear the sequence. The opposing Flag Bearer
cannot enter the inner circle while it's active. Ending on a gate tile is
never a "complete exit." Collecting the flag hands off directly to the laden
extraction countdown (steps above) — the two states are never simultaneously
active.

## Opening restriction

Derived from state, not a dedicated flag: `isBlockedByGreenOpening` in
`rules.ts` returns true only when `current === "green" && history.length ===
0` for a Green Engineer or Flag Bearer. Because it's derived from
turn/history, undo/restart/reload all get it "for free." **Caution for
tests:** synthetic fixtures built via `makeState()` (see `tests/helpers.ts`)
default `history` to a non-empty placeholder specifically so hand-built
mid-game positions are never mistaken for turn 1 — only `createInitialState()`
/ a fresh `GameSession` represents the true opening.

## Routing vs. permanent capture

Flag Bearers and Engineers are never permanently removed — they're **routed**
to their home square (`routePiece` in `reducer.ts`): Green FB→G1, Green
EN→G3, Blue EN→G11, Blue FB→G13. Routing a carrying Bearer also resets the
flag to G7 and clears the extraction countdown / forced-departure /
unladen-Sanctuary state (all three are cleared defensively by `routePiece`,
whichever applies). Spy/Assassin/Spear/Guard/Horse are permanently removed
when captured.

## Testing conventions

- `tests/helpers.ts` — shared fixtures: `piece()`, `makeState()` (builds a
  minimal `GameState` with sensible defaults — walls closed, flag resting at
  G7, non-empty placeholder history), `moveTargets`/`captureTargets`/
  `allTargets` (query `legalMoves`), `move()` (apply and return the new
  state), `at()` (piece lookup by square).
- Tests that need the **real opening position** (to exercise the opening
  restriction, starting setup, or a full game from turn 1) use
  `createInitialState()` or `new GameSession()` directly — never `makeState`.
- One file per concern; see the table in `README.md` "### Tests" for the
  current list (kept in sync loosely — check `tests/*.test.ts` directly for
  the authoritative file list, currently 13 files / 148 tests).
- jsdom-based tests (`board-render.test.ts`) use
  `// @vitest-environment jsdom` at the top of the file and dynamically
  `import("../src/main.ts")` after resetting `document.body`, so they drive
  the actual rendered DOM, not just the pure engine.

## Constraints for future changes

- Keep the rules engine (`src/game/*`) pure and DOM-free. UI code
  (`src/main.ts`, `src/ui/*`) may read state and call engine functions, but
  must never decide legality itself.
- Keep `GameState` fully plain-data/serializable — no functions, class
  instances, or Maps/Sets as fields — so clone/undo/serialize keep working
  for free. If you add a field, also set a default in `createInitialState()`
  (`setup.ts`) **and** in the test `makeState()` default (`tests/helpers.ts`).
- Prefer deriving behavior from existing state (turn parity, history length,
  piece positions) over adding new dedicated state flags, per the pattern
  used for the opening restriction.
- Centralize any new rule predicate in `rules.ts` or `terrain.ts` rather than
  inlining conditionals in `movement.ts`/`reducer.ts`/`main.ts`.
- Do not reintroduce a rule that isn't in this file or hasn't been explicitly
  requested — check `HANDOFF.md` and recent git log before assuming a rule
  exists or has changed.
