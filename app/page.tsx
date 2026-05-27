"use client";

import { useState } from "react";
import GravityWell from "./components/games/gravity-well/GravityWell";
import MenuScreen from "./components/shared/MenuScreen";

export default function Home() {
  const [showSimulation, setShowSimulation] = useState(false);

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
      {showSimulation ? (
        <>
          <button
            type="button"
            onClick={() => setShowSimulation(false)}
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
          <GravityWell />
        </>
      ) : (
        <MenuScreen onLaunch={() => setShowSimulation(true)} />
      )}
    </div>
  );
}
