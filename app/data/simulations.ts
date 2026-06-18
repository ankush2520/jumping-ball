import type { ComponentType } from "react";
import BrokenSquare from "../components/games/broken-square/BrokenSquare";
import CountryEscapeChallenge from "../components/games/country-escape-challenge/CountryEscapeChallenge";
import PlasmaBounce from "../components/games/plasma-bounce/PlasmaBounce";
import ShrinkingEscape from "../components/games/shrinking-escape/ShrinkingEscape";
import SquareAssembly from "../components/games/square-assembly/SquareAssembly";

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
    | "country-escape-challenge"
    | "plasma-bounce"
    | "broken-square"
    | "shrinking-escape"
    | "square-assembly";
  glow: "card-cyan" | "card-emerald" | "card-amber" | "card-violet" | "card-rose";
};

export const simulations: Simulation[] = [
  {
    id: "country-escape-challenge",
    title: "Ball Escape",
    subtitle: "ROTATING EXIT RACE",
    description: "Five balls race to escape through the same rotating gap.",
    component: CountryEscapeChallenge,
    status: "experimental",
    accentColor: "#22c55e",
    icon: "country-escape-challenge",
    glow: "card-emerald",
  },
  {
    id: "broken-square",
    title: "Merging Triangles",
    subtitle: "TRIANGLE MERGE",
    description: "Merge bouncing triangles back into a perfect square.",
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
  {
    id: "square-assembly",
    title: "Square Assembly",
    subtitle: "SHAPE SNAP CHALLENGE",
    description: "Watch a square and three triangles collide and snap into their final form.",
    component: SquareAssembly,
    status: "experimental",
    accentColor: "#f43f5e",
    icon: "square-assembly",
    glow: "card-rose",
  },
];

export const getSimulationById = (id: string) =>
  simulations.find((simulation) => simulation.id === id) ?? null;
