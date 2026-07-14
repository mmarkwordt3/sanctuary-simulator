# Automated Experiments Phase 1 Architecture

Phase 1 adds a browser-local automated self-play experiment system. It persists experiment metadata, a deterministic game-job queue, and completed game records in IndexedDB so work can be inspected, exported, and resumed explicitly after reloads or browser interruptions.

## IndexedDB schema

Database: `sanctuary-automated-experiments`, schema version `1`.

Stores:

- `experiments` keyed by `experimentId`, with a `status` index.
- `gameJobs` keyed by `jobId`, with `experimentId`, `[experimentId, status]`, and `[experimentId, ordinal]` indexes.
- `completedGames` keyed by `gameId`, with `experimentId`, `[experimentId, winner]`, and `[experimentId, opening]` indexes.

Experiment records retain lifecycle status, mode, settings, total and status-specific job counts, win/draw counters, current and last completed job IDs, simulator/build identifiers, schema version, and timestamps. Game jobs retain queue status, ordinal, seed, forced opening/reply metadata, attempt count, timestamps, failure messages, and the forced move prefix. Completed games extend the simulator `GameRecord` with experiment/job IDs, stable game ID, completion timestamp, schema version, and replay verification.

## Experiment lifecycle

Experiments are created in `queued` status after deterministic jobs are generated and stored. A resumed experiment becomes `running` while one queued job at a time is executed. User pause returns the active/running job to `queued` after the current game is saved or on recovery. Completion marks the experiment `completed` when all jobs are completed, failed, or cancelled and no queued jobs remain. Cancellation preserves completed games and marks queued jobs `cancelled`.

Supported statuses are `draft`, `queued`, `running`, `paused`, `completed`, `cancelled`, and `failed`.

## Job lifecycle

Jobs begin as `queued`, become `running` immediately before execution, and then become `completed`, `failed`, or `cancelled`. Failed jobs keep their failure message and can be returned to `queued` with Retry Failed Jobs. Phase 1 intentionally runs only one active job at a time.

## Atomic completion

Completing a game uses a single IndexedDB `readwrite` transaction spanning `completedGames`, `gameJobs`, and `experiments`. The transaction writes the completed game, marks the job completed, updates aggregate counters, records `lastCompletedJobId`, and clears `currentJobId`. Stable `gameId` values are derived from experiment and ordinal so reload/retry cannot create duplicate completed game identities.

## Reload recovery

Startup calls recovery that finds experiments left in `running` status, changes them to `paused`, and returns any `running` jobs to `queued`. Computation never silently restarts. The user must explicitly click Resume. If reload happens during a game, the unfinished job can restart from the beginning with the same deterministic seed and forced prefix; already completed games remain persisted and are not duplicated.

## Deterministic seeds and jobs

The job-generation layer is pure: the same settings produce the same ordered job list. Standard experiments increment seeds from the starting seed. Opening exploration enumerates legal Green first moves in engine order and optionally legal Blue replies. Targeted automatic creates one job per selected Green opening per requested game; targeted forced creates one job for every selected Green-opening/Blue-reply pairing per requested game. Job IDs combine experiment ID, ordinal, and seed.

## Export structure

Experiment ZIP exports are generated from IndexedDB, not in-memory run state. Exports include:

- `experiment_metadata.json`
- `experiment_summary.json`
- `game_jobs.csv`
- `game_summary.csv`
- `games.jsonl`
- `opening_results.csv`
- `failed_jobs.csv` when failures exist
- `analysis_summary.md`

## Browser execution limitations

Phase 1 is browser-local. It persists enough data to resume after reloads, tab closes, sleep, tab suspension, or power loss, but it does not compute while the browser tab is closed, suspended, the device sleeps, or the computer is off.

## Future server-worker path

The experiment, job, and completed-game records avoid DOM-specific concepts and can be consumed by a future server or always-on worker. A remote worker could claim queued jobs, run the same simulator logic, and write completed-game records with the same identifiers and summaries. True 24/7 execution requires that future server or always-on machine; it is intentionally not implemented in Phase 1.

## Dedicated experiment worker

Automated experiments dispatch one queued job at a time to `experiment-worker.ts`. The worker imports the shared `runJobGame` helper, which calls the existing simulator runner rather than a second simulator implementation. The UI owns queue state and IndexedDB persistence; the worker owns CPU-heavy game execution and reports `job-started`, `progress`, `job-completed`, `job-failed`, and `cancelled` messages. The UI persists a completed result before requesting the next queued job, so Pause prevents the next job from starting and duplicate Resume clicks are ignored while a run is active.

## Replay board UI

Completed games can be replayed from their stored move list. The replay reconstructs a timeline by applying each stored move through the existing game reducer. The detail view renders a board, highlights the previous move, shows ply, current player, flag carrier/location, wall state, winner/draw information, and provides Start, Previous, Play, Pause, Next, End, and speed controls. Failed replay verification is shown as a warning while raw metadata and moves remain available.

## Completed-game browsing

The detail view exposes paginated completed-game browsing with filters for winner, draw reason, Green opening, actual Blue first move, forced Blue reply, ply bounds, replay failures, and sorting by ordinal, seed, plies, result, opening, and completion time. Queries are served through the IndexedDB-backed `completedGames` API with offset and limit values so the UI does not render all stored games at once.
