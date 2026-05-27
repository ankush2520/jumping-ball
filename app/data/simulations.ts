import type { ComponentType } from "react";
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
  icon: "gravity-well" | "plasma-bounce" | "neon-particles" | "orbital-chaos" | "quantum-wave" | "collision-lab";
  glow: "card-cyan" | "card-violet" | "card-emerald" | "card-amber" | "card-blue" | "card-rose";
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
    id: "plasma-bounce",
    title: "Plasma Bounce",
    subtitle: "Ionized Rebound",
    description: "Launch charged motion inside a reactive plasma shell.",
    component: null,
    status: "coming-soon",
    accentColor: "#a855f7",
    icon: "plasma-bounce",
    glow: "card-violet",
  },
  {
    id: "neon-particles",
    title: "Neon Particles",
    subtitle: "Photon Swarm",
    description: "Trace sparkling paths through an electric particle field.",
    component: null,
    status: "coming-soon",
    accentColor: "#10b981",
    icon: "neon-particles",
    glow: "card-emerald",
  },
  {
    id: "orbital-chaos",
    title: "Orbital Chaos",
    subtitle: "Unstable System",
    description: "Explore cascading paths and volatile orbital drift.",
    component: null,
    status: "coming-soon",
    accentColor: "#f59e0b",
    icon: "orbital-chaos",
    glow: "card-amber",
  },
  {
    id: "quantum-wave",
    title: "Quantum Wave",
    subtitle: "Probability Drift",
    description: "Watch waveforms shimmer through a synthetic chamber.",
    component: null,
    status: "coming-soon",
    accentColor: "#60a5fa",
    icon: "quantum-wave",
    glow: "card-blue",
  },
  {
    id: "collision-lab",
    title: "Collision Lab",
    subtitle: "Impact Matrix",
    description: "Test kinetic response inside a precision collision grid.",
    component: null,
    status: "coming-soon",
    accentColor: "#f43f5e",
    icon: "collision-lab",
    glow: "card-rose",
  },
];

export const getSimulationById = (id: string) =>
  simulations.find((simulation) => simulation.id === id) ?? null;
