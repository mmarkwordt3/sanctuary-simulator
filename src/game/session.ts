// A thin, DOM-free wrapper around the reducer that manages the undo stack.
// Because every state produced by `applyMove` is an independent, fully
// serializable snapshot, undo is simply "discard the latest snapshot".

import type { GameState, Move } from "./types.ts";
import { createInitialState } from "./setup.ts";
import { applyMove } from "./reducer.ts";

export class GameSession {
  private stack: GameState[];

  constructor(initial: GameState = createInitialState()) {
    this.stack = [initial];
  }

  /** The current (latest) state. */
  get state(): GameState {
    return this.stack[this.stack.length - 1];
  }

  /**
   * Attempt a move. Returns true if it was legal and applied, false if the move
   * was rejected (the reducer returns the same reference for illegal moves).
   */
  move(m: Move): boolean {
    const before = this.state;
    const after = applyMove(before, m);
    if (after === before) return false;
    this.stack.push(after);
    return true;
  }

  canUndo(): boolean {
    return this.stack.length > 1;
  }

  /** Undo the last applied move, restoring the complete previous state. */
  undo(): boolean {
    if (!this.canUndo()) return false;
    this.stack.pop();
    return true;
  }

  /** Restart the current game to the opening position (clears undo history). */
  restart(): void {
    this.stack = [createInitialState()];
  }

  /** Start a brand-new game (identical to restart with no configurable options). */
  newGame(): void {
    this.stack = [createInitialState()];
  }

  /** Serialize the entire session (state stack) to a JSON string. */
  serialize(): string {
    return JSON.stringify(this.stack);
  }

  /** Restore a session previously produced by `serialize`. */
  static deserialize(json: string): GameSession {
    const stack = JSON.parse(json) as GameState[];
    const session = new GameSession(stack[0]);
    session.stack = stack;
    return session;
  }
}
