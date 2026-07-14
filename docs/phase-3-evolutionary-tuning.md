# Phase 3: Evolutionary evaluation tuning

Phase 3 adds browser-local, single-worker evolutionary tuning for the Sanctuary simulator evaluator. It does **not** add neural networks, reinforcement learning, remote execution, parallel workers, automatic rule changes, or automatic replacement of the production profile.

## Evaluation profile model

The production constants are preserved as `production-baseline-v1`. A versioned evaluation profile stores `profileId`, name, timestamps, source, parent profile IDs, generation, mutation seed, weights, locked keys, promotion flag, notes, schema version, and evaluator version.

Weights are grouped by strategic concept: terminal, material, gates, Sanctuary, flag, extraction, carrier homeward progress, carrier safety, containment, repetition and stagnation, mobility, routing pressure, and objective progress.

## Tunable and locked weights

Most strategic coefficients are tunable. Rule-like invariants are locked, including the dominant terminal win score and bounded draw score. Every weight has minimum and maximum bounds, a sign constraint, and a mutation scale. Validation rejects NaN, Infinity, unsafe numeric values, and sign violations.

## Mutation behavior and deterministic seeds

Generation 0 is derived from the baseline. Candidate profiles are created with deterministic seeded perturbations. Mutation touches only tunable weights, preserves signs and bounds, records readable summaries, and rejects duplicate weight hashes by retrying with deterministic alternate seeds. Locked weights never mutate.

## Match scheduling

The deterministic scheduler mixes candidate-vs-baseline and compact peer fixtures. It schedules both colors where practical, fixed seed sets, and a mirrored opening suite. The first default suite contains C1-B1/K1-L1, D3-E3/J3-I3, D3-D4/J3-J4, and E1-F1/I1-H1. The suite is editable.

## Scoring formula

Scoring is transparent and configurable. It combines match points, baseline bonus, peer bonus, mirror and color-balance adjustments, draw-pathology penalties, repetition/no-progress/max-plies penalties, line-diversity and instability penalties, data-quality penalties for replay/illegal failures, holdout penalties, and a small search-cost tiebreaker. A higher tuning score is a local tournament score, not proof of stronger general play.

## Anti-overfitting safeguards

Runs use training, validation, and holdout concepts. Selection uses training fixtures. Promotion reports can include validation and holdout checks that are not fed back into same-run mutation. Candidates are flagged for training-only success, mirror gaps, one-color dependence, high repetition, low line diversity, baseline regression, and reliance on narrow openings.

## Generation lifecycle and lineage

At generation end, candidates are ranked deterministically. Elites are retained, parents are selected by rank, descendants are mutated, and lineage is persisted through parent candidate IDs and profile parent IDs. Auto-pause after each generation is supported by the run settings.

## Worker architecture and browser limits

The tuning worker runs one match at a time and is intended to persist after every match through IndexedDB. Browser-local execution does not continue while the tab is closed, suspended, the device sleeps, or the browser process is killed.

## Promotion safeguards

Promotion eligibility requires zero replay failures, zero illegal moves, repetition/no-progress rates within named limits, no material baseline regression, mirror and color balance under thresholds, positive validation, non-negative holdout, and a minimum sample size. Approval creates a separate promoted profile and never deletes or overwrites the production baseline. Actual production default use remains a separate explicit action.

## Limitations

Evolutionary tuning searches a small, configured neighborhood of evaluator weights. It can overfit to fixtures if safeguards are weak, and low-cost runs validate plumbing rather than strategic superiority. Human review remains required because tournament scores are empirical, local, and sensitive to openings, seeds, depth, and draw policies.

## Persistent tuning lifecycle

`TuningStore` owns the persistent Phase 3 lifecycle in IndexedDB. It can create, load, list, resume, pause, cancel, retry, recover, delete, export, approve, and reject tuning runs. Match completion is guarded against duplicate increments and updates the match, run totals, generation ranking, candidate totals, next-generation scheduling, validation/holdout scheduling, and final promotion report through IndexedDB transactions.

Generation numbering is zero-based in records and displayed to users as one-based progress. A request for two generations executes generation `0` and generation `1` before finalists are sent to validation and holdout fixtures. Validation and holdout are persisted with separate `fixture` phases and are not used to mutate candidates inside the same run.

Approval creates a separate experimental profile with source `promotion`; it does not overwrite `production-baseline-v1` and does not make the approved profile the production default. Rejection updates the candidate/report while preserving the persisted audit trail.
