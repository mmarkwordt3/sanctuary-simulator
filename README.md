# Sanctuary

A complete, browser-based implementation of **Sanctuary**, a two-player
perfect-information abstract strategy game. Two humans play locally on the same
device (pass-and-play). The rules engine is pure, framework-free TypeScript with
comprehensive unit tests; the interface is semantic HTML rendered with CSS Grid.

> Retrieve the neutral flag from the central Sanctuary with your Flag Bearer and
> carry it home. **Green** wins by returning the flag to **G1**; **Blue** wins by
> returning it to **G13**. Green moves first.

---

## Quick start

```bash
npm install
npm run dev
```

Then open the printed `http://localhost:5173` URL. On Windows you can instead
double-click **`run.bat`**, which installs dependencies if needed and launches
the dev server.

### Other commands

```bash
npm run test       # run the Vitest suite once
npm run test:watch # run tests in watch mode
npm run typecheck  # TypeScript type checking (tsc --noEmit)
npm run build      # type-check + production build into dist/
npm run preview    # preview the production build
```

Requires **Node.js 18+** (uses `structuredClone`).

---

## How to play (interface)

- **Select** one of your pieces by clicking it. Legal empty moves are shown as a
  translucent dot; legal captures are outlined in red. A short rule summary for
  the selected piece appears beneath the board.
- **Move** by clicking a highlighted destination. Turns alternate automatically.
- **Automatic board rotation:** for pass-and-play the board reorients so the
  player to move always sees their home row at the bottom. On Green's turn row 1
  is at the bottom with columns A→M; on Blue's turn the view is rotated 180° (row
  13 at the bottom, columns M→A). This is a visual transform only — internal
  coordinates never change (G1 is always G1) and piece labels stay upright. The
  coordinate labels always match the current orientation.
- The **status panel** shows the current player, selection, both wall states, the
  flag/carrier and extraction countdown, Engineer status, Assassin counts, and
  the winner.
- **Controls:** Undo, Restart, New game, toggle Coordinates, toggle Highlights,
  and an in-app **Rules** reference. A compact piece legend is always visible.
- The layout is responsive: board beside the panels on desktop, stacked on
  tablet/narrow widths, with no horizontal scrolling of the board.

Every move is validated by the rules engine, so illegal moves cannot be made
through the UI. Undo restores the **complete** previous state (walls, removed
Engineers, promotions/demotions, captured/routed pieces, flag, countdown,
winner, and history).

---

## Rules summary

**Pieces (per side):** 1 Flag Bearer, 1 Engineer, 2 Spies, 2 Spears, 2 Guards,
1 Horse.

**Board:** 13×13 (columns A–M, rows 1–13). A central 3×3 **inner circle**
(Sanctuary) surrounds G7, ringed by 12 permanent **wall** squares that no piece
may enter or cross (the Horse jumps over them but cannot land on them). Four
**gates** border the Sanctuary — North (G5), South (G9), West (E7), East (I7).
Only Flag Bearers may enter gates or the inner circle.

**Gates & walls:** North/South begin open; West/East begin blocked by walls. A
Flag Bearer may enter through any open gate. An **unladen** Bearer may also
_retreat_ through any open gate (North/South included). A **laden** carrier is
stricter: it may only extract through an open West/East gate (North/South are not
laden exits). A closed gate is impassable even to a Flag Bearer. Once a wall is
removed it never returns.

**Cannon zones (cross-map):** West Cannon = A6–A8, East Cannon = M6–M8. An
Engineer **ending** its move in the **West** Cannon removes the **East** Wall
(I7); ending in the **East** Cannon removes the **West** Wall (E7). Opening the
first wall routes that Engineer to its start; opening the second wall removes
**both** Engineers from the game immediately.

**Routing vs. capture:** Spies, Assassins, Spears, Guards and Horses are removed
permanently when captured. Flag Bearers and Engineers are **routed** to their
home square instead (Green FB → G1, Green EN → G3, Blue EN → G11, Blue FB → G13).
Capturing a Flag Bearer that is carrying the flag also resets the flag to G7.

**Unladen Sanctuary (buffer & decision):** When an unladen Flag Bearer enters the
inner circle it gets a grace period — the entry turn, then one normal **buffer
turn**, then one normal **decision turn**. During the buffer and decision turns
you may move **any** friendly piece (you are never forced to move the Bearer). At
any point the Bearer may step onto **G7** to collect the flag, or move **completely
out** through any open gate to retreat. If, after the decision turn, it has done
neither, it is automatically **routed home** (Green → G1, Blue → G13) and the flag
is left at G7. Merely ending on a gate tile does **not** count as a complete exit.

**Flag & extraction (laden):** Collecting the flag at G7 starts a **player-owned**
3-turn extraction countdown (the pickup turn does not count; every subsequent turn
by the carrier's owner spends one, whichever piece moves; opponent turns don't).
A laden carrier moves one square per turn and must reach an open side gate (E7/I7)
within those three turns. Reaching a side gate clears the countdown and forces the
carrier to step off it (E7 → D6/D7/D8, I7 → J6/J7/J8) on the owner's next turn.
Failing to extract, or a blocked forced departure, returns the flag to G7 and
routes the carrier home.

**Movement / capture per piece:**

| Piece | Movement | Capture |
|-------|----------|---------|
| **Flag Bearer** | 1–2 ortho/diag (exactly 1 while laden); no jump | Only the opposing Flag Bearer while it carries the flag, and never while either Bearer is inside the circle |
| **Engineer** | 1–2 ortho/diag | Cannot attack; opens walls via Cannon zones |
| **Spy** | 1–2 ortho/diag | Occupy the enemy square. Promotes to Assassin (Green rows 9–10, Blue rows 4–5) |
| **Assassin** | Up to 4 within territory (Green 9–13, Blue 1–5) | Occupy the enemy square. Demotes to a Spy on the first square across its boundary |
| **Horse** | Knight jump | Land on the enemy; may not land on walls/gates/inner circle/friendly/reserved |
| **Guard** | Exactly 1 orthogonally (empty only) | Exactly 1 diagonally only |
| **Spear** | 1 horizontal or diagonal (never straight forward/back) | 1 horizontal/diagonal; **Flank Charge** = forward orthogonal charge-capture up to 4 from a flank column (A/B/L/M). No backward move/capture while on a flank |

**Winning:** return your Flag Bearer carrying the flag to your home base.

---

## Project structure & architecture

Core rules are strictly separated from rendering — no game logic lives in DOM
event handlers.

```text
index.html            App shell (loads src/main.ts)
run.bat               Windows launcher
vite.config.ts        Vite + Vitest config
tsconfig.json
src/
  main.ts             UI: rendering, selection, controls (asks the engine for legality)
  styles.css          Medieval-fortress theme, responsive CSS Grid board
  ui/
    rules.ts          In-app rules-reference content and per-piece summaries
    orientation.ts    Turn-based visual board ordering (rendering-only rotation)
  game/               Pure, DOM-free rules engine
    types.ts          Serializable GameState and piece/coordinate types
    coords.ts         Coordinate utilities (algebraic <-> {col,row}, directions)
    constants.ts      Board geography, setup, and the 12 implementation assumptions
    terrain.ts        Square predicates (walls, gates, inner circle, reserved, cannon)
    movement.ts       Per-piece legal-move generation (pure)
    rules.ts          Isolated rule predicates (routing, promotion, cannon, victory)
    reducer.ts        applyMove — the 15-step turn resolution (pure)
    setup.ts          Initial state + clone
    session.ts        Undo stack + serialization (DOM-free)
    notation.ts       Human-readable history strings
tests/                Vitest suites (see below)
```

**Data flow:** `GameSession` holds a stack of immutable `GameState` snapshots.
`applyMove(state, move)` returns a brand-new state (or the same reference if the
move is illegal), so undo is simply discarding the latest snapshot and the whole
state round-trips through JSON.

### Tests

```text
tests/setup.test.ts          Board, coordinates, starting position
tests/movement.test.ts       Spy, Guard, Horse, Engineer movement/capture
tests/special-rules.test.ts  Flag Bearer, Engineer/walls, Spy/Assassin
tests/spear.test.ts          Spear normal moves, Flank Charge, flank restrictions
tests/victory.test.ts        Win conditions and illegal-move rejection
tests/undo.test.ts           Full-state restoration + serialization
tests/integration.test.ts    A complete multi-turn flag run
tests/extraction.test.ts     Laden countdown + forced side-gate departure
tests/unladen-sanctuary.test.ts  Unladen buffer/decision system + gate exits
tests/orientation.test.ts    Turn-based display ordering (helper + session)
tests/board-render.test.ts   Rendered board rotation & upright labels (jsdom)
tests/opening-restriction.test.ts  Green's turn-1 Engineer/Flag Bearer restriction
tests/starting-setup.test.ts       Current starting piece coordinates
```

Run them with `npm run test` (148 tests).

---

## Implementation assumptions

These required choices are centralized in `src/game/constants.ts` and the
isolated rule functions in `src/game/terrain.ts` / `src/game/rules.ts`:

1. **Green moves first.**
2. **Engineers cannot attack** — they only move to empty squares.
3. **Flag pickup ends movement** immediately.
4. **Timeout returns both** the flag (to G7) and the carrier (routed home).
5. **G1, G3, G11 and G13 are reserved** — only each square's own returning
   special piece may end there.
6. **The Spear's long attack is a charge capture** (moves onto the captured
   piece's square; path must be clear; first enemy only).
7. **Flag Bearers cannot attack each other if either is inside** the inner circle.
8. **Non-Bearers cannot capture a Bearer on a gate**, because they can never
   occupy gate squares in the first place (falls out of terrain rules).
9. **North/South are laden-exit-restricted:** a laden carrier extracts only
   through an open West/East gate, but an unladen Bearer may retreat through any
   open gate (North/South included).
10. **Cannon effects trigger only when an Engineer ends a move in the zone.**
11. **An already-open wall cannot be triggered again.**
12. **The second wall opening removes both Engineers immediately.**

### Unladen Sanctuary: buffer & decision

Entering the Sanctuary with an unladen Flag Bearer does **not** force an immediate
collection. Instead the owner gets a grace period tracked by a serializable
`unladenSanctuary` state (`{ player, bearerId, stage }`):

1. **Entry turn** — the Bearer ends on one of the eight inner squares (F6/G6/H6,
   F7/H7, F8/G8/H8). This activates the sequence at stage `bufferPending`. The
   entry turn is not the buffer turn.
2. **Buffer turn** (the owner's next turn) — the player may move any friendly
   piece. Collecting the flag at G7, or completely exiting the Sanctuary, ends the
   sequence; anything else advances it to `decisionPending`.
3. **Decision turn** (the owner's following turn) — again the player may move any
   friendly piece. Collecting or completely exiting ends the sequence; otherwise
   the Bearer is **automatically routed** home (Green → G1, Blue → G13). The flag
   is untouched because the Bearer was still unladen.

Only one sequence is active at a time; the opponent's Flag Bearer cannot enter
while it runs, and opponent turns never advance it. A **complete exit** means
finishing on an exterior, non-gate square — ending on a gate tile (G5/G9/E7/I7)
does not count. Unladen retreats may use any open gate; laden extraction still
only through an open E7/I7. Collecting the flag hands off to the laden extraction
countdown; the two states are never active simultaneously.

The logic is centralized: entry/exit predicates (`isUnladenEntrySquare`,
`bearerCompletedExit`) live in `src/game/rules.ts`, entry gating in
`canBearerEnterInnerCircle` (`src/game/terrain.ts`), the straight-through-gate
movement in `bearerStepLegal` (`src/game/movement.ts`), and the buffer/decision
state machine in `applyMove` (`src/game/reducer.ts`).

---

## Future enhancements

- Single-player AI opponent (the pure reducer + move generator make search
  straightforward).
- Online multiplayer.
- Replay export/import (state is already fully serializable).
- Alternate boards and configurable setups.
- Rule toggles (e.g. an anti-stalling Sanctuary rule for the edge case above).
- Sound and subtle move animation.
