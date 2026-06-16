import type { ComponentType } from "react";
import BrokenSquare from "../components/games/broken-square/BrokenSquare";
import PlasmaBounce from "../components/games/plasma-bounce/PlasmaBounce";
import ShrinkingEscape from "../components/games/shrinking-escape/ShrinkingEscape";

export type SimulationStatus = "stable" | "experimental" | "coming-soon";

export type Simulation = {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  component: ComponentType | null;
  status: SimulationStatus;
  accentColor: string;
  icon:
    | "plasma-bounce"
    | "broken-square"
    | "shrinking-escape";
  glow: "card-cyan" | "card-emerald" | "card-amber" | "card-violet";
};

export const simulations: Simulation[] = [
  {
    id: "broken-square",
    title: "Broken Square",
    subtitle: "FRACTURE FIELD",
    description: "Split one perfect square into restless triangular shards.",
    component: BrokenSquare,
    status: "experimental",
    accentColor: "#a855f7",
    icon: "broken-square",
    glow: "card-violet",
  },
  {
    id: "shrinking-escape",
    title: "Merging Squares",
    subtitle: "GRID MERGE CHALLENGE",
    description: "Bounce blocks into clean compound shapes.",
    component: ShrinkingEscape,
    status: "experimental",
    accentColor: "#f59e0b",
    icon: "shrinking-escape",
    glow: "card-amber",
  },
  {
    id: "plasma-bounce",
    title: "Plasma Bounce",
    subtitle: "COLLISION CASCADE",
    description: "Split glowing balls inside a charged arena.",
    component: PlasmaBounce,
    status: "experimental",
    accentColor: "#67e8f9",
    icon: "plasma-bounce",
    glow: "card-cyan",
  },
];

export const getSimulationById = (id: string) =>
  simulations.find((simulation) => simulation.id === id) ?? null;
