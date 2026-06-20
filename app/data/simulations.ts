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
    id: "square-assembly",
    title: "Interactive Square Shapes",
    subtitle: "SHAPE SNAP CHALLENGE",
    description: "Design a shape on the grid, then watch bouncing squares snap into place.",
    component: SquareAssembly,
    status: "experimental",
    accentColor: "#f43f5e",
    icon: "square-assembly",
    glow: "card-rose",
  },
  {
    id: "country-escape-challenge",
    title: "Growing Ball in Shrinking Boundary",
    subtitle: "HOW LONG CAN IT BOUNCE?",
    description: "A ball grows bigger with every bounce while the boundary keeps shrinking.",
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
];

export const getSimulationById = (id: string) =>
  simulations.find((simulation) => simulation.id === id) ?? null;
