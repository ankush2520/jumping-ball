import type { ComponentType } from "react";
import BallInPendulumMotion from "../components/games/illusion-of-circle/BallInPendulumMotion";
import BrokenSquare from "../components/games/merging-triangles/BrokenSquare";
import CollidingShapes from "../components/games/colliding-shapes/CollidingShapes";
import CountryEscapeChallenge from "../components/games/growing-ball-shrinking-boundary/CountryEscapeChallenge";
import MergingPerfectShape from "../components/games/merging-perfect-shape/MergingPerfectShape";
import PlasmaBounce from "../components/games/kessler-effect/PlasmaBounce";
import ShrinkingEscape from "../components/games/merging-squares/ShrinkingEscape";
import SquareAssembly from "../components/games/interactive-square-shapes/SquareAssembly";
import YinYangBalls from "../components/games/will-they-meet/YinYangBalls";

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
    | "square-assembly"
    | "merging-perfect-shape"
    | "ball-in-pendulum-motion"
    | "colliding-shapes"
    | "yin-yang-balls";
  glow: "card-cyan" | "card-emerald" | "card-amber" | "card-violet" | "card-rose" | "card-orange" | "card-blue" | "card-indigo" | "card-slate";
};

export const simulations: Simulation[] = [
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
    id: "ball-in-pendulum-motion",
    title: "Illusion of Circle",
    subtitle: "PENDULUM PHYSICS",
    description: "Watch 16 balls oscillate in simple harmonic motion and form a mesmerizing rotating circle illusion.",
    component: BallInPendulumMotion,
    status: "experimental",
    accentColor: "#60a5fa",
    icon: "ball-in-pendulum-motion",
    glow: "card-blue",
  },
  {
    id: "merging-perfect-shape",
    title: "Merging Perfect Shape",
    subtitle: "PIECES TO PERFECTION",
    description: "Scatter pieces of a perfect shape and watch them assemble back together.",
    component: MergingPerfectShape,
    status: "experimental",
    accentColor: "#f97316",
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
    id: "colliding-shapes",
    title: "Colliding Shapes",
    subtitle: "COLLISION ARENA",
    description: "Watch colorful shapes bounce off the walls and collide with each other inside the arena.",
    component: CollidingShapes,
    status: "experimental",
    accentColor: "#818cf8",
    icon: "colliding-shapes",
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
    icon: "plasma-bounce",
    glow: "card-cyan",
  },
];

export const getSimulationById = (id: string) =>
  simulations.find((simulation) => simulation.id === id) ?? null;
