# Sanctuary Simulator Agents

The simulator agents are separate from the playable game engine. They do not
change official rules, legal move generation, or move application. Their only
job is to choose among legal moves produced by `src/game/movement.ts` and scored
after `src/game/reducer.ts` applies candidate moves.

## Agents

- `random`: preserved unchanged; chooses a legal move by seed-indexed selection.
- `legacy-heuristic`: the old capture-first policy; it chooses a capture when one
  is available and otherwise chooses a seed-indexed legal move.
- `heuristic` / `heuristic-deterministic`: objective-aware one-ply policy using
  the named evaluation below.
- `search` / `search-deterministic`: objective-aware depth-limited search using
  the same evaluation plus search-path repetition detection.
- `heuristic-diverse`: scores legal root moves with the objective-aware
  evaluation, then seed-selects among moves close to the best score.
- `search-diverse`: runs adversarial root search, then seed-selects among
  near-equal root moves. Deeper opponent responses remain deterministic.

## Evaluation components and weights

Terminal wins are `+1,000,000` and terminal losses are `-1,000,000`. Non-terminal
scores are clamped below the terminal value so no intermediate bonuses can be
worth more than an actual win.

Named components:

- `material` (`18` per material point): keeps ordinary captures relevant without
  letting material dominate the flag objective.
- `gateProgress`: rewards the first open side gate (`900`), both gates (`250`),
  Engineer progress toward cannon zones (`55` per distance step), and nearby
  friendly protection (`12`). Engineer movement is useful only when it improves
  access to a cannon zone or protection.
- `sanctuaryProgress`: after a side gate is open, rewards Flag Bearer progress
  toward legal Sanctuary entrances (`70` per distance step), entering the
  Sanctuary (`350`), moving inside toward G7 (`120` per distance step), and a
  viable route from G7 to an open side gate (`140`).
- `flagPossession`: flag pickup is worth `2,500`, far more than an ordinary
  capture or small material edge.
- `extractionProgress`: while the countdown is active, rewards reducing the
  carrier's distance to E7/I7 (`360` per distance step) and reaching an open
  extraction gate (`2,800`).
- `extractionUrgency`: rewards retaining extraction turns (`180` each), penalizes
  impossible extraction within the remaining turns (`-2,200`), and discourages
  non-carrier moves during extraction (`-320`) unless their resulting position
  has enough tactical value to compensate.
- `forcedDeparture`: forced gate departure is urgent and worth `3,200`; the
  official move generator already ensures the carrier owner may only move the
  carrier in this phase.
- `homewardCarrierProgress`: after gate departure, rewards the post-extraction
  carrier (`3,000`) and each step closer to G1/G13 (`320`).
- `carrierSafety`: rewards friendly pieces near the carrier and penalizes nearby
  enemies (`28` each).
- `mobility`: small legal-move differential (`4` per move), used only as a tie
  breaker.
- `repetitionPenalty`: simulator-only avoidance; repeated positions score `-650`
  and immediate reversals score `-450`.

Repetition handling is intentionally simulator-agent behavior only. It does not
modify draw rules, legal moves, or reducer behavior in the game engine.

## Controlled diversity

Diversity is optional and reproducible. It never picks outside the legal move
generator and never randomizes the opponent's deeper search response. Terminal
wins and forced gate-departure moves override diversity.

The diversity level controls the maximum permitted score loss from the best
root move:

- `0`: deterministic; only the best move is eligible.
- `1`: low diversity; moves within `25` points of best are eligible.
- `2`: moderate diversity; moves within `100` points are eligible.
- `3`: high diversity; moves within `250` points are eligible.

The selector records the chosen move's score, the best available score, score
loss, and whether diversity changed the top deterministic choice. This creates
variety only among strategically similar moves; it does not weaken evaluation
weights or choose uniformly from all legal moves.

## Opening exploration

`simulator/opening-exploration.ts` provides a research mode that enumerates every
legal Green first move, forces each opening for an equal number of games, lets
Blue respond normally, and reports each opening separately. It can optionally
force each legal Blue reply too. Each run records the agents, search depth,
seed start, games per opening, and diversity setting so datasets do not collapse
onto only the single highest-rated opening.
