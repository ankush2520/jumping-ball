import type { ComponentType } from "react";
import BallInPendulumMotion from "../components/games/illusion-of-circle/BallInPendulumMotion";
import BrokenSquare from "../components/games/merging-triangles/BrokenSquare";
import BallRace from "../components/games/ball-race/BallRace";
import CountryEscapeChallenge from "../components/games/growing-ball-shrinking-boundary/CountryEscapeChallenge";
import MergingPerfectShape from "../components/games/merging-perfect-shape/MergingPerfectShape";
import PlasmaBounce from "../components/games/kessler-effect/PlasmaBounce";
import ShrinkingEscape from "../components/games/merging-squares/ShrinkingEscape";
import SquareAssembly from "../components/games/interactive-square-shapes/SquareAssembly";
import SkyDrop from "../components/games/sky-drop/SkyDrop";
import YinYangBalls from "../components/games/will-they-meet/YinYangBalls";

export type SimulationStatus = "stable" | "experimental" | "coming-soon";

export type CategoryId = "race" | "ball-simulation" | "merging-shapes" | "games";

export type IconKey =
  | "country-escape-challenge"
  | "plasma-bounce"
  | "broken-square"
  | "shrinking-escape"
  | "square-assembly"
  | "merging-perfect-shape"
  | "ball-in-pendulum-motion"
  | "ball-race"
  | "yin-yang-balls"
  | "sky-drop"
  | "race-category"
  | "ball-simulation-category"
  | "merging-shapes-category"
  | "games-category";

export type Simulation = {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  component: ComponentType | null;
  status: SimulationStatus;
  accentColor: string;
  category: CategoryId;
  icon: IconKey;
  glow: "card-cyan" | "card-emerald" | "card-amber" | "card-violet" | "card-rose" | "card-orange" | "card-blue" | "card-indigo" | "card-slate";
};

export type Category = {
  id: CategoryId;
  title: string;
  subtitle: string;
  description: string;
  icon: IconKey;
  glow: Simulation["glow"];
};

export const categories: Category[] = [
  {
    id: "race",
    title: "Race",
    subtitle: "SPEED & COLLISIONS",
    description: "Colorful balls race around an arena, bouncing off walls and crashing into each other.",
    icon: "race-category",
    glow: "card-indigo",
  },
  {
    id: "ball-simulation",
    title: "Ball Simulation",
    subtitle: "PHYSICS PLAYGROUND",
    description: "Yin-yang balls, collision cascades, circular illusions, and shrinking boundaries.",
    icon: "ball-simulation-category",
    glow: "card-cyan",
  },
  {
    id: "merging-shapes",
    title: "Merging Shapes",
    subtitle: "ASSEMBLE & SNAP",
    description: "Scattered pieces bounce around and merge back into perfect shapes.",
    icon: "merging-shapes-category",
    glow: "card-orange",
  },
  {
    id: "games",
    title: "Games",
    subtitle: "TAP & TIME IT RIGHT",
    description: "Skill-based mini games — tap at the right moment to land the shot.",
    icon: "games-category",
    glow: "card-violet",
  },
];

export const simulations: Simulation[] = [
  {
    id: "ball-race",
    title: "Ball Race",
    subtitle: "ARENA SPEED RACE",
    description: "Colorful balls race around the arena, bouncing off walls and crashing into each other.",
    component: BallRace,
    status: "experimental",
    accentColor: "#818cf8",
    category: "race",
    icon: "ball-race",
    glow: "card-indigo",
  },
  {
    id: "yin-yang-balls",
    title: "Will These Two Balls Ever Meet?",
    subtitle: "YIN MEETS YANG",
    description: "Two half-balls bounce around the arena and unite into a full yin-yang the moment they collide.",
    component: YinYangBalls,
    status: "experimental",
    accentColor: "#cbd5e1",
    category: "ball-simulation",
    icon: "yin-yang-balls",
    glow: "card-slate",
  },
  {
    id: "plasma-bounce",
    title: "Kessler Effect",
    subtitle: "COLLISION CASCADE",
    description: "Split glowing balls inside a charged arena.",
    component: PlasmaBounce,
    status: "experimental",
    accentColor: "#67e8f9",
    category: "ball-simulation",
    icon: "plasma-bounce",
    glow: "card-cyan",
  },
  {
    id: "ball-in-pendulum-motion",
    title: "Illusion of Circle",
    subtitle: "PENDULUM PHYSICS",
    description: "Watch 16 balls oscillate in simple harmonic motion and form a mesmerizing rotating circle illusion.",
    component: BallInPendulumMotion,
    status: "experimental",
    accentColor: "#60a5fa",
    category: "ball-simulation",
    icon: "ball-in-pendulum-motion",
    glow: "card-blue",
  },
  {
    id: "country-escape-challenge",
    title: "Growing Ball in Shrinking Boundary",
    subtitle: "HOW LONG CAN IT BOUNCE?",
    description: "A ball grows bigger with every bounce while the boundary keeps shrinking.",
    component: CountryEscapeChallenge,
    status: "experimental",
    accentColor: "#22c55e",
    category: "ball-simulation",
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
    category: "merging-shapes",
    icon: "broken-square",
    glow: "card-violet",
  },
  {
    id: "merging-perfect-shape",
    title: "Merging Perfect Shape",
    subtitle: "PIECES TO PERFECTION",
    description: "Scatter pieces of a perfect shape and watch them assemble back together.",
    component: MergingPerfectShape,
    status: "experimental",
    accentColor: "#f97316",
    category: "merging-shapes",
    icon: "merging-perfect-shape",
    glow: "card-orange",
  },
  {
    id: "square-assembly",
    title: "Interactive Square Shapes",
    subtitle: "SHAPE SNAP CHALLENGE",
    description: "Design a shape on the grid, then watch bouncing squares snap into place.",
    component: SquareAssembly,
    status: "experimental",
    accentColor: "#f43f5e",
    category: "merging-shapes",
    icon: "square-assembly",
    glow: "card-rose",
  },
  {
    id: "shrinking-escape",
    title: "Merging Squares",
    subtitle: "GRID MERGE CHALLENGE",
    description: "Bounce blocks into clean compound shapes.",
    component: ShrinkingEscape,
    status: "experimental",
    accentColor: "#f59e0b",
    category: "merging-shapes",
    icon: "shrinking-escape",
    glow: "card-amber",
  },
  {
    id: "sky-drop",
    title: "Sky Drop",
    subtitle: "DROP THE PIECE",
    description: "A plane tows a shape on a rope — tap at the right moment to drop it into its matching slot. New shape every level.",
    component: SkyDrop,
    status: "experimental",
    accentColor: "#a78bfa",
    category: "games",
    icon: "sky-drop",
    glow: "card-violet",
  },
];

export const getSimulationById = (id: string) =>
  simulations.find((simulation) => simulation.id === id) ?? null;

export const getCategoryById = (id: string) =>
  categories.find((category) => category.id === id) ?? null;

export const getSimulationsByCategory = (id: CategoryId) =>
  simulations.filter((simulation) => simulation.category === id);
