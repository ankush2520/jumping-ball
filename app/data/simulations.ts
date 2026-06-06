import type { ComponentType } from "react";
import EcosystemArena from "../components/games/ecosystem-arena/EcosystemArena";
import GravityWell from "../components/games/gravity-well/GravityWell";
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
    | "gravity-well"
    | "ecosystem-arena"
    | "shrinking-escape";
  glow: "card-cyan" | "card-emerald" | "card-amber";
};

export const simulations: Simulation[] = [
  {
    id: "gravity-well",
    title: "Gravity Well",
    subtitle: "Singularity Field",
    description: "Bend momentum through a luminous gravity core.",
    component: GravityWell,
    status: "stable",
    accentColor: "#60a5fa",
    icon: "gravity-well",
    glow: "card-cyan",
  },
  {
    id: "ecosystem-arena",
    title: "Ecosystem Arena",
    subtitle: "Species Field",
    description: "Watch predators, prey, healers, and voids compete.",
    component: EcosystemArena,
    status: "experimental",
    accentColor: "#22c55e",
    icon: "ecosystem-arena",
    glow: "card-emerald",
  },
  {
    id: "shrinking-escape",
    title: "Shrinking Escape",
    subtitle: "SIZE DECAY CHALLENGE",
    description: "Bounce. Shrink. Escape.",
    component: ShrinkingEscape,
    status: "experimental",
    accentColor: "#f59e0b",
    icon: "shrinking-escape",
    glow: "card-amber",
  },
];

export const getSimulationById = (id: string) =>
  simulations.find((simulation) => simulation.id === id) ?? null;
