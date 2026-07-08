# Claude Code Build Brief: Sanctuary

Build a complete, polished, playable browser version of the two-player abstract strategy game **Sanctuary**.

Do not stop at a scaffold, mockup, pseudocode, or partial rules implementation. Implement the entire game, run the tests and production build, fix errors, and leave the repository ready to run.

Do not ask follow-up questions. Use the explicit implementation assumptions near the end of this document and isolate them in the rules layer so they can be changed later.

## Product goal

Create a local pass-and-play web app for two human players on the same device.

The app must:

- Render the complete 13×13 board.
- Enforce every rule in this document.
- Highlight legal moves and captures.
- Prevent illegal moves.
- Track turn, flag, walls, Engineers, promotions, countdowns, captures, routing, and victory.
- Show a readable event history.
- Support undo, restart, and new game.
- Work on desktop and tablet.
- Require no backend or external service.

Favor rules correctness and maintainability over visual effects.

## Technology

Use:

- Vite
- TypeScript
- Vanilla HTML/CSS/TypeScript
- Vitest

The app must run with:

```bash
npm install
npm run dev
```

Also support:

```bash
npm run test
npm run build
```

Create `run.bat` for Windows that installs dependencies if needed and launches the development server.

Use semantic HTML and CSS Grid, not a canvas game engine.

## Suggested project structure

```text
index.html
package.json
tsconfig.json
vite.config.ts
src/
  main.ts
  styles.css
  game/
    types.ts
    constants.ts
    setup.ts
    movement.ts
    rules.ts
    reducer.ts
    notation.ts
tests/
  movement.test.ts
  special-rules.test.ts
  victory.test.ts
README.md
run.bat
```

The exact structure may differ, but separate board definitions, pure rules logic, state transitions, and UI rendering. Do not place core game rules directly in DOM event handlers.

# Game overview

Sanctuary is a two-player perfect-information abstract strategy game.

Each side controls:

- 1 Flag Bearer
- 1 Engineer
- 2 Spies, which may promote into Assassins
- 2 Spears
- 2 Guards
- 1 Horse

The neutral flag begins inside the central Sanctuary. A player wins by retrieving the flag with their Flag Bearer and returning the carrier to that player’s home base.

Green begins at the top and generally advances toward increasing row numbers. Blue begins at the bottom and generally advances toward decreasing row numbers. Green moves first.

Each turn consists of exactly one legal move by one piece. Captures occur as part of movement.

# Coordinates

The board is a 13×13 grid.

- Columns: A–M
- Rows: 1–13
- A1 is upper-left.
- M13 is lower-right.

Create coordinate utilities rather than scattering string parsing throughout the code.

# Board geography

## Flag

The neutral flag begins at:

```text
G7
```

## Inner circle

The inner circle is:

```text
F6 G6 H6
F7 G7 H7
F8 G8 H8
```

Only Flag Bearers may enter or occupy these squares.

## Permanent ring-wall squares

These 12 squares are permanently inaccessible:

```text
E5, E6, F5,
H5, I5, I6,
E8, E9, F9,
H9, I9, I8
```

No piece may enter or pass through them. The Horse may jump over them but may not land on them.

## Gates

```text
North Gate: G5
West Gate:  E7
East Gate:  I7
South Gate: G9
```

Only Flag Bearers may enter or occupy gate squares.

North and South begin open.

West and East begin blocked:

```text
West Wall blocks E7
East Wall blocks I7
```

A blocked gate is inaccessible even to a Flag Bearer. Once removed, a wall never returns.

## Cannon zones

The Cannon zones are lore-based board areas, not pieces.

West Cannon:

```text
A6, A7, A8
```

East Cannon:

```text
M6, M7, M8
```

The interaction is deliberately cross-map:

- Engineer ending on A6, A7, or A8 removes the East Wall at I7.
- Engineer ending on M6, M7, or M8 removes the West Wall at E7.

If the corresponding wall is already open, these squares behave normally.

## Promotion boundaries

Green:

- A Green Spy promotes if it ends its turn on row 9 or 10.
- A Green Assassin remains promoted while on rows 9–13.
- Crossing from row 9 to row 8 causes demotion.

Blue:

- A Blue Spy promotes if it ends its turn on row 4 or 5.
- A Blue Assassin remains promoted while on rows 1–5.
- Crossing from row 5 to row 6 causes demotion.

Promotion is evaluated at the end of the Spy’s move.

# Starting setup

## Green

```text
Spy:         C1
Spear:       E1
Flag Bearer: G1
Spear:       I1
Spy:         K1
Guard:       F2
Horse:       G2
Guard:       H2
Engineer:    G3
```

## Blue

```text
Engineer:    G11
Guard:       F12
Horse:       G12
Guard:       H12
Spy:         C13
Spear:       E13
Flag Bearer: G13
Spear:       I13
Spy:         K13
```

Reserved return squares:

```text
Green Flag Bearer: G1
Green Engineer:    G3
Blue Engineer:     G11
Blue Flag Bearer:  G13
```

No other piece may end on these four reserved squares.

# General rules

## Turns

On a turn, move exactly one friendly piece. Capturing occurs by moving onto an enemy-occupied destination unless a piece-specific rule says otherwise.

After all consequences resolve, play passes to the other player.

## Blocking

Unless the piece is a Horse:

- It cannot jump.
- It cannot pass through occupied squares.
- It cannot pass through permanent walls.
- It cannot pass through a closed gate.
- Every intermediate square of a multi-square move must be empty and traversable.

A piece may never land on a friendly piece.

## Ordinary capture

These pieces are permanently removed when captured:

- Spy
- Assassin
- Spear
- Guard
- Horse

## Routing

Flag Bearers and Engineers are routed instead of permanently removed.

- Green Flag Bearer returns to G1.
- Blue Flag Bearer returns to G13.
- Green Engineer returns to G3.
- Blue Engineer returns to G11.

If a routed Flag Bearer carried the flag:

- Return the flag to G7.
- Clear carrier state.
- Clear the extraction countdown.

The attacker occupies the routed piece’s former square if that square is legal for the attacker.

## Gate and Sanctuary access

Only Flag Bearers may enter gates or the inner circle.

All other pieces treat gate and inner-circle squares as inaccessible destinations and movement blockers. The Horse may jump over them but may not land on them.


# Piece rules

## Flag Bearer

### Movement without the flag

May move:

- 1 or 2 squares orthogonally, or
- 1 or 2 squares diagonally

It may not jump.

### Movement with the flag

May move exactly 1 square orthogonally or diagonally.

### Attacking

A Flag Bearer:

- Cannot attack ordinary pieces.
- Cannot attack an Engineer.
- May attack only the opposing Flag Bearer.
- May attack the opposing Flag Bearer only while that opponent is carrying the flag.
- Captures by moving onto the opposing Flag Bearer’s square.

Flag Bearers cannot attack one another if either the attacker or target is inside the inner circle.

### Entering and leaving the inner circle

A Flag Bearer may enter through any open gate.

A Flag Bearer may leave the inner circle only through the open West Gate or open East Gate. North and South are entrance-only gates. This applies whether the Flag Bearer is carrying the flag or not.

### Picking up the flag

When a Flag Bearer lands on G7 while the flag is present:

- It immediately takes the flag.
- Remove the flag marker from G7.
- End movement immediately.
- Set an extraction allowance of 3 personal turns.

### Three-turn extraction limit

The pickup turn does not count.

After each of that carrier’s next moves:

1. Resolve the move.
2. If it has reached E7 or I7, it has left the inner circle and the countdown ends.
3. Otherwise decrement the remaining extraction turns.
4. If it remains inside after the third allowed turn, reset the attempt.

Timeout implementation:

- Return the flag to G7.
- Route the Flag Bearer to its home square.
- Clear the countdown.

### Victory

Green wins when its carrier reaches G1.

Blue wins when its carrier reaches G13.

## Engineer

### Movement

May move 1 or 2 squares orthogonally or diagonally. It may not jump.

### Attacking

Engineers cannot attack. They may move only to empty legal squares.

### Being attacked

An attacked Engineer routes to its starting square.

### Opening walls

If an Engineer ends its move in a Cannon zone while the corresponding wall remains closed:

- Remove that wall permanently.
- Add a wall-opening event to history.
- If one wall is still closed, route the Engineer to its start.
- If this was the second wall, remove both Engineers immediately.

When the second wall opens:

- The Engineer that opened it is removed instead of routed.
- The other Engineer is removed wherever it is.
- Engineers take no further part in the game.

The same Engineer may open both walls.

## Spy

Each side has two.

### Movement and capture

May move 1 or 2 squares orthogonally or diagonally. It may not jump.

Captures by occupying the enemy square.

- Ordinary enemies are removed.
- Engineers and Flag Bearers are routed.

A Spy cannot enter the inner circle or end on a gate.

### Promotion

At end of move:

- Green promotes on row 9 or 10.
- Blue promotes on row 4 or 5.

Change the piece to Assassin only after movement and capture resolve.

## Assassin

### Movement

May move up to 4 squares orthogonally or diagonally. It may not jump.

- Green Assassin territory: rows 9–13.
- Blue Assassin territory: rows 1–5.

### Capture

Captures by occupying the target square.

- Ordinary enemies are removed.
- Engineers and Flag Bearers are routed.

An Assassin may not:

- Enter the inner circle
- End on a gate
- Capture a Flag Bearer occupying a gate

### Demotion

An Assassin may cross back over its boundary, but:

- It immediately becomes a Spy.
- Its movement ends on the first square beyond the boundary along the chosen line.
- It cannot continue using unused Assassin range.

If that first square contains an enemy piece, it may capture the piece and then becomes a Spy.

If that first square contains a friendly piece, permanent wall, gate, inner-circle square, or other inaccessible feature, the move is illegal.

## Horse

Each side has one.

### Movement

Moves exactly like a chess knight:

- Two squares in one orthogonal direction
- Then one square perpendicular

The Horse jumps over all intervening pieces, walls, gates, and inner-circle squares.

### Destination restrictions

It may not land:

- Off-board
- On a friendly piece
- On a permanent wall
- On a gate
- Inside the inner circle
- On a reserved special return square

### Capture

Captures by landing on an enemy:

- Ordinary pieces are removed.
- Engineers and Flag Bearers are routed.

## Guard

Each side has two.

### Movement

Moves exactly 1 square orthogonally to an empty legal square.

It cannot move diagonally to an empty square.

### Capture

Captures exactly 1 square diagonally by moving onto the enemy.

It cannot capture orthogonally.

- Ordinary pieces are removed.
- Engineers and Flag Bearers are routed.

A Guard cannot enter the inner circle or end on a gate.

## Spear

Each side has two.

### Facing

- Green faces toward increasing row numbers.
- Blue faces toward decreasing row numbers.

### Normal movement

A Spear may:

- Move exactly 1 square horizontally to an empty square, or
- Move exactly 1 square diagonally to an empty square.

It does not normally move straight forward or backward.

### Normal capture

A Spear may capture an adjacent enemy:

- Exactly 1 square horizontally, or
- Exactly 1 square diagonally.

It captures by occupying the target square.

### Flank columns

```text
A, B, L, M
```

### Flank Charge

If a Spear begins its turn in a flank column, it may make a forward orthogonal charge-capture against an enemy up to 4 squares ahead in the same column.

Implement this as a charge capture:

- The Spear moves onto the captured piece’s square.
- The path must be clear.
- It cannot jump over any piece.
- It captures only the first enemy encountered.
- The target remains in the same flank column.
- Ordinary targets are removed.
- Engineers and Flag Bearers are routed.

### No backward movement on a flank

While a Spear occupies A, B, L, or M:

- Green may not make a move or capture that decreases its row.
- Blue may not make a move or capture that increases its row.

This includes backward-diagonal moves and captures.

Horizontal movement within or out of the flank remains legal if otherwise valid.

# Turn resolution order

For every move:

1. Verify the game is not over.
2. Verify the piece belongs to the current player.
3. Generate and validate movement.
4. Validate terrain, gates, walls, inner circle, occupancy, and path.
5. Resolve capture, if any.
6. Move the piece.
7. Resolve routing.
8. Resolve flag pickup.
9. Resolve Spy promotion or Assassin demotion.
10. Resolve Cannon wall removal.
11. Resolve second-wall Engineer removal.
12. Resolve extraction countdown.
13. Check victory.
14. Append a readable history entry.
15. Switch player unless game over.

Implement these as pure functions where practical.

# Required interface

## Main board

Render:

- Coordinate labels A–M and 1–13
- Permanent walls
- Inner circle
- Four gates
- Closed/open East and West walls
- Cannon zones
- Promotion boundary lines
- Neutral flag
- All pieces

Use both color and text/symbols. Suggested labels:

- `FB` Flag Bearer
- `EN` Engineer
- `SP` Spy
- `AS` Assassin
- `SR` Spear
- `GD` Guard
- `H` Horse

## Selection

Clicking a friendly piece should:

- Select it
- Highlight legal empty moves
- Highlight legal captures differently
- Show a short rule summary
- Execute a move when a legal destination is clicked

Do not rely solely on drag-and-drop.

## Status panel

Display:

- Current player
- Selected piece
- East and West wall state
- Flag state
- Carrier and turns remaining
- Engineer status
- Assassin count
- Winner/game-over status

## History

Examples:

```text
Green Spy C1 → D2
Blue Engineer G11 → E9
Green Engineer reached A7; East Wall removed
Blue Horse captured Green Guard on F2
Green Spy promoted on K9
Blue Flag Bearer took the flag; 3 extraction turns remain
```

## Controls

Provide:

- Undo
- Restart
- New game
- Toggle coordinates
- Toggle move highlights
- Rules/reference panel

Undo must restore full state, including walls, Engineers, flag, countdown, promotions, captures, routes, winner, and history.

## Responsive design

Desktop:

- Board left
- Status/history/rules right

Tablet/narrow:

- Board first
- Panels below

The board should fit without horizontal scrolling on normal tablet widths.


# Visual direction

Use a restrained medieval-fortress theme.

Suggested colors:

- Green team: muted green
- Blue team: muted blue
- Permanent walls: stone gray
- Inner circle: warm off-white
- Flag tile: muted orange
- Cannon zones: muted violet
- Open gates: tan
- Closed gates: dark stone
- Legal move: translucent highlight
- Legal capture: red outline

Avoid excessive gradients, fantasy artwork, animated backgrounds, or particle effects. Subtle transitions are acceptable.

# In-app rules reference

Include:

- Objective
- Setup
- Board geography
- Gates and walls
- Cannon zones
- Routing
- Flag and countdown
- Each piece’s movement/capture
- Promotion/demotion
- Win condition

Include a compact always-available piece reference.

# Automated tests

Use Vitest and cover at least the following.

## Board/setup

- 169 coordinates exist.
- Starting coordinates are unique.
- All 12 permanent walls are inaccessible.
- Initial pieces are correct.
- East/West walls begin closed.
- Flag begins G7.
- Green begins.

## Flag Bearer

- Unladen movement is 1–2 orthogonal/diagonal.
- Laden movement is 1.
- Cannot attack ordinary pieces.
- Can route an opposing carrier outside the inner circle.
- Cannot attack another Bearer if either is inside.
- Only Bearers occupy gates/inner circle.
- North/South entry works.
- North/South exit fails.
- East/West exit fails while closed and works when open.
- Pickup ends movement.
- Timeout resets flag and routes carrier.
- Reaching home while carrying wins.

## Engineer/walls

- Engineer moves 1–2 orthogonal/diagonal.
- Engineer cannot attack.
- Capture routes Engineer.
- A6–A8 removes East Wall.
- M6–M8 removes West Wall.
- First opening routes Engineer.
- Second opening removes both Engineers.
- Open wall stays open.

## Spy/Assassin

- Spy moves/captures 1–2 orthogonal/diagonal.
- Green promotes on 9–10.
- Blue promotes on 4–5.
- Promotion occurs after the move.
- Assassin moves at most 4.
- Assassin demotes when crossing boundary.
- Demotion stops on first crossed square.
- Demotion capture works against enemy.
- Demotion onto friendly/inaccessible square is illegal.
- Assassin cannot enter inner circle, land on gate, or capture Bearer on gate.

## Horse

- Legal knight destinations are correct.
- Horse jumps blockers.
- Cannot land on wall, gate, inner circle, friendly piece, reserved square, or off-board.
- Captures ordinary pieces and routes special pieces.

## Guard

- Moves 1 orthogonally.
- Captures 1 diagonally.
- Cannot move diagonally to empty.
- Cannot capture orthogonally.

## Spear

- Normal move/capture is 1 horizontal or 1 diagonal.
- Cannot normally move straight forward/backward.
- Flank Charge only from A/B/L/M.
- Charge is forward only and at most 4.
- Blocking pieces stop charge.
- Cannot move backward while on flank.
- Backward options return after leaving flank.

## Undo

Verify undo restores:

- Walls
- Removed Engineers
- Promotion/demotion
- Captured pieces
- Routed pieces
- Flag/countdown
- Winner
- History

# Manual acceptance scenarios

## Open one wall

1. Move Green Engineer to A6–A8.
2. East Wall disappears.
3. Green Engineer returns to G3.
4. West Wall remains.

## Open second wall

1. Open one wall.
2. Open the other.
3. Both Engineers disappear permanently.

## Flag run

1. Open a side gate.
2. Enter Sanctuary.
3. Pick up flag at G7.
4. Movement drops to 1.
5. Exit through E7 or I7 within 3 carrier turns.
6. Return home.
7. Victory appears.

## Timeout

1. Pick up flag.
2. Stay inside for three personal turns.
3. Flag returns to G7.
4. Bearer returns home.

## Promotion/demotion

1. Move Green Spy to row 9.
2. It becomes Assassin at end of move.
3. It moves up to 4 within rows 9–13.
4. Cross to row 8.
5. It stops at first crossed square and becomes Spy.

## Routing

- Capture Engineer: it returns to start.
- Capture unladen Bearer: it returns home.
- Capture carrier: it returns home and flag resets.

# README

Include:

- Game description
- Installation
- Running locally
- Tests
- Production build
- Project/module overview
- Rules summary
- Implementation assumptions
- Future ideas:
  - AI
  - online multiplayer
  - replay export/import
  - alternate boards
  - rule toggles
  - sound/animation

# Explicit implementation assumptions

These choices are required for this build:

1. Green moves first.
2. Engineers cannot attack.
3. Flag pickup ends movement.
4. Timeout returns both flag and carrier.
5. G1, G3, G11, and G13 are reserved.
6. Spear long attack is a charge capture.
7. Bearers cannot attack each other if either is inside.
8. Non-Bearers cannot capture a Bearer on a gate because they cannot occupy gates.
9. North/South are entrance-only even for an unladen Bearer.
10. Cannon effects trigger only when Engineer ends a move in the zone.
11. An already-open wall cannot be triggered again.
12. The second wall opening removes both Engineers immediately.

Centralize these choices in constants or isolated rule functions.

# Known edge case to expose cleanly in code

Two unladen Flag Bearers may coexist in the inner circle and cannot attack one another there. This can create blocking positions, including potential occupation of G7.

Implement the literal current rules without inventing an additional anti-blocking rule, but:

- Keep inner-circle Bearer legality in one isolated function.
- Add a code comment and README note that a future rule may limit unladen Bearer occupancy or introduce a Sanctuary stalling rule.
- Do not silently add a new rule.

# Completion requirements

Before finishing:

- Run all tests.
- Run the production build.
- Fix TypeScript errors.
- Fix browser console errors.
- Ensure illegal moves cannot be forced through UI manipulation.
- Keep state serializable.
- Ensure undo is reliable.
- Avoid duplicated rule logic.
- Comment the unusual Cannon, promotion/demotion, routing, and countdown code.
- Leave no TODOs for core gameplay.

At completion, report:

- Files created
- Commands to run
- Test results
- Build results
- Implementation assumptions used
