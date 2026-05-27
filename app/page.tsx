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
            onClick={() => setActiveSimulationId(null)}
            style={{
              position: "fixed",
              left: 16,
              top: 16,
              zIndex: 20,
              padding: "12px 18px",
              borderRadius: 14,
              border: "none",
              background: "rgba(15, 23, 42, 0.92)",
              color: "#f8fafc",
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer",
              boxShadow: "0 18px 40px rgba(15, 23, 42, 0.4)",
            }}
          >
            ← Back to menu
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
