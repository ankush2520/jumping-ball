"use client";

import { useState } from "react";
import MenuScreen from "./components/shared/MenuScreen";
import { getSimulationById, simulations } from "./data/simulations";

export default function Home() {
  const [activeSimulationId, setActiveSimulationId] = useState<string | null>(
    null,
  );
  const activeSimulation = activeSimulationId
    ? getSimulationById(activeSimulationId)
    : null;
  const ActiveSimulation = activeSimulation?.component ?? null;

  return (
    <div
      style={{
        minHeight: "100vh",
        position: "relative",
        width: "100%",
        maxWidth: "100%",
        overflowX: "hidden",
        overflowY: "visible",
      }}
    >
      {ActiveSimulation ? (
        <>
          <button
            type="button"
            aria-label="Back to menu"
            title="Back to menu"
            onClick={() => setActiveSimulationId(null)}
            style={{
              position: "fixed",
              left: 10,
              top: 10,
              zIndex: 20,
              width: 34,
              height: 34,
              display: "grid",
              placeItems: "center",
              padding: 0,
              borderRadius: 999,
              border: "1px solid rgba(248, 250, 252, 0.16)",
              background: "rgba(15, 23, 42, 0.58)",
              color: "#f8fafc",
              cursor: "pointer",
              boxShadow: "0 8px 22px rgba(15, 23, 42, 0.28)",
              backdropFilter: "blur(8px)",
            }}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              width="17"
              height="17"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.2"
            >
              <path d="m3 11 9-8 9 8" />
              <path d="M5 10v10h14V10" />
              <path d="M10 20v-6h4v6" />
            </svg>
          </button>
          <ActiveSimulation />
        </>
      ) : (
        <MenuScreen
          simulations={simulations}
          onLaunch={setActiveSimulationId}
        />
      )}
    </div>
  );
}
