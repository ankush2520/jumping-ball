"use client";

import React, { useState } from "react";
import type { Simulation } from "../../data/simulations";

interface Props {
  simulations: Simulation[];
  onLaunch: (id: string) => void;
}

const renderSimulationIcon = (icon: Simulation["icon"]) => {
  if (icon === "gravity-well") {
    return (
      <svg
        viewBox="0 0 64 64"
        width="48"
        height="48"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <circle cx="32" cy="32" r="24" opacity="0.4" />
        <circle cx="32" cy="32" r="16" />
        <circle cx="32" cy="32" r="6" fill="currentColor" />
        <circle cx="48" cy="20" r="3" fill="currentColor" opacity="0.6" />
        <circle cx="20" cy="44" r="4" fill="currentColor" opacity="0.5" />
      </svg>
    );
  }

  if (icon === "ecosystem-arena") {
    return (
      <svg
        viewBox="0 0 64 64"
        width="48"
        height="48"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <circle cx="20" cy="25" r="6" fill="currentColor" opacity="0.8" />
        <circle cx="42" cy="20" r="5" fill="currentColor" opacity="0.55" />
        <circle cx="36" cy="43" r="7" fill="currentColor" opacity="0.35" />
        <circle cx="48" cy="40" r="8" opacity="0.7" />
        <path d="M24 28c5 7 9 10 18 10" opacity="0.55" />
        <path d="M38 22c-8 1-13 4-17 12" opacity="0.45" />
      </svg>
    );
  }

  return null;
};

const MenuScreen: React.FC<Props> = ({ simulations, onLaunch }) => {
  const [comingSoonTitle, setComingSoonTitle] = useState<string | null>(null);

  const handleLaunch = (simulation: Simulation) => {
    if (simulation.status === "coming-soon" || !simulation.component) {
      setComingSoonTitle(simulation.title);
      return;
    }

    onLaunch(simulation.id);
  };

  return (
    <div className="menu-root">
      {/* Animated glow background */}
      <div className="glow-orb glow-orb-1" />
      <div className="glow-orb glow-orb-2" />
      <div className="light-rays" />

      <div className="menu-container">
        {/* Hero Section */}
        <div className="hero-section">
          <div className="hero-accent" />
          <h1 className="hero-title">
            PHYSICS <span className="gradient-text">LAB</span>
          </h1>
          <p className="hero-subtitle">Interactive Simulation Playground</p>
          <div className="hero-divider" />
        </div>

        {/* Simulation Grid */}
        <div className="buttons-section">
          {simulations.map((simulation) => (
            <button
              key={simulation.id}
              onClick={() => handleLaunch(simulation)}
              className={`launch-button ${simulation.glow}`}
            >
              <div className="button-content">
                <div className="button-icon">
                  {renderSimulationIcon(simulation.icon)}
                </div>
                <div className="button-text">
                  <div className="button-title">
                    {simulation.title}
                    {simulation.id === "ecosystem-arena" ? (
                      <span className="simulation-badge">NEW</span>
                    ) : null}
                  </div>
                  <div className="button-subtitle">{simulation.subtitle}</div>
                  <div className="button-description">
                    {simulation.description}
                  </div>
                </div>
              </div>
              <div className="button-arrow">
                <span>
                  {simulation.status === "coming-soon" ? "Soon" : "Launch"}
                </span>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </div>
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className="menu-footer">
          <p>Powered by React & Canvas | 60 FPS Physics Engine</p>
        </div>
      </div>

      {comingSoonTitle && (
        <div className="coming-soon-overlay" role="dialog" aria-modal="true">
          <button
            type="button"
            className="coming-soon-backdrop"
            aria-label="Close coming soon message"
            onClick={() => setComingSoonTitle(null)}
          />
          <div className="coming-soon-panel">
            <span>Coming Soon</span>
            <strong>{comingSoonTitle}</strong>
            <p>This simulation is still in development.</p>
            <button type="button" onClick={() => setComingSoonTitle(null)}>
              Close
            </button>
          </div>
        </div>
      )}
      <style jsx>{`
        * {
          box-sizing: border-box;
        }

        .menu-root {
          min-height: 100vh;
          display: flex;
          align-items: flex-start;
          justify-content: center;
          width: 100%;
          max-width: 100%;
          padding: 28px 24px 34px;
          background:
            radial-gradient(
              circle at 18% 12%,
              rgba(59, 130, 246, 0.12),
              transparent 30%
            ),
            radial-gradient(
              circle at 82% 18%,
              rgba(168, 85, 247, 0.1),
              transparent 28%
            ),
            linear-gradient(135deg, #070b18 0%, #0d1024 48%, #071622 100%);
          color: #f8fafc;
          overflow-x: hidden;
          overflow-y: visible;
          position: relative;
        }

        .menu-root::before {
          content: "";
          position: fixed;
          inset: 0;
          pointer-events: none;
          z-index: 0;
          background: linear-gradient(
            180deg,
            rgba(255, 255, 255, 0.035),
            transparent 28%,
            rgba(2, 6, 23, 0.28)
          );
          mix-blend-mode: screen;
          opacity: 0.45;
        }

        .glow-orb {
          position: fixed;
          border-radius: 50%;
          filter: blur(90px);
          opacity: 0.08;
          pointer-events: none;
          z-index: 1;
        }

        .glow-orb-1 {
          width: 460px;
          height: 460px;
          background: radial-gradient(
            circle,
            rgba(59, 130, 246, 0.38),
            transparent
          );
          top: -150px;
          left: -140px;
        }

        .glow-orb-2 {
          width: 420px;
          height: 420px;
          background: radial-gradient(
            circle,
            rgba(168, 85, 247, 0.28),
            transparent
          );
          bottom: -130px;
          right: -130px;
        }

        .light-rays {
          position: fixed;
          inset: 0;
          pointer-events: none;
          z-index: 2;
          background: linear-gradient(
            115deg,
            transparent 0%,
            rgba(125, 249, 255, 0.035) 42%,
            transparent 68%
          );
          opacity: 0.3;
          mix-blend-mode: screen;
        }

        .menu-container {
          max-width: 1120px;
          width: 100%;
          display: flex;
          flex-direction: column;
          gap: 46px;
          position: relative;
          z-index: 10;
        }

        /* Hero Section */
        .hero-section {
          text-align: center;
          position: relative;
          padding: 36px 40px 8px;
        }

        .hero-accent {
          position: absolute;
          top: 0;
          left: 50%;
          transform: translateX(-50%);
          width: 120px;
          height: 4px;
          background: linear-gradient(
            90deg,
            transparent,
            #60a5fa,
            #3b82f6,
            #06b6d4,
            transparent
          );
          border-radius: 999px;
          box-shadow:
            0 0 10px rgba(6, 182, 212, 0.2),
            0 0 18px rgba(59, 130, 246, 0.12);
        }

        .hero-title {
          position: relative;
          margin: 20px 0 0 0;
          font-family:
            "Geist Mono", "SFMono-Regular", "Roboto Mono", "Orbitron", monospace;
          font-size: clamp(3.8rem, 10.6vw, 8.6rem);
          line-height: 0.9;
          font-weight: 900;
          letter-spacing: 0;
          text-transform: uppercase;
          background: linear-gradient(
            110deg,
            #ffffff 0%,
            #dbeafe 18%,
            #67e8f9 38%,
            #60a5fa 58%,
            #f0f9ff 78%,
            #ffffff 100%
          );
          background-size: 220% 100%;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          filter: drop-shadow(0 12px 30px rgba(2, 8, 23, 0.68));
          text-shadow:
            0 0 14px rgba(125, 249, 255, 0.18),
            0 0 38px rgba(59, 130, 246, 0.18);
        }

        .hero-title::before {
          content: "PHYSICS LAB";
          position: absolute;
          inset: 0;
          z-index: -1;
          color: transparent;
          -webkit-text-stroke: 1px rgba(125, 249, 255, 0.18);
          transform: translate3d(0, 8px, 0) scale(1.01);
          filter: blur(6px);
          opacity: 0.22;
        }

        .gradient-text {
          background: linear-gradient(
            115deg,
            #7dd3fc,
            #ffffff,
            #22d3ee,
            #818cf8
          );
          background-size: 180% 100%;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .hero-subtitle {
          margin: 22px 0 0 0;
          font-family: "Geist Mono", "SFMono-Regular", "Roboto Mono", monospace;
          font-size: clamp(0.92rem, 1.55vw, 1.18rem);
          color: rgba(226, 246, 255, 0.86);
          line-height: 1.5;
          max-width: 700px;
          margin-left: auto;
          margin-right: auto;
          font-weight: 500;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          text-shadow:
            0 0 14px rgba(6, 182, 212, 0.22),
            0 8px 22px rgba(2, 8, 23, 0.66);
        }

        .hero-divider {
          width: 60px;
          height: 2px;
          background: linear-gradient(
            90deg,
            transparent,
            #06b6d4,
            #3b82f6,
            transparent
          );
          margin: 28px auto 0;
          border-radius: 999px;
          box-shadow: 0 0 18px rgba(6, 182, 212, 0.28);
        }

        /* Buttons Section */
        .buttons-section {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 28px;
          align-items: stretch;
          justify-content: center;
          width: min(880px, 100%);
          padding: 0 34px 10px;
          margin: 0 auto;
        }

        .launch-button {
          --card-rgb: 34, 211, 238;
          --card-rgb-soft: 59, 130, 246;
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: space-between;
          gap: 15px;
          min-height: 200px;
          padding: 19px 20px;
          border: none;
          border-radius: 24px;
          background:
            linear-gradient(
              135deg,
              rgba(255, 255, 255, 0.1) 0%,
              rgba(255, 255, 255, 0.04) 18%,
              rgba(15, 23, 42, 0.68) 48%,
              rgba(3, 7, 18, 0.82) 100%
            ),
            linear-gradient(
              120deg,
              rgba(var(--card-rgb), 0.1),
              rgba(var(--card-rgb-soft), 0.08)
            );
          backdrop-filter: blur(10px) saturate(120%);
          -webkit-backdrop-filter: blur(10px) saturate(120%);
          border: 1px solid rgba(179, 229, 252, 0.16);
          color: #f8fafc;
          cursor: pointer;
          transition:
            transform 0.45s cubic-bezier(0.22, 1, 0.36, 1),
            border-color 0.45s ease,
            box-shadow 0.45s ease,
            background 0.45s ease;
          text-align: left;
          isolation: isolate;
          box-shadow:
            0 12px 28px rgba(2, 8, 23, 0.34),
            0 0 10px rgba(var(--card-rgb), 0.06),
            inset 0 1px 0 rgba(255, 255, 255, 0.16);
        }

        .card-cyan {
          --card-rgb: 34, 211, 238;
          --card-rgb-soft: 59, 130, 246;
        }

        .card-violet {
          --card-rgb: 168, 85, 247;
          --card-rgb-soft: 236, 72, 153;
        }

        .card-emerald {
          --card-rgb: 16, 185, 129;
          --card-rgb-soft: 45, 212, 191;
        }

        .card-amber {
          --card-rgb: 245, 158, 11;
          --card-rgb-soft: 249, 115, 22;
        }

        .card-blue {
          --card-rgb: 96, 165, 250;
          --card-rgb-soft: 129, 140, 248;
        }

        .card-rose {
          --card-rgb: 244, 63, 94;
          --card-rgb-soft: 168, 85, 247;
        }

        .launch-button::before {
          content: "";
          position: absolute;
          inset: 0;
          border-radius: inherit;
          border: 1px solid rgba(var(--card-rgb), 0.2);
          pointer-events: none;
          z-index: 1;
        }

        .launch-button::after {
          content: "";
          position: absolute;
          inset: 1px;
          border-radius: inherit;
          background: linear-gradient(
            155deg,
            rgba(255, 255, 255, 0.14) 0%,
            rgba(255, 255, 255, 0.04) 18%,
            transparent 36%
          );
          opacity: 0.46;
          pointer-events: none;
          mix-blend-mode: screen;
          z-index: 1;
        }

        .launch-button:hover {
          transform: translateY(-3px);
          border-color: rgba(191, 246, 255, 0.28);
          box-shadow:
            0 16px 36px rgba(2, 8, 23, 0.38),
            0 0 14px rgba(var(--card-rgb), 0.12),
            inset 0 1px 0 rgba(255, 255, 255, 0.22);
        }

        .launch-button:hover::before {
          opacity: 1;
        }

        .button-content {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 14px;
          flex: 1;
          width: 100%;
          position: relative;
          z-index: 2;
        }

        .button-icon {
          flex-shrink: 0;
          width: 62px;
          height: 62px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 18px;
          background: linear-gradient(
            135deg,
            rgba(255, 255, 255, 0.18),
            rgba(var(--card-rgb-soft), 0.2) 42%,
            rgba(var(--card-rgb), 0.12)
          );
          border: 1px solid rgba(var(--card-rgb), 0.42);
          color: rgb(var(--card-rgb));
          transition:
            transform 0.45s cubic-bezier(0.22, 1, 0.36, 1),
            border-color 0.45s ease,
            box-shadow 0.45s ease,
            color 0.45s ease;
          box-shadow:
            0 10px 24px rgba(var(--card-rgb), 0.1),
            inset 0 1px 0 rgba(255, 255, 255, 0.3),
            inset 0 0 22px rgba(var(--card-rgb), 0.08);
        }

        .launch-button:hover .button-icon {
          background: linear-gradient(
            135deg,
            rgba(255, 255, 255, 0.26),
            rgba(var(--card-rgb-soft), 0.36),
            rgba(var(--card-rgb), 0.24)
          );
          border-color: rgba(191, 246, 255, 0.8);
          color: #e0faff;
          transform: scale(1.04);
          box-shadow:
            0 12px 24px rgba(var(--card-rgb), 0.14),
            0 0 16px rgba(var(--card-rgb), 0.16),
            inset 0 1px 0 rgba(255, 255, 255, 0.42),
            inset 0 0 28px rgba(var(--card-rgb), 0.2);
        }

        .button-text {
          flex: 1;
          min-width: 0;
        }

        .button-title {
          display: flex;
          align-items: center;
          gap: 9px;
          font-size: 1.14rem;
          font-weight: 800;
          margin-bottom: 6px;
          letter-spacing: 0;
          text-shadow:
            0 0 18px rgba(125, 249, 255, 0.28),
            0 2px 18px rgba(2, 8, 23, 0.7);
        }

        .simulation-badge {
          display: inline-flex;
          align-items: center;
          min-height: 18px;
          padding: 0 7px;
          border: 1px solid rgba(var(--card-rgb), 0.42);
          border-radius: 999px;
          background: rgba(var(--card-rgb), 0.13);
          color: rgb(var(--card-rgb));
          font-size: 0.55rem;
          font-weight: 900;
          letter-spacing: 0.12em;
          line-height: 1;
          text-shadow: none;
        }

        .button-subtitle {
          font-size: 0.72rem;
          color: rgb(var(--card-rgb));
          font-weight: 600;
          margin-bottom: 8px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }

        .button-description {
          font-size: 0.82rem;
          color: rgba(248, 250, 252, 0.75);
          line-height: 1.45;
          font-weight: 300;
        }

        .button-arrow {
          align-self: flex-start;
          min-height: 38px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          padding: 0 14px 0 16px;
          border-radius: 14px;
          background: linear-gradient(
            135deg,
            rgba(255, 255, 255, 0.18),
            rgba(var(--card-rgb), 0.24),
            rgba(var(--card-rgb-soft), 0.14)
          );
          border: 1px solid rgba(var(--card-rgb), 0.44);
          color: #ecfeff;
          transition:
            transform 0.45s cubic-bezier(0.22, 1, 0.36, 1),
            border-color 0.45s ease,
            box-shadow 0.45s ease,
            background 0.45s ease;
          position: relative;
          z-index: 2;
          box-shadow:
            0 8px 20px rgba(var(--card-rgb), 0.1),
            inset 0 1px 0 rgba(255, 255, 255, 0.26),
            inset 0 0 18px rgba(var(--card-rgb), 0.08);
        }

        .button-arrow span {
          font-size: 0.68rem;
          font-weight: 800;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }

        .button-arrow svg {
          width: 16px;
          height: 16px;
          stroke-width: 2;
        }

        .launch-button:hover .button-arrow {
          background: linear-gradient(
            135deg,
            rgba(255, 255, 255, 0.26),
            rgba(var(--card-rgb), 0.42),
            rgba(var(--card-rgb-soft), 0.24)
          );
          border-color: rgba(191, 246, 255, 0.78);
          transform: translateX(6px) scale(1.05);
          box-shadow:
            0 10px 22px rgba(var(--card-rgb), 0.14),
            0 0 14px rgba(var(--card-rgb), 0.16),
            inset 0 1px 0 rgba(255, 255, 255, 0.42),
            inset 0 0 22px rgba(var(--card-rgb), 0.18);
        }

        .launch-button:active {
          transform: translateY(-3px) scale(0.995);
        }

        /* Footer */
        .menu-footer {
          text-align: center;
          padding-top: 40px;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
          color: rgba(248, 250, 252, 0.6);
          font-size: 0.95rem;
          font-weight: 300;
          letter-spacing: 0.5px;
        }

        .coming-soon-overlay {
          position: fixed;
          inset: 0;
          z-index: 50;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
        }

        .coming-soon-backdrop {
          position: absolute;
          inset: 0;
          border: 0;
          background: rgba(2, 6, 23, 0.64);
          cursor: pointer;
        }

        .coming-soon-panel {
          position: relative;
          z-index: 1;
          width: min(420px, 100%);
          padding: 26px;
          border: 1px solid rgba(125, 249, 255, 0.2);
          border-radius: 18px;
          background: rgba(3, 7, 18, 0.86);
          color: #f8fafc;
          text-align: center;
          box-shadow: 0 24px 70px rgba(2, 8, 23, 0.55);
          backdrop-filter: blur(14px);
        }

        .coming-soon-panel span {
          display: block;
          margin-bottom: 10px;
          color: #67e8f9;
          font-size: 0.78rem;
          font-weight: 800;
          letter-spacing: 0.16em;
          text-transform: uppercase;
        }

        .coming-soon-panel strong {
          display: block;
          font-size: 1.45rem;
          margin-bottom: 10px;
        }

        .coming-soon-panel p {
          margin: 0 0 20px;
          color: rgba(226, 246, 255, 0.72);
        }

        .coming-soon-panel button {
          min-height: 40px;
          padding: 0 18px;
          border: 1px solid rgba(125, 249, 255, 0.28);
          border-radius: 12px;
          background: rgba(14, 165, 233, 0.16);
          color: #ecfeff;
          font-weight: 800;
          cursor: pointer;
        }

        /* Responsive */
        @media (max-width: 1024px) {
          .menu-container {
            gap: 40px;
          }

          .hero-section {
            padding: 28px 20px 14px;
          }

          .launch-button {
            padding: 18px;
            gap: 16px;
            min-height: 194px;
          }

          .button-icon {
            width: 58px;
            height: 58px;
          }

          .button-title {
            font-size: 1.12rem;
          }
        }

        @media (max-width: 768px) {
          .menu-root {
            padding: 22px 16px 28px;
          }

          .menu-container {
            gap: 34px;
          }

          .hero-section {
            padding: 22px 16px 8px;
          }

          .hero-title {
            font-size: clamp(2.9rem, 13vw, 4.7rem);
          }

          .hero-subtitle {
            font-size: 1rem;
          }

          .buttons-section {
            max-width: 520px;
            width: 100%;
            margin: 0 auto;
            grid-template-columns: 1fr;
            gap: 20px;
            padding: 0;
          }

          .launch-button {
            text-align: center;
            padding: 18px;
            gap: 14px;
            min-height: 188px;
          }

          .button-content {
            align-items: center;
            gap: 16px;
          }

          .button-icon {
            width: 64px;
            height: 64px;
          }

          .button-title {
            justify-content: center;
            font-size: 1.2rem;
          }

          .button-description {
            font-size: 0.95rem;
          }

          .button-arrow {
            align-self: center;
            min-height: 42px;
          }

          .glow-orb-1,
          .glow-orb-2 {
            filter: blur(60px);
            opacity: 0.06;
          }
        }

        @media (max-width: 480px) {
          .menu-root {
            padding: 18px 12px 24px;
          }

          .hero-title {
            font-size: clamp(2.35rem, 13vw, 3.4rem);
          }

          .launch-button {
            padding: 16px;
            min-height: 182px;
          }

          .button-icon {
            width: 52px;
            height: 52px;
          }
        }
      `}</style>
    </div>
  );
};

export default MenuScreen;
