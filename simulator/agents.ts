import { EAST_CANNON, GATES, WEST_CANNON } from "../src/game/constants.ts";
import { fromCoord, toCoord } from "../src/game/coords.ts";
import { legalMovesForPiece } from "../src/game/movement.ts";
import { applyMove } from "../src/game/reducer.ts";
import { isInnerCircle } from "../src/game/terrain.ts";
import { canonicalMoveLabel, mirrorLabel, mirrorInvariantMoveKey, mirrorState, mirrorMove, moveLabel } from "./mirror.ts";
import type { Coord, GameState, Move, Piece, Player } from "../src/game/types.ts";

export type AgentName =
  | "random"
  | "legacy-heuristic"
  | "heuristic"
  | "search"
  | "heuristic-deterministic"
  | "heuristic-diverse"
  | "search-deterministic"
  | "search-diverse"
  | "search-alpha-beta-deterministic"
  | "search-alpha-beta-diverse";

export interface AgentContext {
  seed: number;
  recentPositions?: ReadonlyMap<string, number>;
  previousMove?: MoveRecord | null;
  searchDepth?: number;
  diversity?: DiversityLevel;
  timeLimitMs?: number;
}

export type DiversityLevel = 0 | 1 | 2 | 3;

export interface MoveRecord {
  pieceId: string;
  from: Coord;
  to: Coord;
}

export interface EvaluationBreakdown {
  terminal: number;
  material: number;
  gateProgress: number;
  sanctuaryProgress: number;
  flagPossession: number;
  extractionProgress: number;
  extractionUrgency: number;
  forcedDeparture: number;
  homewardCarrierProgress: number;
  carrierSafety: number;
  carrierContainment: number;
  mobility: number;
  repetitionPenalty: number;
  total: number;
}

export interface ScoredMove {
  move: Move;
  score: number;
  breakdown: EvaluationBreakdown;
  principalVariation: Move[];
  tie: string;
}

export interface SearchDiagnostics {
  requestedDepth: number;
  completedDepth: number;
  nodesSearched: number;
  leafEvaluations: number;
  alphaBetaCutoffs: number;
  transpositionTableHits: number;
  elapsedMs: number;
  timedOut: boolean;
  principalVariation: Move[];
  scoreByCompletedDepth: Record<number, number>;
  selectedMoveChangedByDepth: boolean;
}

export interface SelectionResult {
  move: Move | null;
  legalMoveCount: number;
  selectedScore: number | null;
  bestScore: number | null;
  scoreLoss: number;
  diversityAffectedChoice: boolean;
  candidates: ScoredMove[];
  principalVariation: Move[];
  diagnostics?: SearchDiagnostics;
}

export const EVALUATION_WEIGHTS = {
  terminalWin: 1_000_000,
  materialStep: 18,
  firstOpenGate: 900,
  bothOpenGates: 250,
  engineerCannonProgress: 55,
  engineerProtection: 12,
  bearerEntranceProgress: 70,
  sanctuaryEntry: 350,
  insideFlagProgress: 120,
  extractionRouteViability: 140,
  flagPickup: 2_500,
  extractionDistance: 360,
  extractionTurn: 180,
  extractionImpossible: -2_200,
  nonCarrierExtractionMove: -320,
  forcedDeparture: 3_200,
  gateArrival: 2_800,
  postExtraction: 3_000,
  homeDistance: 320,
  carrierProtection: 28,
  enemyCarrierDanger: 1_450,
  enemyCarrierFlagThreat: 1_250,
  closedGateContainment: 700,
  openGateEscapePenalty: 1_650,
  carrierExitDistance: 420,
  carrierExtractionFailurePressure: 520,
  controlledExit: 260,
  routerNearCarrier: 170,
  carrierHomeApproach: 220,
  mobilityStep: 4,
  repeatedPosition: -650,
  immediateReversal: -450,
} as const;

const SIDE_GATES = [toCoord(GATES.west), toCoord(GATES.east)];
const SANCTUARY_ENTRANCES = [toCoord(GATES.north), toCoord(GATES.west), toCoord(GATES.east), toCoord(GATES.south)];
const FLAG_HOME = toCoord("G7");

function chebyshev(a: Coord, b: Coord): number {
  return Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
}


function victorySquare(player: Player): Coord {
  return toCoord(player === "green" ? "G1" : "G13");
}

function openSideGates(state: GameState): Coord[] {
  const out: Coord[] = [];
  if (!state.walls.west) out.push(toCoord(GATES.west));
  if (!state.walls.east) out.push(toCoord(GATES.east));
  return out;
}

function cannonTargetsForClosedGates(state: GameState): Coord[] {
  const targets: Coord[] = [];
  if (state.walls.east) targets.push(...WEST_CANNON.map(toCoord));
  if (state.walls.west) targets.push(...EAST_CANNON.map(toCoord));
  return targets;
}

function minDistance(c: Coord, targets: Coord[]): number {
  if (targets.length === 0) return 0;
  return Math.min(...targets.map((t) => chebyshev(c, t)));
}


function flagBearerFor(state: GameState, player: Player): Piece | undefined {
  return state.pieces.find((p) => p.player === player && p.type === "flagBearer");
}

function isCarryingFlag(state: GameState, piece: Piece | undefined): boolean {
  return !!piece && state.flag.carrierId === piece.id;
}

function canTakeFlagImmediately(state: GameState, bearer: Piece | undefined): boolean {
  if (!bearer || state.flag.carrierId || !state.flag.square) return false;
  return chebyshev(bearer, state.flag.square) <= 1 && (isInnerCircle(bearer) || SANCTUARY_ENTRANCES.some((g) => chebyshev(bearer, g) <= 1));
}

function nearestExitDistance(state: GameState, bearer: Piece | undefined, onlyOpen = true): number {
  if (!bearer) return 99;
  const exits = onlyOpen ? openSideGates(state) : SIDE_GATES;
  if (!exits.length) return 99;
  return minDistance(bearer, exits);
}

function likelyExitControlled(state: GameState, defender: Player): number {
  const exits = openSideGates(state);
  return exits.reduce((n, gate) => n + (state.pieces.some((p) => p.player === defender && chebyshev(p, gate) <= 2) ? 1 : 0), 0);
}

function carrierContainmentScore(state: GameState, perspective: Player): number {
  const enemy: Player = perspective === "green" ? "blue" : "green";
  const carrier = flagBearerFor(state, enemy);
  if (!carrier) return 0;
  const inside = isInnerCircle(carrier) || SANCTUARY_ENTRANCES.some((g) => g.col === carrier.col && g.row === carrier.row);
  const carrying = isCarryingFlag(state, carrier);
  const pickupThreat = canTakeFlagImmediately(state, carrier);
  if (!inside && !carrying && !pickupThreat) return 0;

  const open = openSideGates(state).length;
  const openDistance = nearestExitDistance(state, carrier, true);
  const anyGateDistance = nearestExitDistance(state, carrier, false);
  const defendersNear = state.pieces.filter((p) => p.player === perspective && chebyshev(p, carrier) <= 2).length;
  const timer = state.extractionTurnsRemaining ?? (carrying ? Math.max(0, 4 - anyGateDistance) : 0);
  let score = 0;

  score += (2 - open) * EVALUATION_WEIGHTS.closedGateContainment;
  if (inside || pickupThreat) score += EVALUATION_WEIGHTS.enemyCarrierDanger;
  if (carrying || pickupThreat) score += EVALUATION_WEIGHTS.enemyCarrierFlagThreat;
  if (open > 0) score -= EVALUATION_WEIGHTS.openGateEscapePenalty * open;
  if (openDistance < 99) score += openDistance * EVALUATION_WEIGHTS.carrierExitDistance;
  score += (4 - Math.min(4, timer)) * EVALUATION_WEIGHTS.carrierExtractionFailurePressure;
  score += likelyExitControlled(state, perspective) * EVALUATION_WEIGHTS.controlledExit;
  score += defendersNear * EVALUATION_WEIGHTS.routerNearCarrier;
  if (carrying && !inside && state.extractionTurnsRemaining === null) score -= (12 - chebyshev(carrier, victorySquare(enemy))) * EVALUATION_WEIGHTS.carrierHomeApproach;
  return score;
}

export interface GateContainmentDiagnostic {
  gateOpenedWhileEnemyFlagBearerInside: boolean;
  enemyFlagBearerCarryingFlag: boolean;
  immediateLegalEscapeRouteCreated: boolean;
  reducedEstimatedShortestRouteToSafety: boolean;
  containmentDelta: number;
  beforeContainmentScore: number;
  afterContainmentScore: number;
  remainingSanctuaryTimer: number | null;
  estimatedCarrierExitDistanceBefore: number;
  estimatedCarrierExitDistanceAfter: number;
}

export function gateContainmentDiagnostic(before: GameState, after: GameState, player: Player): GateContainmentDiagnostic | null {
  const enemy: Player = player === "green" ? "blue" : "green";
  const enemyBearer = flagBearerFor(before, enemy);
  const openedGate = after.walls.west !== before.walls.west || after.walls.east !== before.walls.east;
  if (!openedGate || !enemyBearer) return null;
  const afterBearer = flagBearerFor(after, enemy);
  const beforeDistance = nearestExitDistance(before, enemyBearer, true);
  const afterDistance = nearestExitDistance(after, afterBearer, true);
  const beforeScore = carrierContainmentScore(before, player);
  const afterScore = carrierContainmentScore(after, player);
  return {
    gateOpenedWhileEnemyFlagBearerInside: isInnerCircle(enemyBearer) || SANCTUARY_ENTRANCES.some((g) => g.col === enemyBearer.col && g.row === enemyBearer.row),
    enemyFlagBearerCarryingFlag: isCarryingFlag(before, enemyBearer),
    immediateLegalEscapeRouteCreated: beforeDistance >= 99 && afterDistance <= 1,
    reducedEstimatedShortestRouteToSafety: afterDistance < beforeDistance,
    containmentDelta: afterScore - beforeScore,
    beforeContainmentScore: beforeScore,
    afterContainmentScore: afterScore,
    remainingSanctuaryTimer: before.extractionTurnsRemaining,
    estimatedCarrierExitDistanceBefore: beforeDistance,
    estimatedCarrierExitDistanceAfter: afterDistance,
  };
}

function allLegalMoves(state: GameState): Move[] {
  return state.pieces
    .filter((p) => p.player === state.current)
    .flatMap((p) => legalMovesForPiece(state, p).map((m) => ({ pieceId: p.id, to: m.to })));
}

export function legalMovesForState(state: GameState): Move[] {
  return allLegalMoves(state);
}

function materialValue(piece: Piece): number {
  switch (piece.type) {
    case "flagBearer": return 0;
    case "engineer": return 4;
    case "horse": return 3;
    case "assassin": return 3;
    case "spy": return 2;
    case "guard": return 2;
    case "spear": return 2;
  }
}

function signed(player: Player, owner: Player, value: number): number {
  return owner === player ? value : -value;
}

function pieceAt(state: GameState, c: Coord): Piece | undefined {
  return state.pieces.find((p) => p.col === c.col && p.row === c.row);
}

export function positionKey(state: GameState): string {
  return JSON.stringify({
    current: state.current,
    pieces: state.pieces.map((p) => [p.id, p.type, p.player, p.col, p.row]).sort(),
    walls: state.walls,
    flag: state.flag,
    extractionTurnsRemaining: state.extractionTurnsRemaining,
    forcedGateDeparture: state.forcedGateDeparture,
    winner: state.winner,
  });
}

function isImmediateReversal(previous: MoveRecord | null | undefined, move: Move, state: GameState): boolean {
  if (!previous || previous.pieceId !== move.pieceId) return false;
  const piece = state.pieces.find((p) => p.id === move.pieceId);
  if (!piece) return false;
  return previous.from.col === move.to.col && previous.from.row === move.to.row &&
    previous.to.col === piece.col && previous.to.row === piece.row;
}

export function evaluateState(
  state: GameState,
  player: Player,
  context: Pick<AgentContext, "recentPositions"> = {},
): EvaluationBreakdown {
  const b: EvaluationBreakdown = {
    terminal: 0,
    material: 0,
    gateProgress: 0,
    sanctuaryProgress: 0,
    flagPossession: 0,
    extractionProgress: 0,
    extractionUrgency: 0,
    forcedDeparture: 0,
    homewardCarrierProgress: 0,
    carrierSafety: 0,
    carrierContainment: 0,
    mobility: 0,
    repetitionPenalty: 0,
    total: 0,
  };

  if (state.winner) {
    b.terminal = state.winner === player ? EVALUATION_WEIGHTS.terminalWin : -EVALUATION_WEIGHTS.terminalWin;
  }

  for (const piece of state.pieces) {
    b.material += signed(player, piece.player, materialValue(piece) * EVALUATION_WEIGHTS.materialStep);
  }

  const opened = openSideGates(state);
  if (opened.length > 0) b.gateProgress += EVALUATION_WEIGHTS.firstOpenGate;
  if (opened.length > 1) b.gateProgress += EVALUATION_WEIGHTS.bothOpenGates;

  const cannonTargets = cannonTargetsForClosedGates(state);
  for (const engineer of state.pieces.filter((p) => p.type === "engineer")) {
    if (cannonTargets.length) {
      const progress = (12 - minDistance(engineer, cannonTargets)) * EVALUATION_WEIGHTS.engineerCannonProgress;
      b.gateProgress += signed(player, engineer.player, progress);
    }
    const guards = state.pieces.filter((p) => p.player === engineer.player && p.id !== engineer.id && chebyshev(p, engineer) <= 2).length;
    b.gateProgress += signed(player, engineer.player, guards * EVALUATION_WEIGHTS.engineerProtection);
  }

  const carrier = state.flag.carrierId ? state.pieces.find((p) => p.id === state.flag.carrierId) : undefined;
  if (carrier) {
    b.flagPossession += signed(player, carrier.player, EVALUATION_WEIGHTS.flagPickup);

    if (state.forcedGateDeparture) {
      b.forcedDeparture += signed(player, carrier.player, EVALUATION_WEIGHTS.forcedDeparture);
    } else if (state.extractionTurnsRemaining !== null) {
      const exits = opened.length ? opened : SIDE_GATES;
      const d = minDistance(carrier, exits);
      b.extractionProgress += signed(player, carrier.player, (8 - d) * EVALUATION_WEIGHTS.extractionDistance);
      b.extractionUrgency += signed(player, carrier.player, state.extractionTurnsRemaining * EVALUATION_WEIGHTS.extractionTurn);
      if (d > state.extractionTurnsRemaining) {
        b.extractionUrgency += signed(player, carrier.player, EVALUATION_WEIGHTS.extractionImpossible);
      }
      if (exits.some((g) => g.col === carrier.col && g.row === carrier.row)) {
        b.extractionProgress += signed(player, carrier.player, EVALUATION_WEIGHTS.gateArrival);
      }
    } else {
      const d = chebyshev(carrier, victorySquare(carrier.player));
      b.homewardCarrierProgress += signed(
        player,
        carrier.player,
        EVALUATION_WEIGHTS.postExtraction + (12 - d) * EVALUATION_WEIGHTS.homeDistance,
      );
    }

    const friendlyNear = state.pieces.filter((p) => p.player === carrier.player && p.id !== carrier.id && chebyshev(p, carrier) <= 2).length;
    const enemyNear = state.pieces.filter((p) => p.player !== carrier.player && chebyshev(p, carrier) <= 2).length;
    b.carrierSafety += signed(player, carrier.player, (friendlyNear - enemyNear) * EVALUATION_WEIGHTS.carrierProtection);
  } else if (opened.length > 0) {
    for (const bearer of state.pieces.filter((p) => p.type === "flagBearer")) {
      const entranceDistance = minDistance(bearer, SANCTUARY_ENTRANCES.filter((g) => opened.some((o) => o.col === g.col && o.row === g.row) || g.col === 6));
      b.sanctuaryProgress += signed(player, bearer.player, (12 - entranceDistance) * EVALUATION_WEIGHTS.bearerEntranceProgress);
      if (isInnerCircle(bearer)) {
        b.sanctuaryProgress += signed(player, bearer.player, EVALUATION_WEIGHTS.sanctuaryEntry + (4 - chebyshev(bearer, FLAG_HOME)) * EVALUATION_WEIGHTS.insideFlagProgress);
      }
    }
    const flagToExit = opened.length ? Math.min(...opened.map((g) => chebyshev(FLAG_HOME, g))) : 9;
    b.sanctuaryProgress += (9 - flagToExit) * EVALUATION_WEIGHTS.extractionRouteViability;
  }

  if (state.extractionTurnsRemaining !== null && carrier && state.current === carrier.player) {
    b.extractionUrgency += signed(player, carrier.player, EVALUATION_WEIGHTS.nonCarrierExtractionMove);
  }

  b.carrierContainment = carrierContainmentScore(state, player);

  const currentMobility = allLegalMoves(state).length;
  b.mobility = signed(player, state.current, currentMobility * EVALUATION_WEIGHTS.mobilityStep);

  const repeats = context.recentPositions?.get(positionKey(state)) ?? 0;
  b.repetitionPenalty = repeats * EVALUATION_WEIGHTS.repeatedPosition;

  b.total = Object.entries(b).filter(([k]) => k !== "total").reduce((sum, [, value]) => sum + value, 0);
  const cap = EVALUATION_WEIGHTS.terminalWin - 1;
  if (!state.winner) b.total = Math.max(-cap, Math.min(cap, b.total));
  return b;
}

function moveTieKey(state: GameState, move: Move, seed: number): string {
  const label = moveLabel(state, move);
  const mirrored = mirrorLabel(label);
  const orientation = label <= mirrored ? 0 : 1;
  const canonical = canonicalMoveLabel(state, move);
  const stateOrientation = positionKey(state) <= positionKey(mirrorState(state)) ? 0 : 1;
  const preferred = (((seed * 1103515245 + hashString(canonical)) >>> 0) & 1) ^ stateOrientation;
  return `${mirrorInvariantMoveKey(state, move)}:${orientation === preferred ? 0 : 1}:${canonical}`;
}

function hashString(s: string): number {
  let hash = 2166136261;
  for (let i = 0; i < s.length; i++) hash = Math.imul(hash ^ s.charCodeAt(i), 16777619);
  return hash >>> 0;
}

const DIVERSITY_MARGIN: Record<DiversityLevel, number> = {
  0: 0,
  1: 25,
  2: 100,
  3: 250,
};

function normalizedAgent(agent: AgentName): AgentName {
  if (agent === "heuristic") return "heuristic-deterministic";
  if (agent === "search") return "search-deterministic";
  return agent;
}

function isSearchAgent(agent: AgentName): boolean {
  return agent === "search" || agent === "search-deterministic" || agent === "search-diverse" || agent === "search-alpha-beta-deterministic" || agent === "search-alpha-beta-diverse";
}

function isAlphaBetaAgent(agent: AgentName): boolean {
  return agent === "search-alpha-beta-deterministic" || agent === "search-alpha-beta-diverse";
}

function isDiverseAgent(agent: AgentName): boolean {
  return agent === "heuristic-diverse" || agent === "search-diverse" || agent === "search-alpha-beta-diverse";
}

function evaluateMove(
  state: GameState,
  move: Move,
  context: AgentContext,
  depth: number,
): ScoredMove | null {
  const next = applyMove(state, move);
  if (next === state) return null;
  const principalVariation = [move];
  const breakdown = evaluateState(next, state.current, context);
  let score = depth > 1
    ? searchValueAfterMove(next, depth - 1, state.current, context, [positionKey(state)], principalVariation)
    : breakdown.total;
  if (isImmediateReversal(context.previousMove, move, state)) score += EVALUATION_WEIGHTS.immediateReversal;
  const repeatCount = context.recentPositions?.get(positionKey(next)) ?? 0;
  if (repeatCount) score += repeatCount * EVALUATION_WEIGHTS.repeatedPosition;
  return { move, score, breakdown, principalVariation, tie: moveTieKey(state, move, context.seed) };
}

function rankedScoredMoves(
  state: GameState,
  moves: Move[],
  context: AgentContext,
  depth: number,
): ScoredMove[] {
  const before = evaluateState(state, state.current, context).total;
  return moves
    .map((move) => evaluateMove(state, move, context, depth))
    .filter((m): m is ScoredMove => m !== null)
    .sort((a, b) => {
      const objectiveDelta = b.breakdown.total - before - (a.breakdown.total - before);
      return b.score - a.score || objectiveDelta || a.tie.localeCompare(b.tie);
    });
}

function staticRankedMoves(state: GameState, moves: Move[], player: Player, context: AgentContext, limit: number): Move[] {
  return moves
    .map((move) => {
      const next = applyMove(state, move);
      return {
        move,
        score: next === state ? -Infinity : evaluateState(next, player, context).total,
        tie: moveTieKey(state, move, context.seed),
      };
    })
    .sort((a, b) => b.score - a.score || a.tie.localeCompare(b.tie))
    .slice(0, limit)
    .map((candidate) => candidate.move);
}

function terminalOrForcedOverride(state: GameState, scored: ScoredMove[]): ScoredMove | null {
  const winning = scored.find((candidate) => {
    const next = applyMove(state, candidate.move);
    return next !== state && next.winner === state.current;
  });
  if (winning) return winning;
  if (state.forcedGateDeparture) return scored[0] ?? null;
  return null;
}

function chooseScoredMove(
  state: GameState,
  scored: ScoredMove[],
  context: AgentContext,
  diverse: boolean,
  legalMoveCount = scored.length,
): SelectionResult {
  const best = scored[0] ?? null;
  if (!best) {
    return {
      move: null,
      legalMoveCount: 0,
      selectedScore: null,
      bestScore: null,
      scoreLoss: 0,
      diversityAffectedChoice: false,
      candidates: [],
      principalVariation: [],
    };
  }

  const override = terminalOrForcedOverride(state, scored);
  if (override) {
    return {
      move: override.move,
      legalMoveCount,
      selectedScore: override.score,
      bestScore: best.score,
      scoreLoss: best.score - override.score,
      diversityAffectedChoice: override.move !== best.move,
      candidates: scored,
      principalVariation: override.principalVariation,
    };
  }

  const diversity = diverse ? context.diversity ?? 1 : 0;
  const margin = DIVERSITY_MARGIN[diversity];
  const eligible = diversity === 0
    ? [best]
    : scored.filter((candidate) => best.score - candidate.score <= margin);
  const selected = eligible[(context.seed >>> 0) % eligible.length] ?? best;
  return {
    move: selected.move,
    legalMoveCount,
    selectedScore: selected.score,
    bestScore: best.score,
    scoreLoss: best.score - selected.score,
    diversityAffectedChoice: selected.move !== best.move,
    candidates: scored,
    principalVariation: selected.principalVariation,
  };
}

function searchValueAfterMove(
  state: GameState,
  depth: number,
  rootPlayer: Player,
  context: AgentContext,
  path: string[],
  principalVariation?: Move[],
): number {
  if (depth === 0 || state.winner) return evaluateState(state, rootPlayer, context).total;
  const key = positionKey(state);
  if (path.includes(key)) return evaluateState(state, rootPlayer, context).total + EVALUATION_WEIGHTS.repeatedPosition * 2;
  const moves = staticRankedMoves(state, allLegalMoves(state), state.current, context, 12);
  if (!moves.length) return evaluateState(state, rootPlayer, context).total;
  const opponent = state.current !== rootPlayer;
  let best = opponent ? Infinity : -Infinity;
  let bestMove: Move | null = null;
  for (const move of moves) {
    const next = applyMove(state, move);
    if (next === state) continue;
    const value = searchValueAfterMove(next, depth - 1, rootPlayer, context, [...path, key]);
    if ((opponent && value < best) || (!opponent && value > best)) {
      best = value;
      bestMove = move;
    }
  }
  if (bestMove && principalVariation) principalVariation.push(bestMove);
  return best;
}


type BoundType = "exact" | "lower" | "upper";
interface TranspositionEntry { score: number; searchedDepth: number; bound: BoundType; bestMove?: Move; pv: Move[]; }
interface AlphaBetaState { table: Map<string, TranspositionEntry>; diagnostics: SearchDiagnostics; start: number; limit: number; timedOut: boolean; previousPv: Move[]; }

function sameMove(a: Move | undefined | null, b: Move | undefined | null): boolean {
  return !!a && !!b && a.pieceId === b.pieceId && a.to.col === b.to.col && a.to.row === b.to.row;
}
function ttKey(state: GameState, depth: number, root: Player): string { return `${root}|${depth}|${positionKey(state)}`; }
function checkTimeout(s: AlphaBetaState): boolean { if (s.limit > 0 && performance.now() - s.start >= s.limit) { s.timedOut = true; return true; } return false; }
function moveCategory(state: GameState, move: Move): number {
  const piece = state.pieces.find((p) => p.id === move.pieceId);
  const occ = pieceAt(state, move.to);
  const next = applyMove(state, move);
  if (next !== state && next.winner === state.current) return 0;
  if (state.forcedGateDeparture) return 1;
  if (next !== state && !state.flag.carrierId && next.flag.carrierId) return 2;
  if (occ && occ.player !== state.current && (occ.id === state.flag.carrierId || piece?.id === state.flag.carrierId)) return 3;
  if (occ && occ.player !== state.current) return 4;
  if (next !== state && (next.walls.east !== state.walls.east || next.walls.west !== state.walls.west)) return 5;
  return 9;
}
function orderedAlphaBetaMoves(state: GameState, moves: Move[], root: Player, context: AgentContext, previousPvMove?: Move, ttMove?: Move): Move[] {
  return moves.map((move) => {
    const next = applyMove(state, move);
    return { move, cat: moveCategory(state, move), pv: sameMove(move, previousPvMove) ? 0 : 1, tt: sameMove(move, ttMove) ? 0 : 1, score: next === state ? -Infinity : evaluateState(next, root, context).total, tie: moveTieKey(state, move, context.seed) };
  }).sort((a,b) => a.cat-b.cat || a.pv-b.pv || a.tt-b.tt || b.score-a.score || a.tie.localeCompare(b.tie)).map(x=>x.move);
}

function alphaBetaValue(state: GameState, depth: number, root: Player, context: AgentContext, ab: AlphaBetaState, alpha: number, beta: number, path: string[]): { score: number; pv: Move[] } | null {
  if (checkTimeout(ab)) return null;
  ab.diagnostics.nodesSearched++;
  const pkey = positionKey(state);
  if (depth === 0 || state.winner || path.includes(pkey)) {
    ab.diagnostics.leafEvaluations++;
    const repeat = path.includes(pkey) ? EVALUATION_WEIGHTS.repeatedPosition * 2 : 0;
    return { score: evaluateState(state, root, context).total + repeat, pv: [] };
  }
  const originalAlpha = alpha, originalBeta = beta;
  const key = ttKey(state, depth, root);
  const cached = ab.table.get(key);
  if (cached && cached.searchedDepth >= depth) {
    ab.diagnostics.transpositionTableHits++;
    if (cached.bound === "exact") return { score: cached.score, pv: cached.pv };
    if (cached.bound === "lower") alpha = Math.max(alpha, cached.score);
    if (cached.bound === "upper") beta = Math.min(beta, cached.score);
    if (alpha >= beta) return { score: cached.score, pv: cached.pv };
  }
  const moves = orderedAlphaBetaMoves(state, staticRankedMoves(state, allLegalMoves(state), state.current, context, 12), root, context, ab.previousPv[ab.diagnostics.requestedDepth - depth], cached?.bestMove);
  if (!moves.length) { ab.diagnostics.leafEvaluations++; return { score: evaluateState(state, root, context).total, pv: [] }; }
  const maximizing = state.current === root;
  let best = maximizing ? -Infinity : Infinity;
  let bestMove: Move | undefined;
  let bestPv: Move[] = [];
  for (const move of moves) {
    const next = applyMove(state, move);
    if (next === state) continue;
    const child = alphaBetaValue(next, depth - 1, root, context, ab, alpha, beta, [...path, pkey]);
    if (!child) return null;
    if ((maximizing && child.score > best) || (!maximizing && child.score < best) || (child.score === best && (!bestMove || moveTieKey(state, move, context.seed).localeCompare(moveTieKey(state, bestMove, context.seed)) < 0))) {
      best = child.score; bestMove = move; bestPv = [move, ...child.pv];
    }
    if (maximizing) alpha = Math.max(alpha, best); else beta = Math.min(beta, best);
    if (alpha >= beta) { ab.diagnostics.alphaBetaCutoffs++; break; }
  }
  const bound: BoundType = best <= originalAlpha ? "upper" : best >= originalBeta ? "lower" : "exact";
  ab.table.set(key, { score: best, searchedDepth: depth, bound, bestMove, pv: bestPv });
  return { score: best, pv: bestPv };
}

function alphaBetaSelection(state: GameState, context: AgentContext, requestedDepth: number, diverse: boolean, canonicalize = true): SelectionResult {
  if (canonicalize && positionKey(state) > positionKey(mirrorState(state))) {
    const mirrored = alphaBetaSelection(mirrorState(state), context, requestedDepth, diverse, false);
    return { ...mirrored, move: mirrored.move ? mirrorMove(mirrored.move) : null, candidates: mirrored.candidates.map((c) => ({ ...c, move: mirrorMove(c.move), principalVariation: c.principalVariation.map(mirrorMove) })), principalVariation: mirrored.principalVariation.map(mirrorMove), diagnostics: mirrored.diagnostics ? { ...mirrored.diagnostics, principalVariation: mirrored.diagnostics.principalVariation.map(mirrorMove) } : undefined };
  }
  const legal = allLegalMoves(state);
  const diagnostics: SearchDiagnostics = { requestedDepth, completedDepth: 0, nodesSearched: 0, leafEvaluations: 0, alphaBetaCutoffs: 0, transpositionTableHits: 0, elapsedMs: 0, timedOut: false, principalVariation: [], scoreByCompletedDepth: {}, selectedMoveChangedByDepth: false };
  const ab: AlphaBetaState = { table: new Map(), diagnostics, start: performance.now(), limit: context.timeLimitMs ?? 0, timedOut: false, previousPv: [] };
  let last: ScoredMove[] = rankedScoredMoves(state, legal, context, 1);
  let previousSelected: Move | null = null;
  for (let depth = 1; depth <= requestedDepth; depth++) {
    const rootMoves = orderedAlphaBetaMoves(state, staticRankedMoves(state, legal, state.current, context, 12), state.current, context, ab.previousPv[0], undefined);
    const scored: ScoredMove[] = [];
    let failed = false;
    for (const move of rootMoves) {
      const next = applyMove(state, move);
      if (next === state) continue;
      const child = alphaBetaValue(next, depth - 1, state.current, context, ab, -Infinity, Infinity, [positionKey(state)]);
      if (!child) { failed = true; break; }
      const breakdown = evaluateState(next, state.current, context);
      let score = child.score;
      if (isImmediateReversal(context.previousMove, move, state)) score += EVALUATION_WEIGHTS.immediateReversal;
      const pv = [move, ...child.pv];
      scored.push({ move, score, breakdown, principalVariation: pv, tie: moveTieKey(state, move, context.seed) });
    }
    if (failed || ab.timedOut) break;
    scored.sort((a,b)=> b.score-a.score || a.tie.localeCompare(b.tie));
    last = scored;
    diagnostics.completedDepth = depth;
    diagnostics.scoreByCompletedDepth[depth] = scored[0]?.score ?? 0;
    diagnostics.principalVariation = scored[0]?.principalVariation ?? [];
    if (previousSelected && scored[0] && !sameMove(previousSelected, scored[0].move)) diagnostics.selectedMoveChangedByDepth = true;
    previousSelected = scored[0]?.move ?? null;
    ab.previousPv = diagnostics.principalVariation;
  }
  diagnostics.timedOut = ab.timedOut;
  diagnostics.elapsedMs = Number((performance.now() - ab.start).toFixed(3));
  const result = chooseScoredMove(state, last, context, diverse, legal.length);
  result.diagnostics = { ...diagnostics, principalVariation: result.principalVariation };
  return result;
}

export function selectMove(state: GameState, agent: AgentName, context: AgentContext): Move | null {
  return selectMoveDetailed(state, agent, context).move;
}

export function selectMoveDetailed(state: GameState, agent: AgentName, context: AgentContext): SelectionResult {
  const moves = allLegalMoves(state);
  if (!moves.length) {
    return {
      move: null,
      legalMoveCount: 0,
      selectedScore: null,
      bestScore: null,
      scoreLoss: 0,
      diversityAffectedChoice: false,
      candidates: [],
      principalVariation: [],
    };
  }
  const mode = normalizedAgent(agent);
  if (mode === "random") {
    const move = moves[context.seed % moves.length];
    return {
      move,
      legalMoveCount: moves.length,
      selectedScore: null,
      bestScore: null,
      scoreLoss: 0,
      diversityAffectedChoice: false,
      candidates: [],
      principalVariation: [move],
    };
  }
  if (mode === "legacy-heuristic") {
    const captures = moves.filter((m) => {
      const occ = pieceAt(state, m.to);
      return occ && occ.player !== state.current;
    });
    const pool = captures.length ? captures : moves;
    const move = pool[context.seed % pool.length];
    return {
      move,
      legalMoveCount: moves.length,
      selectedScore: null,
      bestScore: null,
      scoreLoss: 0,
      diversityAffectedChoice: false,
      candidates: [],
      principalVariation: [move],
    };
  }
  const depth = isSearchAgent(mode) ? context.searchDepth ?? 2 : 1;
  if (isAlphaBetaAgent(mode)) return alphaBetaSelection(state, context, depth, isDiverseAgent(mode));
  const candidateMoves = isSearchAgent(mode)
    ? staticRankedMoves(state, moves, state.current, context, 12)
    : moves;
  return chooseScoredMove(
    state,
    rankedScoredMoves(state, candidateMoves, context, depth),
    context,
    isDiverseAgent(mode),
    moves.length,
  );
}


export interface SearchBenchmarkResult {
  selectedMove: Move | null;
  score: number | null;
  nodesSearched: number;
  elapsedMs: number;
  alphaBetaCutoffs: number;
  transpositionTableHits: number;
  completedDepth: number;
  principalVariation: Move[];
}

function countedFullSearchValue(state: GameState, depth: number, rootPlayer: Player, context: AgentContext, path: string[], counts: { nodes: number; leaves: number }, principalVariation?: Move[]): number {
  counts.nodes++;
  if (depth === 0 || state.winner) { counts.leaves++; return evaluateState(state, rootPlayer, context).total; }
  const key = positionKey(state);
  if (path.includes(key)) { counts.leaves++; return evaluateState(state, rootPlayer, context).total + EVALUATION_WEIGHTS.repeatedPosition * 2; }
  const moves = staticRankedMoves(state, allLegalMoves(state), state.current, context, 12);
  if (!moves.length) { counts.leaves++; return evaluateState(state, rootPlayer, context).total; }
  const opponent = state.current !== rootPlayer;
  let best = opponent ? Infinity : -Infinity;
  let bestMove: Move | null = null;
  for (const move of moves) {
    const next = applyMove(state, move);
    if (next === state) continue;
    const value = countedFullSearchValue(next, depth - 1, rootPlayer, context, [...path, key], counts);
    if ((opponent && value < best) || (!opponent && value > best)) { best = value; bestMove = move; }
  }
  if (bestMove && principalVariation) principalVariation.push(bestMove);
  return best;
}


function benchmarkAlphaBetaFixedDepth(state: GameState, context: AgentContext): SearchBenchmarkResult {
  const started = performance.now();
  const depth = context.searchDepth ?? 2;
  const diagnostics: SearchDiagnostics = { requestedDepth: depth, completedDepth: depth, nodesSearched: 0, leafEvaluations: 0, alphaBetaCutoffs: 0, transpositionTableHits: 0, elapsedMs: 0, timedOut: false, principalVariation: [], scoreByCompletedDepth: {}, selectedMoveChangedByDepth: false };
  const ab: AlphaBetaState = { table: new Map(), diagnostics, start: started, limit: 0, timedOut: false, previousPv: [] };
  const legal = allLegalMoves(state);
  const rootMoves = orderedAlphaBetaMoves(state, staticRankedMoves(state, legal, state.current, context, 12), state.current, context);
  const scored: ScoredMove[] = [];
  for (const move of rootMoves) {
    const next = applyMove(state, move);
    if (next === state) continue;
    const child = alphaBetaValue(next, depth - 1, state.current, context, ab, -Infinity, Infinity, [positionKey(state)]);
    if (!child) continue;
    const breakdown = evaluateState(next, state.current, context);
    scored.push({ move, score: child.score, breakdown, principalVariation: [move, ...child.pv], tie: moveTieKey(state, move, context.seed) });
  }
  scored.sort((a,b) => b.score-a.score || a.tie.localeCompare(b.tie));
  const chosen = chooseScoredMove(state, scored, context, false, legal.length);
  return { selectedMove: chosen.move, score: chosen.selectedScore, nodesSearched: diagnostics.nodesSearched, elapsedMs: Number((performance.now() - started).toFixed(3)), alphaBetaCutoffs: diagnostics.alphaBetaCutoffs, transpositionTableHits: diagnostics.transpositionTableHits, completedDepth: depth, principalVariation: chosen.principalVariation };
}

export function benchmarkSearchSelection(state: GameState, agent: "search-deterministic" | "search-alpha-beta-deterministic", context: AgentContext): SearchBenchmarkResult {
  const started = performance.now();
  if (agent === "search-alpha-beta-deterministic") return benchmarkAlphaBetaFixedDepth(state, context);
  const moves = staticRankedMoves(state, allLegalMoves(state), state.current, context, 12);
  const counts = { nodes: 0, leaves: 0 };
  const scored = moves.map((move) => {
    const next = applyMove(state, move);
    if (next === state) return null;
    const pv = [move];
    const breakdown = evaluateState(next, state.current, context);
    const depth = context.searchDepth ?? 2;
    const score = depth > 1 ? countedFullSearchValue(next, depth - 1, state.current, context, [positionKey(state)], counts, pv) : breakdown.total;
    return { move, score, breakdown, principalVariation: pv, tie: moveTieKey(state, move, context.seed) } satisfies ScoredMove;
  }).filter((m): m is ScoredMove => m !== null).sort((a,b) => b.score-a.score || a.tie.localeCompare(b.tie));
  const chosen = chooseScoredMove(state, scored, context, false, allLegalMoves(state).length);
  return { selectedMove: chosen.move, score: chosen.selectedScore, nodesSearched: counts.nodes, elapsedMs: Number((performance.now() - started).toFixed(3)), alphaBetaCutoffs: 0, transpositionTableHits: 0, completedDepth: context.searchDepth ?? 2, principalVariation: chosen.principalVariation };
}

export function diagnosticBreakdown(state: GameState, player: Player, context?: Pick<AgentContext, "recentPositions">): EvaluationBreakdown {
  return evaluateState(state, player, context);
}

export function describeMove(move: Move): string {
  return `${move.pieceId}->${fromCoord(move.to)}`;
}
