import { describe, expect, it } from "vitest";
import { toCoord } from "../../src/game/coords.ts";
import type { GameState, Piece, PieceType, Player } from "../../src/game/types.ts";
import { diagnosticBreakdown, gateContainmentDiagnostic, positionKey, selectMoveDetailed } from "../agents.ts";
import { mirrorState } from "../mirror.ts";

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

function containmentFixture(at: string, overrides: Partial<GameState> = {}): GameState {
  const blue = piece("flagBearer", "blue", at);
  return state([
    piece("engineer", "green", "M7"),
    piece("guard", "green", "J7"),
    blue,
    piece("flagBearer", "green", "G1"),
  ], { current: "green", flag: { square: null, carrierId: blue.id }, extractionTurnsRemaining: 3, ...overrides });
}

describe("carrier containment evaluation", () => {
  it("penalizes opening a side gate for a Blue carrier on G9 with both gates closed", () => {
    const closed = containmentFixture("G9");
    const open = containmentFixture("G9", { walls: { west: true, east: false } });
    expect(diagnosticBreakdown(closed, "green").carrierContainment).toBeGreaterThan(diagnosticBreakdown(open, "green").carrierContainment);
  });

  it("penalizes opening a side gate for a Blue carrier on G7 carrying the flag", () => {
    const closed = containmentFixture("G7");
    const open = containmentFixture("G7", { walls: { west: false, east: true } });
    expect(score(closed)).toBeGreaterThan(score(open));
  });

  it("recognizes danger when exactly one gate is open", () => {
    const oneOpen = containmentFixture("H7", { walls: { west: false, east: true }, extractionTurnsRemaining: 2 });
    expect(diagnosticBreakdown(oneOpen, "green").carrierContainment).toBeLessThan(diagnosticBreakdown(containmentFixture("H7"), "green").carrierContainment);
  });

  it("chooses defensive development over an immediate harmful gate opening", () => {
    const s = containmentFixture("G7");
    const selected = selectMoveDetailed(s, "heuristic-deterministic", { seed: 4 });
    const moving = s.pieces.find((p) => p.id === selected.move?.pieceId)!;
    expect(moving.type === "engineer" && selected.move?.to.col === toCoord("M7").col).toBe(false);
  });

  it("rewards one move remaining before extraction failure", () => {
    const one = containmentFixture("G7", { extractionTurnsRemaining: 1 });
    const three = containmentFixture("G7", { extractionTurnsRemaining: 3 });
    expect(diagnosticBreakdown(one, "green").carrierContainment).toBeGreaterThan(diagnosticBreakdown(three, "green").carrierContainment);
  });

  it("diagnoses a gate opening that gives Blue an immediate escape", () => {
    const before = containmentFixture("H7");
    const after = containmentFixture("H7", { walls: { west: true, east: false } });
    const d = gateContainmentDiagnostic(before, after, "green")!;
    expect(d.gateOpenedWhileEnemyFlagBearerInside).toBe(true);
    expect(d.reducedEstimatedShortestRouteToSafety).toBe(true);
    expect(d.containmentDelta).toBeLessThan(0);
  });

  it("does not excessively penalize a gate opening that does not improve escape distance", () => {
    const far = state([piece("engineer", "green", "M7"), piece("flagBearer", "blue", "G13")], { current: "green" });
    const open = state(far.pieces, { current: "green", walls: { west: false, east: true } });
    expect(Math.abs(diagnosticBreakdown(open, "green").carrierContainment - diagnosticBreakdown(far, "green").carrierContainment)).toBeLessThan(1000);
  });

  it("mirrored carrier danger produces the same containment evaluation", () => {
    const s = containmentFixture("F7", { walls: { west: false, east: true } });
    expect(diagnosticBreakdown(s, "green").carrierContainment).toBe(diagnosticBreakdown(mirrorState(s), "green").carrierContainment);
  });

  it("evaluates alternative carrier routes without relying on G9 to G7", () => {
    const alt = containmentFixture("H6", { extractionTurnsRemaining: 2 });
    const open = containmentFixture("H6", { walls: { west: true, east: false }, extractionTurnsRemaining: 2 });
    expect(diagnosticBreakdown(alt, "green").carrierContainment).toBeGreaterThan(diagnosticBreakdown(open, "green").carrierContainment);
  });
});
