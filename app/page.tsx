"use client";

import { useEffect, useState } from "react";
import MenuScreen from "./components/shared/MenuScreen";
import {
  categories,
  getCategoryById,
  getSimulationById,
  getSimulationsByCategory,
  type CategoryId,
} from "./data/simulations";
import { trackEvent, trackWebsiteVisit } from "./lib/analytics";

const categoryHeroText: Record<CategoryId, [string, string]> = {
  race: ["ARENA", "RACE"],
  "ball-simulation": ["BALL", "SIMULATION"],
  "merging-shapes": ["MERGING", "SHAPES"],
  games: ["TAP", "GAMES"],
};

export default function Home() {
  const [categoryId, setCategoryId] = useState<CategoryId | null>(null);
  const [activeSimulationId, setActiveSimulationId] = useState<string | null>(
    null,
  );
  const activeSimulation = activeSimulationId
    ? getSimulationById(activeSimulationId)
    : null;
  const ActiveSimulation = activeSimulation?.component ?? null;
  const activeCategory = categoryId ? getCategoryById(categoryId) : null;
  const categorySimulations = categoryId
    ? getSimulationsByCategory(categoryId)
    : [];

  useEffect(() => {
    trackWebsiteVisit();
  }, []);

  const handleSelectCategory = (id: string) => {
    const category = getCategoryById(id);
    if (!category) return;

    trackEvent("category_selected", { categoryId: id });

    const simsInCategory = getSimulationsByCategory(category.id);
    setCategoryId(category.id);
    if (simsInCategory.length === 1) {
      setActiveSimulationId(simsInCategory[0].id);
    }
  };

  const handleBackFromSimulation = () => {
    trackEvent("home_clicked", { button_name: "home" });
    const simsInCategory = categoryId ? getSimulationsByCategory(categoryId) : [];
    setActiveSimulationId(null);
    if (simsInCategory.length <= 1) {
      setCategoryId(null);
    }
  };

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
        <div className="simulation-viewport">
          <button
            type="button"
            aria-label="Back to menu"
            title="Back to menu"
            className="home-button"
            onClick={handleBackFromSimulation}
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
          <style jsx>{`
            .simulation-viewport {
              position: relative;
              isolation: isolate;
              width: 100%;
              min-height: 100dvh;
              overflow: hidden;
            }

            .home-button {
              opacity: 1;
            }

            @media (max-width: 600px) {
              .home-button {
                left: 14px !important;
                top: calc(14px + env(safe-area-inset-top, 0px)) !important;
                width: 42px !important;
                height: 42px !important;
                opacity: 0.75;
                z-index: 40 !important;
              }

              .home-button svg {
                width: 20px;
                height: 20px;
              }
            }
          `}</style>
        </div>
      ) : categoryId && activeCategory ? (
        <MenuScreen
          items={categorySimulations}
          onSelect={setActiveSimulationId}
          heroLine1={categoryHeroText[categoryId][0]}
          heroLine2={categoryHeroText[categoryId][1]}
          heroSubtitle={activeCategory.description}
          onBack={() => setCategoryId(null)}
        />
      ) : (
        <MenuScreen
          items={categories}
          onSelect={handleSelectCategory}
          heroLine1="BOUNCING"
          heroLine2="SHAPES"
          heroSubtitle="Interactive Simulation Playground"
        />
      )}
    </div>
  );
}
