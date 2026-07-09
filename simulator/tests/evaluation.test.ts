import { describe, expect, it } from "vitest";
import { toCoord } from "../../src/game/coords.ts";
import type { GameState, Piece, PieceType, Player } from "../../src/game/types.ts";
import { diagnosticBreakdown, positionKey, selectMoveDetailed } from "../agents.ts";

let id = 0;
function piece(type: PieceType, player: Player, at: string): Piece {
  const c = toCoord(at);
  return { id: `${player}-${type}-${id++}`, type, player, col: c.col, row: c.row };
}

function state(pieces: Piece[], overrides: Partial<GameState> = {}): GameState {
  return {
    pieces,
    current: "green",
    walls: { west: true, east: true },
    flag: { square: toCoord("G7"), carrierId: null },
    extractionTurnsRemaining: null,
    forcedGateDeparture: false,
    unladenSanctuary: null,
    lastMove: null,
    engineersRemoved: false,
    winner: null,
    history: ["fixture"],
    ...overrides,
  };
}

function score(s: GameState): number {
  return diagnosticBreakdown(s, "green").total;
}

describe("objective-aware simulator evaluation", () => {
  it("prefers an open side gate over an otherwise equivalent closed-gate position", () => {
    const closed = state([piece("engineer", "green", "G3"), piece("flagBearer", "green", "G1")]);
    const open = state(closed.pieces, { walls: { west: false, east: true } });
    expect(score(open)).toBeGreaterThan(score(closed));
  });

  it("prefers a Flag Bearer closer to entering the Sanctuary", () => {
    const far = state([piece("flagBearer", "green", "G1")], { walls: { west: false, east: true } });
    const near = state([piece("flagBearer", "green", "D7")], { walls: { west: false, east: true } });
    expect(score(near)).toBeGreaterThan(score(far));
  });

  it("prefers a Flag Bearer on G7 carrying the flag over the same position without pickup", () => {
    const bearer = piece("flagBearer", "green", "G7");
    const uncarried = state([bearer], { walls: { west: false, east: true }, flag: { square: toCoord("G7"), carrierId: null } });
    const carried = state([{ ...bearer }], { walls: { west: false, east: true }, flag: { square: null, carrierId: bearer.id }, extractionTurnsRemaining: 3 });
    expect(score(carried)).toBeGreaterThan(score(uncarried));
  });

  it("prefers a carrier closer to E7 or I7 during extraction", () => {
    const farCarrier = piece("flagBearer", "green", "G7");
    const nearCarrier = piece("flagBearer", "green", "F7");
    const far = state([farCarrier], { walls: { west: false, east: true }, flag: { square: null, carrierId: farCarrier.id }, extractionTurnsRemaining: 3 });
    const near = state([nearCarrier], { walls: { west: false, east: true }, flag: { square: null, carrierId: nearCarrier.id }, extractionTurnsRemaining: 3 });
    expect(score(near)).toBeGreaterThan(score(far));
  });

  it("prefers more extraction turns remaining when distance is equal", () => {
    const carrier = piece("flagBearer", "green", "F7");
    const one = state([carrier], { walls: { west: false, east: true }, flag: { square: null, carrierId: carrier.id }, extractionTurnsRemaining: 1 });
    const three = state([{ ...carrier }], { walls: { west: false, east: true }, flag: { square: null, carrierId: carrier.id }, extractionTurnsRemaining: 3 });
    expect(score(three)).toBeGreaterThan(score(one));
  });

  it("prefers successful side-gate arrival over remaining inside the Sanctuary", () => {
    const insideCarrier = piece("flagBearer", "green", "F7");
    const gateCarrier = piece("flagBearer", "green", "E7");
    const inside = state([insideCarrier], { walls: { west: false, east: true }, flag: { square: null, carrierId: insideCarrier.id }, extractionTurnsRemaining: 1 });
    const gate = state([gateCarrier], { walls: { west: false, east: true }, flag: { square: null, carrierId: gateCarrier.id }, extractionTurnsRemaining: null, forcedGateDeparture: true });
    expect(score(gate)).toBeGreaterThan(score(inside));
  });

  it("prefers successful forced departure over remaining on the gate", () => {
    const gateCarrier = piece("flagBearer", "green", "E7");
    const departedCarrier = piece("flagBearer", "green", "D7");
    const gate = state([gateCarrier], { walls: { west: false, east: true }, flag: { square: null, carrierId: gateCarrier.id }, forcedGateDeparture: true });
    const departed = state([departedCarrier], { walls: { west: false, east: true }, flag: { square: null, carrierId: departedCarrier.id } });
    expect(score(departed)).toBeGreaterThan(score(gate));
  });

  it("prefers a post-extraction carrier closer to home", () => {
    const farCarrier = piece("flagBearer", "green", "D7");
    const nearCarrier = piece("flagBearer", "green", "G2");
    const far = state([farCarrier], { walls: { west: false, east: true }, flag: { square: null, carrierId: farCarrier.id } });
    const near = state([nearCarrier], { walls: { west: false, east: true }, flag: { square: null, carrierId: nearCarrier.id } });
    expect(score(near)).toBeGreaterThan(score(far));
  });

  it("scores a winning state over every non-terminal state", () => {
    const carrier = piece("flagBearer", "green", "G1");
    const nonTerminal = state([carrier], { walls: { west: false, east: false }, flag: { square: null, carrierId: carrier.id } });
    const win = state([{ ...carrier }], { walls: { west: false, east: false }, flag: { square: null, carrierId: carrier.id }, winner: "green" });
    expect(score(win)).toBeGreaterThan(score(nonTerminal));
  });

  it("penalizes an otherwise equivalent repeated position", () => {
    const s = state([piece("guard", "green", "D3"), piece("guard", "blue", "D11")]);
    const recent = new Map([[positionKey(s), 1]]);
    expect(diagnosticBreakdown(s, "green", { recentPositions: recent }).total).toBeLessThan(diagnosticBreakdown(s, "green").total);
  });

  it("keeps deterministic and diverse selections legal while recording score loss", () => {
    const s = state([piece("guard", "green", "D3"), piece("guard", "blue", "D11")]);
    const deterministic = selectMoveDetailed(s, "heuristic-deterministic", { seed: 1 });
    const diverse = selectMoveDetailed(s, "heuristic-diverse", { seed: 2, diversity: 2 });
    expect(deterministic.move).not.toBeNull();
    expect(diverse.move).not.toBeNull();
    expect(diverse.legalMoveCount).toBeGreaterThan(0);
    expect(diverse.scoreLoss).toBeGreaterThanOrEqual(0);
  });
});
