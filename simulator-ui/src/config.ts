import type { AgentName, DiversityLevel } from "../../simulator/agents.ts";

export type SimulationMode = "standard" | "opening" | "targeted";
export type PositionSampling = "none" | "final" | "every-ply";

export interface StandardSettings {
  games: number;
  greenAgent: AgentName;
  blueAgent: AgentName;
  searchDepth: number;
  greenDiversity: DiversityLevel;
  blueDiversity: DiversityLevel;
  seed: number;
  maxPlies: number;
  positionSampling: PositionSampling;
}

export interface OpeningSettings {
  gamesPerOpening: number;
  forceBlueReplies: boolean;
  greenAgent: AgentName;
  blueAgent: AgentName;
  searchDepth: number;
  greenDiversity: DiversityLevel;
  blueDiversity: DiversityLevel;
  seed: number;
  maxPlies: number;
  positionSampling: PositionSampling;
}

export interface TargetedOpeningSettings {
  gamesPerMatchup: number;
  greenAgent: AgentName;
  blueAgent: AgentName;
  searchDepth: number;
  greenDiversity: DiversityLevel;
  blueDiversity: DiversityLevel;
  seed: number;
  maxPlies: number;
  timeLimitMs: number;
  positionSampling: PositionSampling;
  selectedGreenOpenings: string[];
  selectedBlueRepliesByOpening: Record<string, string[]>;
}

export interface SimulatorUiSettings {
  mode: SimulationMode;
  standard: StandardSettings;
  opening: OpeningSettings;
  targeted: TargetedOpeningSettings;
}

export const AGENT_CHOICES: AgentName[] = [
  "random",
  "legacy-heuristic",
  "heuristic-deterministic",
  "heuristic-diverse",
  "search-deterministic",
  "search-diverse",
  "search-alpha-beta-deterministic",
  "search-alpha-beta-diverse",
];

export const DEFAULT_SETTINGS: SimulatorUiSettings = {
  mode: "standard",
  standard: {
    games: 100,
    greenAgent: "heuristic-diverse",
    blueAgent: "heuristic-diverse",
    greenDiversity: 1,
    blueDiversity: 1,
    searchDepth: 2,
    seed: 12345,
    maxPlies: 500,
    positionSampling: "none",
  },
  opening: {
    gamesPerOpening: 1,
    forceBlueReplies: false,
    greenAgent: "heuristic-diverse",
    blueAgent: "heuristic-diverse",
    greenDiversity: 1,
    blueDiversity: 1,
    searchDepth: 2,
    seed: 12345,
    maxPlies: 500,
    positionSampling: "none",
  },
  targeted: {
    gamesPerMatchup: 1,
    greenAgent: "search-alpha-beta-deterministic",
    blueAgent: "search-alpha-beta-deterministic",
    greenDiversity: 1,
    blueDiversity: 1,
    searchDepth: 2,
    seed: 12345,
    maxPlies: 500,
    timeLimitMs: 0,
    positionSampling: "none",
    selectedGreenOpenings: [],
    selectedBlueRepliesByOpening: {},
  },
};

export function agentUsesDiversity(agent: AgentName): boolean {
  return agent === "heuristic-diverse" || agent === "search-diverse" || agent === "search-alpha-beta-diverse";
}

export function agentUsesSearchDepth(agent: AgentName): boolean {
  return agent === "search-deterministic" || agent === "search-diverse" || agent === "search" || agent === "search-alpha-beta-deterministic" || agent === "search-alpha-beta-diverse";
}
