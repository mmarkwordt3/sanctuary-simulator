# HANDOFF.md — Sanctuary

Current implementation status for continuing this project in a new session.
For stable architecture/rules that don't change task-to-task, see
`CLAUDE.md` instead — this file is about **where things stand right now**.

Written by directly inspecting the repository (source, tests, README, git
log/diff) on the date of writing — not reconstructed from conversation
memory, in case this chat had already been compacted.

## Repo state at time of writing

- Branch: `claude/sanctuary-web-game-bs2p6b`
- HEAD: `708faab` — "New starting setup: Spears on C/K, Spies on E/I, Guards
  on D/J row 3/11"
- `git status`: clean (no uncommitted changes)
- `npm run test`: **148/148 passing** (13 test files)
- `npm run typecheck`: clean (`tsc --noEmit`, no errors)
- `npm run build`: last verified passing as of the extraction-fix task; not
  re-run during this documentation pass (not required — no app code changed)

## What is actually implemented (verified by reading the code, not inferred)

In build order:
1. **Full base game** — 13×13 board, all 7 piece types, gates/walls/Cannon
   zones/inner circle, routing, promotion/demotion, victory, undo,
   pass-and-play UI. (`9d276c8`)
2. **Inner-circle single occupancy** — at most one Flag Bearer inside the
   Sanctuary at a time; entry requires the flag resting at G7.
   `canBearerEnterInnerCircle` in `terrain.ts`. (`cb2f1d8`)
3. **Turn-based board rotation** — active player's home row always renders
   at the bottom; rendering-only, internal coords unchanged.
   `src/ui/orientation.ts`. (`910af6d`)
4. **Player-owned laden extraction countdown + forced gate departure** —
   replaced an earlier "countdown only decrements on carrier moves" bug.
   Now decrements on every owner turn; reaching E7/I7 triggers mandatory
   next-turn departure to fixed outward squares. (`0f09527`)
5. **Unladen Sanctuary buffer/decision system** — replaced the original
   "unladen Bearer inside must move to G7 next turn" rule with a two-stage
   grace period (buffer turn, then decision turn) during which **any**
   friendly piece may move; auto-routes the Bearer only if neither flag
   pickup nor a complete exit happened by the end of the decision turn.
   `state.unladenSanctuary`, `reducer.ts`. (`da93f14`)
6. **Promotion boundary line rendering fix** (UI-only, no rule change) —
   green boundary line now visually tracks the 8/9 row boundary regardless
   of board orientation. (`75ff7c8`)
7. **Last-move indicator** — `state.lastMove` stores origin/destination in
   logical coordinates; rendered as origin highlight + stronger destination
   highlight, CSS strengthened once after initial add. (`50402dd`, `2611a2f`)
8. **Gate-diagonal-landing bug fix** — an unladen Bearer can now legally
   land on an open gate via an otherwise-legal diagonal 1–2 square move from
   an exterior square (previously blocked by an over-strict axis check).
   Confirmed via the exact repro: `E11 → G9` through empty `F10`.
   `bearerStepLegal` in `movement.ts`. (`11a0d1b`)
9. **Green opening restriction** — on Green's first turn only, the Green
   Engineer and Flag Bearer have zero legal moves; lifts permanently after
   Green's first completed move. Derived from `current === "green" &&
   history.length === 0`, no dedicated flag. `isBlockedByGreenOpening` in
   `rules.ts`. (`c057296`)
10. **New starting setup** — Spears now start at C1/K1 (C13/K13), Spies at
    E1/I1 (E13/I13), Guards at D3/J3 (D11/J11); Flag Bearer/Horse/Engineer
    squares unchanged. No terrain coordinates were touched. (`708faab`)

## Known documentation/code-comment inconsistencies (found during this audit)

These were **stale comments/UI text describing removed behavior** — not bugs
in the actual rule logic, which is correct and fully tested.

**Resolved in a later session** (docs/comments-only pass, no application
logic changed; 148/148 tests and typecheck still clean afterward):

1. `src/ui/rules.ts`, `PIECE_SUMMARY.flagBearer`: previously said "once
   inside (unladen) it may only move to G7 to collect the flag," describing
   the **old** mandatory-collection rule that item 5 above replaced. Now
   describes the actual buffer/decision grace period (free movement inside,
   auto-route home if neither collected nor fully exited by the end of the
   decision turn).
2. `src/game/terrain.ts`, doc comment on `canBearerEnterInnerCircle`:
   previously claimed "Rule 3 (an unladen Bearer already inside may only
   move onto G7 to collect the flag) is enforced in movement generation."
   Now correctly attributes the buffer/decision behavior to the
   `unladenSanctuary` state machine in `reducer.ts`.
3. `README.md`: test count updated from "130 tests" to **148 tests**; the
   `### Tests` table now lists `opening-restriction.test.ts` and
   `starting-setup.test.ts`, which were previously missing.

**Still open (not addressed, low priority):**

4. `Sanctuary_Claude_Code_Build_Brief.md` (repo root) is the **original spec
   document** from before any of the 9 follow-up tasks above — it describes
   the *original* mandatory-collection Sanctuary rule, the *original*
   starting setup (Spy/Spear/Guard squares), and has no mention of board
   rotation, the opening restriction, or the last-move indicator. It is a
   historical input artifact, not live documentation — do not treat it as
   authoritative for current behavior. `CLAUDE.md` and this file supersede it.

None of the above affect gameplay correctness — they are/were text-only
discrepancies in comments/UI copy/docs.

## No open bugs

No known incorrect rule-engine behavior at time of writing. The most
recently fixed bug (gate-diagonal-landing, item 8 above) has a regression
test (`tests/special-rules.test.ts`, "an unladen Bearer may end on an open
gate via a 1-2 square diagonal (E11 → G9)").

## Exact next task

None queued. The most recent user request (this one) was documentation-only:
resolve the stale doc/comment/README inconsistencies (item 1-3 above). If the
user's next message doesn't specify a task, ask what they'd like next rather
than assuming. Natural candidates if asked for a suggestion (not started, not
requested):
- Update `Sanctuary_Claude_Code_Build_Brief.md` or mark it clearly historical
  (item 4 above, still open).
- Any of the "Future enhancements" ideas in `README.md` (AI opponent, online
  multiplayer, replay export/import, alternate boards, rule toggles, sound/
  animation) — all unstarted.

## Relevant files (by task area, for quick orientation)

- **Rules engine core:** `src/game/reducer.ts` (turn resolution),
  `src/game/movement.ts` (legal-move generation, incl. Flag Bearer gate
  logic), `src/game/rules.ts` (isolated predicates: extraction, gate
  departure, opening restriction, unladen-Sanctuary entry/exit),
  `src/game/terrain.ts` (square predicates incl. inner-circle entry gating).
- **State shape:** `src/game/types.ts` (`GameState`, `UnladenSanctuary`).
- **Setup/session:** `src/game/setup.ts` (`createInitialState`,
  `STARTING_SETUP` lives in `constants.ts`), `src/game/session.ts`
  (`GameSession` undo/serialize).
- **UI:** `src/main.ts` (render + click handling + status panel text),
  `src/ui/orientation.ts` (board rotation), `src/ui/rules.ts` (in-app rules
  text — contains the one stale string noted above), `src/styles.css`.
- **Tests:** `tests/helpers.ts` (shared fixtures — note the seeded
  non-empty `history` default, see `CLAUDE.md` "Opening restriction"), plus
  one file per concern; `tests/opening-restriction.test.ts` and
  `tests/starting-setup.test.ts` are the two newest/most narrowly scoped.

## Test status detail

```
Test Files  13 passed (13)
     Tests  148 passed (148)
```
Files: `setup.test.ts`, `movement.test.ts`, `special-rules.test.ts`,
`spear.test.ts`, `victory.test.ts`, `undo.test.ts`, `integration.test.ts`,
`extraction.test.ts`, `unladen-sanctuary.test.ts`, `orientation.test.ts`,
`board-render.test.ts`, `opening-restriction.test.ts`,
`starting-setup.test.ts`.

Typecheck: clean. Build: not re-run in this pass (no app code touched); last
known-good at HEAD `708faab`.
