import { EAST_CANNON, GATES, WEST_CANNON } from "../src/game/constants.ts";
import { fromCoord, toCoord } from "../src/game/coords.ts";
import { legalMovesForPiece } from "../src/game/movement.ts";
import { applyMove } from "../src/game/reducer.ts";
import { isInnerCircle } from "../src/game/terrain.ts";
import { canonicalMoveLabel, mirrorLabel, mirrorInvariantMoveKey, mirrorState, moveLabel } from "./mirror.ts";
import type { Coord, GameState, Move, Piece, Player } from "../src/game/types.ts";

export type AgentName =
  | "random"
  | "legacy-heuristic"
  | "heuristic"
  | "search"
  | "heuristic-deterministic"
  | "heuristic-diverse"
  | "search-deterministic"
  | "search-diverse";

export interface AgentContext {
  seed: number;
  recentPositions?: ReadonlyMap<string, number>;
  previousMove?: MoveRecord | null;
  searchDepth?: number;
  diversity?: DiversityLevel;
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

export interface SelectionResult {
  move: Move | null;
  legalMoveCount: number;
  selectedScore: number | null;
  bestScore: number | null;
  scoreLoss: number;
  diversityAffectedChoice: boolean;
  candidates: ScoredMove[];
  principalVariation: Move[];
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
  return agent === "search" || agent === "search-deterministic" || agent === "search-diverse";
}

function isDiverseAgent(agent: AgentName): boolean {
  return agent === "heuristic-diverse" || agent === "search-diverse";
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

export function diagnosticBreakdown(state: GameState, player: Player, context?: Pick<AgentContext, "recentPositions">): EvaluationBreakdown {
  return evaluateState(state, player, context);
}

export function describeMove(move: Move): string {
  return `${move.pieceId}->${fromCoord(move.to)}`;
}
