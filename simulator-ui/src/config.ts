import type { AgentName, DiversityLevel } from "../../simulator/agents.ts";

export type SimulationMode = "standard" | "opening";
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

export interface SimulatorUiSettings {
  mode: SimulationMode;
  standard: StandardSettings;
  opening: OpeningSettings;
}

export const AGENT_CHOICES: AgentName[] = [
  "random",
  "legacy-heuristic",
  "heuristic-deterministic",
  "heuristic-diverse",
  "search-deterministic",
  "search-diverse",
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
};

export function agentUsesDiversity(agent: AgentName): boolean {
  return agent === "heuristic-diverse" || agent === "search-diverse";
}

export function agentUsesSearchDepth(agent: AgentName): boolean {
  return agent === "search-deterministic" || agent === "search-diverse" || agent === "search";
}
