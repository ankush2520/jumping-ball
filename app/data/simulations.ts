import type { ComponentType } from "react";
import EcosystemArena from "../components/games/ecosystem-arena/EcosystemArena";
import GravityWell from "../components/games/gravity-well/GravityWell";

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
  glow: "card-cyan" | "card-emerald";
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
];

export const getSimulationById = (id: string) =>
  simulations.find((simulation) => simulation.id === id) ?? null;
