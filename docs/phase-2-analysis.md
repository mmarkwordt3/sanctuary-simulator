# Phase 2 automated experiment analysis

Phase 2 adds a browser-local analyzer that reads persisted completed-game records from IndexedDB. It does not inspect in-memory runner state and it does not change Sanctuary rules, legal move generation, evaluation weights, or start new experiments automatically.

## Architecture and schema

IndexedDB schema version 2 adds `experimentAnalyses`, `analysisFlags`, and `followUpProposals`. Analyses store aggregate summaries, mirror comparisons, draw/length/diversity/tactical totals, cross-experiment comparisons, stale status, analyzer version, source experiment update time, and replay-worthy games. Flags and proposals are separate records linked by `analysisId` and `experimentId`.

## Analyzer versioning and thresholds

`ANALYZER_VERSION` identifies the rules implementation. `ANALYSIS_RULE_CONFIG` centralizes thresholds for opening win-rate anomalies, first-player advantage, mirror asymmetry, dominant Blue replies, depth instability, draw pathology, long games, low diversity, and insufficient samples. Recomputing creates a new analysis while preserving dismissed matching flags.

## Mirror mapping

The board is normalized horizontally: A↔M, B↔L, C↔K, D↔J, E↔I, F↔H, and G↔G. Rows do not change. Move labels are mirrored by replacing coordinate tokens, so `C1-B1` mirrors to `K1-L1`, `D3-E3` to `J3-I3`, and `G13-E11` to `G13-I11`. Unparseable labels are ignored rather than forced into a mirror pair.

## Confidence labels

Confidence labels are transparent evidence-quality labels (`very low`, `low`, `moderate`, `high`). They consider sample size and mirrored confirmation. Replay or legality failures lower interpretability because data quality must be addressed before strategic interpretation.

## Cross-experiment compatibility

Depth comparisons are considered compatible when mode, agents, diversity settings, max plies, no-progress settings, response mode, and selected openings match while search depth differs. Incompatible comparisons are still displayed with a warning and low confidence.

## Flag meanings and limitations

Flags are triage classifications: normal, watch, suspicious, or high priority. They identify openings, replies, draw patterns, depth changes, and data-quality issues worth replaying or retesting. They are not proof that Sanctuary is balanced, imbalanced, solved, or exploitable.

## Follow-up proposals

Meaningful flags generate editable follow-up proposals that inherit source settings and adjust only focused fields such as selected openings, mirrored openings, games per matchup, or search depth. Creating a proposal calls the existing persisted experiment creation path and never auto-starts the experiment.

## Exports

Analysis exports include JSON, Markdown, CSV summaries, flags, follow-up proposals, representative games, and analyzer configuration. Markdown reports include sample sizes, findings, limitations, and recommended next experiments without claiming proofs.

## Manual browser acceptance flow

1. Create and complete two targeted automatic experiments using `C1-B1`, `K1-L1`, `D3-E3`, and `J3-I3`, with the same agents, diversity, seed range, max plies, and no-progress settings, but depths 1 and 2.
2. Run analysis on both experiments from the experiment dashboard.
3. Open the cross-experiment comparison panel, select the depth-1 experiment as the source, select the depth-2 experiment as the target, and compare. Verify the compatibility table shows the settings match except for search depth, opening-level changes are listed, depth differences are visible, and flags added or changed are summarized.
4. Open a flag in the Analysis view, click `Create Follow-Up Experiment`, edit the proposal form by changing depth and games per opening/pairing, confirm the estimated games and changed-fields display, then create the experiment. The new experiment should be persisted but not auto-started.
5. Create another experiment with `Run analysis automatically when experiment completes` enabled. Complete it and verify the Analysis view appears afterward with analyzer version `phase2-rules-v1` and `stale` not shown.
