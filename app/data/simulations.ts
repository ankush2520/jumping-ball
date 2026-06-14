import type { ComponentType } from "react";
import EcosystemArena from "../components/games/ecosystem-arena/EcosystemArena";
import GravityWell from "../components/games/gravity-well/GravityWell";
import PlasmaBounce from "../components/games/plasma-bounce/PlasmaBounce";
import ShrinkingEscape from "../components/games/shrinking-escape/ShrinkingEscape";
import VortexEscape from "../components/games/vortex-escape/VortexEscape";

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
    | "plasma-bounce"
    | "shrinking-escape"
    | "vortex-escape";
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
    id: "vortex-escape",
    title: "Vortex Escape",
    subtitle: "CENTER GATE MAZE",
    description: "Find the rotating gaps and reach the center exit.",
    component: VortexEscape,
    status: "experimental",
    accentColor: "#22c55e",
    icon: "vortex-escape",
    glow: "card-emerald",
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
