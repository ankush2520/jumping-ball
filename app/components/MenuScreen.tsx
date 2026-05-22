"use client";

import React from "react";

interface Props {
  onLaunch: () => void;
}

const MenuScreen: React.FC<Props> = ({ onLaunch }) => {
  const menuItems = [
    {
      title: "Ball Playground",
      description: "Launch the colorful bouncing ball simulation.",
      icon: (
        <svg
          viewBox="0 0 64 64"
          width="36"
          height="36"
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="32" cy="32" r="16" fill="currentColor" opacity="0.2" />
          <path d="M22 22l20 20M42 22L22 42" />
        </svg>
      ),
      action: onLaunch,
    },
    {
      title: "Visual Wave",
      description: "Feel the motion with soothing colors and glow.",
      icon: (
        <svg
          viewBox="0 0 64 64"
          width="36"
          height="36"
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M14 32c6-10 14 10 18 0s12-10 18 0" />
          <path d="M10 18c8-8 16 8 22 0s12-8 22 0" opacity="0.75" />
        </svg>
      ),
      action: onLaunch,
    },
    {
      title: "Glow Orbit",
      description: "Step into the glowing circular arena.",
      icon: (
        <svg
          viewBox="0 0 64 64"
          width="36"
          height="36"
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="32" cy="32" r="20" />
          <circle cx="32" cy="32" r="8" fill="currentColor" opacity="0.18" />
        </svg>
      ),
      action: onLaunch,
    },
  ];

  return (
    <div className="menu-root">
      <div className="menu-grid">
        <div className="menu-list">
          {menuItems.map((item) => (
            <button
              key={item.title}
              onClick={item.action}
              className="menu-button"
            >
              <span className="menu-icon">{item.icon}</span>
              <div className="menu-text">
                <div className="menu-title">{item.title}</div>
                <div className="menu-description">{item.description}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
      <style jsx>{`
        .menu-root {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          background:
            radial-gradient(
              circle at top left,
              rgba(59, 130, 246, 0.16),
              transparent 20%
            ),
            radial-gradient(
              circle at bottom right,
              rgba(236, 72, 153, 0.16),
              transparent 24%
            ),
            linear-gradient(180deg, #020617 0%, #0f172a 100%);
          color: #f8fafc;
        }

        .menu-grid {
          max-width: 960px;
          width: 100%;
          display: grid;
          grid-template-columns: 1.2fr 1fr;
          gap: 24px;
          align-items: center;
        }

        .hero-card {
          padding: 28px;
          border-radius: 28px;
          background: rgba(15, 23, 42, 0.9);
          border: 1px solid rgba(255, 255, 255, 0.08);
          box-shadow: 0 32px 80px rgba(15, 23, 42, 0.45);
        }

        .hero-title {
          margin-bottom: 18px;
          font-size: clamp(2.4rem, 4vw, 3.6rem);
          line-height: 1.05;
          font-weight: 800;
        }

        .hero-copy {
          margin-bottom: 24px;
          font-size: 1rem;
          color: rgba(248, 250, 252, 0.78);
          line-height: 1.8;
        }

        .tag-row {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
        }

        .tag-pill {
          padding: 10px 16px;
          background: rgba(255, 255, 255, 0.08);
          border-radius: 999px;
          font-size: 0.92rem;
        }

        .menu-list {
          display: grid;
          gap: 18px;
        }

        .menu-button {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 18px 20px;
          width: 100%;
          border-radius: 22px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          background: rgba(255, 255, 255, 0.04);
          color: #f8fafc;
          text-align: left;
          cursor: pointer;
          transition:
            transform 0.18s ease,
            background 0.18s ease;
        }

        .menu-button:hover,
        .menu-button:focus-visible {
          transform: translateY(-2px);
          background: rgba(255, 255, 255, 0.08);
          outline: none;
        }

        .menu-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 52px;
          height: 52px;
          border-radius: 18px;
          background: rgba(255, 255, 255, 0.08);
          flex-shrink: 0;
        }

        .menu-text {
          flex: 1;
          min-width: 0;
        }

        .menu-title,
        .hero-copy,
        .menu-description {
          overflow-wrap: anywhere;
          word-break: break-word;
        }

        .menu-title {
          font-size: 1.05rem;
          font-weight: 700;
          margin-bottom: 4px;
        }

        .menu-description {
          color: rgba(248, 250, 252, 0.75);
          font-size: 0.95rem;
          line-height: 1.5;
        }

        @media (max-width: 860px) {
          .menu-grid {
            grid-template-columns: 1fr;
          }

          .hero-card {
            order: 2;
          }
        }

        @media (max-width: 640px) {
          .menu-root {
            padding: 18px;
          }

          .hero-card,
          .menu-button {
            padding: 20px;
            border-radius: 24px;
          }

          .menu-button {
            gap: 14px;
            padding: 20px;
          }

          .menu-icon {
            width: 48px;
            height: 48px;
          }

          .hero-title {
            font-size: clamp(2.2rem, 8vw, 3rem);
          }

          .hero-copy {
            font-size: 0.98rem;
          }
        }

        @media (max-width: 480px) {
          .menu-root {
            padding: 14px;
          }

          .menu-button {
            flex-direction: column;
            align-items: stretch;
            text-align: left;
          }

          .menu-icon {
            margin-bottom: 12px;
          }

          .menu-title {
            font-size: 1.08rem;
          }

          .menu-description {
            font-size: 0.95rem;
          }
        }
      `}</style>
    </div>
  );
};

export default MenuScreen;
