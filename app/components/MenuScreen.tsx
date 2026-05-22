"use client";

import React from "react";

interface Props {
  onLaunch: () => void;
}

const MenuScreen: React.FC<Props> = ({ onLaunch }) => {
  const menuItems = [
    {
      title: "Gravity Well",
      subtitle: "Physics Simulation",
      description:
        "Enter the bouncing ball arena. Experience dynamic collision physics with real-time rendering.",
      icon: (
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
      ),
      action: onLaunch,
      color: "from-blue-500/40 to-cyan-500/20",
      glow: "shadow-lg shadow-blue-500/20",
    },
  ];

  return (
    <div className="menu-root">
      {/* Animated glow background */}
      <div className="glow-orb glow-orb-1" />
      <div className="glow-orb glow-orb-2" />
      <div className="glow-orb glow-orb-3" />
      <div className="depth-layer depth-layer-1" />
      <div className="depth-layer depth-layer-2" />
      <div className="energy-orb-scene" aria-hidden="true">
        <div className="energy-orb-bloom" />
        <div className="energy-orb">
          <div className="orb-core" />
          <div className="orb-surface" />
          <div className="orb-highlight" />
        </div>
        <div className="orb-orbit orb-orbit-1">
          <span />
          <span />
          <span />
        </div>
        <div className="orb-orbit orb-orbit-2">
          <span />
          <span />
          <span />
        </div>
      </div>
      <div className="light-rays" />
      <div className="fog-layer fog-layer-1" />
      <div className="fog-layer fog-layer-2" />
      <div className="particle-field" aria-hidden="true">
        {Array.from({ length: 18 }).map((_, index) => (
          <span key={index} className="particle" />
        ))}
      </div>

      <div className="menu-container">
        {/* Hero Section */}
        <div className="hero-section">
          <div className="hero-accent" />
          <h1 className="hero-title">
            PHYSICS <span className="gradient-text">LAB</span>
          </h1>
          <p className="hero-subtitle">
            Interactive Simulation Playground
          </p>
          <div className="hero-divider" />
        </div>

        {/* Launch Button */}
        <div className="buttons-section">
          {menuItems.map((item) => (
            <button
              key={item.title}
              onClick={item.action}
              className={`launch-button ${item.glow}`}
            >
              <div className="button-glow" />
              <div className="button-content">
                <div className="button-icon">{item.icon}</div>
                <div className="button-text">
                  <div className="button-title">{item.title}</div>
                  <div className="button-subtitle">{item.subtitle}</div>
                  <div className="button-description">{item.description}</div>
                </div>
              </div>
              <div className="button-arrow">
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
      <style jsx>{`
        * {
          box-sizing: border-box;
        }

        .menu-root {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 40px 24px;
          background:
            radial-gradient(
              circle at 18% 16%,
              rgba(59, 130, 246, 0.18),
              transparent 32%
            ),
            radial-gradient(
              circle at 82% 74%,
              rgba(14, 165, 233, 0.12),
              transparent 30%
            ),
            linear-gradient(
              135deg,
              #070b20 0%,
              #170831 48%,
              #07182d 100%
            );
          background-size: 130% 130%, 120% 120%, 220% 220%;
          color: #f8fafc;
          overflow: hidden;
          position: relative;
          animation: livingGradient 24s ease-in-out infinite;
        }

        .menu-root::before,
        .menu-root::after {
          content: "";
          position: fixed;
          inset: -20%;
          pointer-events: none;
        }

        .menu-root::before {
          z-index: 0;
          background:
            radial-gradient(
              circle at 28% 34%,
              rgba(125, 249, 255, 0.1),
              transparent 30%
            ),
            radial-gradient(
              circle at 68% 18%,
              rgba(168, 85, 247, 0.12),
              transparent 28%
            ),
            radial-gradient(
              circle at 58% 78%,
              rgba(14, 165, 233, 0.1),
              transparent 34%
            );
          filter: blur(22px);
          opacity: 0.68;
          animation: ambientPulse 12s ease-in-out infinite;
        }

        .menu-root::after {
          z-index: 2;
          background:
            linear-gradient(
              106deg,
              transparent 16%,
              rgba(125, 249, 255, 0.055) 23%,
              transparent 31%,
              transparent 48%,
              rgba(255, 255, 255, 0.04) 55%,
              transparent 64%
            ),
            linear-gradient(
              74deg,
              transparent 34%,
              rgba(96, 165, 250, 0.045) 42%,
              transparent 50%
            );
          mix-blend-mode: screen;
          opacity: 0.46;
          transform: translate3d(-3%, 0, 0) rotate(-3deg);
          animation: raysDrift 28s ease-in-out infinite;
        }

        .glow-orb {
          position: fixed;
          border-radius: 50%;
          filter: blur(80px);
          opacity: 0.18;
          pointer-events: none;
          z-index: 1;
          animation:
            float 20s ease-in-out infinite,
            glowPulse 9s ease-in-out infinite;
        }

        .glow-orb-1 {
          width: 600px;
          height: 600px;
          background: radial-gradient(
            circle,
            rgba(59, 130, 246, 0.5),
            transparent
          );
          top: -200px;
          left: -200px;
          animation-delay: 0s;
        }

        .glow-orb-2 {
          width: 500px;
          height: 500px;
          background: radial-gradient(
            circle,
            rgba(168, 85, 247, 0.4),
            transparent
          );
          bottom: -150px;
          right: -150px;
          animation-delay: -8s;
        }

        .glow-orb-3 {
          width: 700px;
          height: 700px;
          background: radial-gradient(
            circle,
            rgba(34, 211, 238, 0.3),
            transparent
          );
          top: 50%;
          right: -300px;
          animation-delay: -4s;
        }

        .depth-layer,
        .fog-layer,
        .light-rays,
        .particle-field {
          position: fixed;
          inset: 0;
          pointer-events: none;
        }

        .depth-layer {
          z-index: 1;
          opacity: 0.18;
          mix-blend-mode: screen;
        }

        .depth-layer-1 {
          background-image:
            linear-gradient(
              rgba(255, 255, 255, 0.035) 1px,
              transparent 1px
            ),
            linear-gradient(
              90deg,
              rgba(255, 255, 255, 0.028) 1px,
              transparent 1px
            );
          background-size: 96px 96px;
          transform: perspective(800px) rotateX(58deg) scale(1.8);
          transform-origin: center bottom;
          animation: depthSlide 34s linear infinite;
        }

        .depth-layer-2 {
          background:
            radial-gradient(
              ellipse at 50% 120%,
              rgba(6, 182, 212, 0.16),
              transparent 48%
            ),
            linear-gradient(
              90deg,
              transparent,
              rgba(255, 255, 255, 0.04),
              transparent
            );
          filter: blur(10px);
          opacity: 0.24;
          animation: horizonBreath 14s ease-in-out infinite;
        }

        .energy-orb-scene {
          position: fixed;
          top: 46%;
          left: 50%;
          width: min(72vw, 780px);
          aspect-ratio: 1;
          pointer-events: none;
          transform: translate3d(-50%, -50%, 0);
          z-index: 2;
          opacity: 0.92;
          filter: saturate(128%);
          animation: orbSceneFloat 16s ease-in-out infinite;
        }

        .energy-orb-bloom {
          position: absolute;
          inset: -18%;
          border-radius: 50%;
          background:
            radial-gradient(
              circle,
              rgba(125, 249, 255, 0.28) 0%,
              rgba(96, 165, 250, 0.2) 30%,
              rgba(168, 85, 247, 0.16) 48%,
              transparent 72%
            );
          filter: blur(44px);
          opacity: 0.72;
          animation: orbBloomPulse 7s ease-in-out infinite;
        }

        .energy-orb {
          position: absolute;
          inset: 12%;
          border-radius: 50%;
          overflow: hidden;
          background:
            radial-gradient(
              circle at 34% 24%,
              rgba(255, 255, 255, 0.9),
              rgba(191, 246, 255, 0.34) 11%,
              transparent 22%
            ),
            radial-gradient(
              circle at 50% 52%,
              rgba(56, 189, 248, 0.52),
              rgba(59, 130, 246, 0.34) 38%,
              rgba(88, 28, 135, 0.46) 68%,
              rgba(2, 6, 23, 0.82) 100%
            );
          box-shadow:
            0 0 46px rgba(125, 249, 255, 0.52),
            0 0 110px rgba(59, 130, 246, 0.34),
            0 0 190px rgba(168, 85, 247, 0.22),
            inset -34px -48px 92px rgba(2, 6, 23, 0.64),
            inset 26px 20px 58px rgba(255, 255, 255, 0.16);
          transform: rotate(-8deg);
          animation: orbRotate 28s linear infinite;
        }

        .energy-orb::before,
        .energy-orb::after {
          content: "";
          position: absolute;
          inset: -18%;
          border-radius: 50%;
          mix-blend-mode: screen;
          pointer-events: none;
        }

        .energy-orb::before {
          background:
            conic-gradient(
              from 20deg,
              rgba(125, 249, 255, 0.08),
              rgba(59, 130, 246, 0.38),
              rgba(168, 85, 247, 0.32),
              rgba(236, 72, 153, 0.12),
              rgba(125, 249, 255, 0.42),
              rgba(59, 130, 246, 0.18),
              rgba(125, 249, 255, 0.08)
            );
          filter: blur(10px);
          opacity: 0.86;
          animation: plasmaSpin 12s linear infinite;
        }

        .energy-orb::after {
          background:
            repeating-conic-gradient(
              from 0deg,
              rgba(255, 255, 255, 0.18) 0deg,
              transparent 9deg,
              rgba(125, 249, 255, 0.11) 18deg,
              transparent 31deg
            );
          filter: blur(15px);
          opacity: 0.42;
          animation: plasmaSpin 18s linear infinite reverse;
        }

        .orb-core,
        .orb-surface,
        .orb-highlight {
          position: absolute;
          inset: 0;
          border-radius: inherit;
          pointer-events: none;
        }

        .orb-core {
          background:
            radial-gradient(
              circle at 48% 46%,
              rgba(255, 255, 255, 0.34),
              rgba(125, 249, 255, 0.2) 14%,
              rgba(37, 99, 235, 0.18) 36%,
              transparent 62%
            );
          filter: blur(12px);
          animation: orbCorePulse 6s ease-in-out infinite;
        }

        .orb-surface {
          background:
            radial-gradient(
              ellipse at 34% 58%,
              rgba(34, 211, 238, 0.28),
              transparent 34%
            ),
            radial-gradient(
              ellipse at 72% 36%,
              rgba(168, 85, 247, 0.34),
              transparent 32%
            ),
            linear-gradient(
              115deg,
              transparent 18%,
              rgba(255, 255, 255, 0.14) 28%,
              transparent 40%,
              transparent 62%,
              rgba(125, 249, 255, 0.12) 72%,
              transparent 82%
            );
          background-size: 120% 120%, 130% 130%, 190% 190%;
          filter: blur(3px);
          opacity: 0.86;
          animation: plasmaSurface 10s ease-in-out infinite;
        }

        .orb-highlight {
          background:
            radial-gradient(
              circle at 28% 22%,
              rgba(255, 255, 255, 0.46),
              rgba(255, 255, 255, 0.12) 14%,
              transparent 28%
            ),
            linear-gradient(
              150deg,
              rgba(255, 255, 255, 0.2),
              transparent 34%
            );
          opacity: 0.78;
          mix-blend-mode: screen;
        }

        .orb-orbit {
          position: absolute;
          inset: 3%;
          border-radius: 50%;
          border: 1px solid rgba(125, 249, 255, 0.13);
          transform-style: preserve-3d;
          filter:
            drop-shadow(0 0 12px rgba(125, 249, 255, 0.36))
            drop-shadow(0 0 26px rgba(168, 85, 247, 0.24));
        }

        .orb-orbit-1 {
          animation: orbitRotateOne 13s linear infinite;
        }

        .orb-orbit-2 {
          inset: 9%;
          border-color: rgba(168, 85, 247, 0.14);
          animation: orbitRotateTwo 19s linear infinite reverse;
        }

        .orb-orbit span {
          position: absolute;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #dffbff;
          box-shadow:
            0 0 10px rgba(255, 255, 255, 0.9),
            0 0 24px rgba(125, 249, 255, 0.8),
            0 0 48px rgba(59, 130, 246, 0.5);
        }

        .orb-orbit span:nth-child(1) {
          top: 8%;
          left: 50%;
        }

        .orb-orbit span:nth-child(2) {
          top: 62%;
          left: 8%;
          width: 5px;
          height: 5px;
          opacity: 0.72;
        }

        .orb-orbit span:nth-child(3) {
          right: 10%;
          bottom: 18%;
          width: 6px;
          height: 6px;
          opacity: 0.84;
        }

        .light-rays {
          z-index: 2;
          background:
            conic-gradient(
              from 210deg at 50% -18%,
              transparent 0deg,
              rgba(125, 249, 255, 0.075) 12deg,
              transparent 24deg,
              transparent 38deg,
              rgba(255, 255, 255, 0.04) 52deg,
              transparent 70deg,
              transparent 360deg
            );
          opacity: 0.36;
          filter: blur(18px);
          transform: scale(1.18);
          animation: raySweep 32s ease-in-out infinite;
        }

        .fog-layer {
          z-index: 3;
          opacity: 0.28;
          filter: blur(28px);
          mix-blend-mode: screen;
        }

        .fog-layer-1 {
          background:
            radial-gradient(
              ellipse at 12% 72%,
              rgba(148, 163, 184, 0.16),
              transparent 34%
            ),
            radial-gradient(
              ellipse at 72% 62%,
              rgba(56, 189, 248, 0.11),
              transparent 30%
            );
          animation: fogDriftOne 36s ease-in-out infinite;
        }

        .fog-layer-2 {
          background:
            radial-gradient(
              ellipse at 44% 34%,
              rgba(255, 255, 255, 0.09),
              transparent 28%
            ),
            radial-gradient(
              ellipse at 88% 22%,
              rgba(168, 85, 247, 0.11),
              transparent 30%
            );
          opacity: 0.18;
          animation: fogDriftTwo 46s ease-in-out infinite;
        }

        .particle-field {
          z-index: 4;
          overflow: hidden;
        }

        .particle {
          position: absolute;
          width: 3px;
          height: 3px;
          border-radius: 50%;
          background: rgba(191, 246, 255, 0.88);
          box-shadow:
            0 0 10px rgba(125, 249, 255, 0.7),
            0 0 22px rgba(59, 130, 246, 0.28);
          opacity: 0;
          animation: particleFloat 18s ease-in-out infinite;
        }

        .particle:nth-child(1) {
          left: 8%;
          top: 82%;
          animation-delay: -1s;
          animation-duration: 22s;
        }

        .particle:nth-child(2) {
          left: 18%;
          top: 64%;
          animation-delay: -8s;
          animation-duration: 24s;
        }

        .particle:nth-child(3) {
          left: 26%;
          top: 78%;
          animation-delay: -13s;
          animation-duration: 20s;
        }

        .particle:nth-child(4) {
          left: 34%;
          top: 54%;
          animation-delay: -4s;
          animation-duration: 26s;
        }

        .particle:nth-child(5) {
          left: 42%;
          top: 88%;
          animation-delay: -16s;
          animation-duration: 23s;
        }

        .particle:nth-child(6) {
          left: 52%;
          top: 68%;
          animation-delay: -6s;
          animation-duration: 21s;
        }

        .particle:nth-child(7) {
          left: 62%;
          top: 80%;
          animation-delay: -11s;
          animation-duration: 25s;
        }

        .particle:nth-child(8) {
          left: 72%;
          top: 58%;
          animation-delay: -3s;
          animation-duration: 27s;
        }

        .particle:nth-child(9) {
          left: 84%;
          top: 76%;
          animation-delay: -15s;
          animation-duration: 22s;
        }

        .particle:nth-child(10) {
          left: 92%;
          top: 64%;
          animation-delay: -9s;
          animation-duration: 24s;
        }

        .particle:nth-child(11) {
          left: 12%;
          top: 42%;
          animation-delay: -17s;
          animation-duration: 29s;
        }

        .particle:nth-child(12) {
          left: 24%;
          top: 28%;
          animation-delay: -5s;
          animation-duration: 31s;
        }

        .particle:nth-child(13) {
          left: 47%;
          top: 24%;
          animation-delay: -19s;
          animation-duration: 28s;
        }

        .particle:nth-child(14) {
          left: 66%;
          top: 36%;
          animation-delay: -12s;
          animation-duration: 30s;
        }

        .particle:nth-child(15) {
          left: 79%;
          top: 18%;
          animation-delay: -7s;
          animation-duration: 27s;
        }

        .particle:nth-child(16) {
          left: 88%;
          top: 44%;
          animation-delay: -21s;
          animation-duration: 32s;
        }

        .particle:nth-child(17) {
          left: 38%;
          top: 16%;
          animation-delay: -10s;
          animation-duration: 26s;
        }

        .particle:nth-child(18) {
          left: 58%;
          top: 12%;
          animation-delay: -2s;
          animation-duration: 33s;
        }

        @keyframes livingGradient {
          0%,
          100% {
            background-position: 0% 40%, 100% 60%, 0% 50%;
          }
          50% {
            background-position: 100% 52%, 0% 42%, 100% 50%;
          }
        }

        @keyframes ambientPulse {
          0%,
          100% {
            opacity: 0.5;
            transform: scale(1) translate3d(0, 0, 0);
          }
          50% {
            opacity: 0.78;
            transform: scale(1.08) translate3d(2%, -2%, 0);
          }
        }

        @keyframes glowPulse {
          0%,
          100% {
            opacity: 0.14;
            filter: blur(80px);
          }
          50% {
            opacity: 0.24;
            filter: blur(88px);
          }
        }

        @keyframes raysDrift {
          0%,
          100% {
            transform: translate3d(-4%, 0, 0) rotate(-4deg);
            opacity: 0.36;
          }
          50% {
            transform: translate3d(4%, 2%, 0) rotate(2deg);
            opacity: 0.52;
          }
        }

        @keyframes raySweep {
          0%,
          100% {
            transform: translate3d(-2%, -1%, 0) scale(1.18) rotate(-3deg);
            opacity: 0.28;
          }
          50% {
            transform: translate3d(2%, 1%, 0) scale(1.22) rotate(3deg);
            opacity: 0.42;
          }
        }

        @keyframes depthSlide {
          0% {
            background-position: 0 0, 0 0;
          }
          100% {
            background-position: 0 192px, 192px 0;
          }
        }

        @keyframes horizonBreath {
          0%,
          100% {
            transform: translateY(1%) scaleX(1);
            opacity: 0.16;
          }
          50% {
            transform: translateY(-1%) scaleX(1.08);
            opacity: 0.28;
          }
        }

        @keyframes fogDriftOne {
          0%,
          100% {
            transform: translate3d(-4%, 2%, 0) scale(1.08);
          }
          50% {
            transform: translate3d(6%, -1%, 0) scale(1.16);
          }
        }

        @keyframes fogDriftTwo {
          0%,
          100% {
            transform: translate3d(5%, -3%, 0) scale(1.12);
          }
          50% {
            transform: translate3d(-6%, 3%, 0) scale(1.2);
          }
        }

        @keyframes particleFloat {
          0% {
            opacity: 0;
            transform: translate3d(0, 30px, 0) scale(0.55);
          }
          18% {
            opacity: 0.58;
          }
          62% {
            opacity: 0.32;
          }
          100% {
            opacity: 0;
            transform: translate3d(38px, -160px, 0) scale(1.08);
          }
        }

        @keyframes orbSceneFloat {
          0%,
          100% {
            transform: translate3d(-50%, -50%, 0) scale(1);
          }
          50% {
            transform: translate3d(-50%, -53%, 0) scale(1.025);
          }
        }

        @keyframes orbBloomPulse {
          0%,
          100% {
            opacity: 0.56;
            transform: scale(0.96);
          }
          50% {
            opacity: 0.88;
            transform: scale(1.07);
          }
        }

        @keyframes orbRotate {
          0% {
            transform: rotate(-8deg);
          }
          100% {
            transform: rotate(352deg);
          }
        }

        @keyframes plasmaSpin {
          0% {
            transform: rotate(0deg) scale(1.08);
          }
          100% {
            transform: rotate(360deg) scale(1.08);
          }
        }

        @keyframes orbCorePulse {
          0%,
          100% {
            opacity: 0.7;
            transform: scale(0.92);
          }
          50% {
            opacity: 1;
            transform: scale(1.08);
          }
        }

        @keyframes plasmaSurface {
          0%,
          100% {
            background-position: 0% 48%, 100% 52%, 0% 50%;
            opacity: 0.68;
          }
          50% {
            background-position: 100% 52%, 0% 45%, 100% 50%;
            opacity: 0.92;
          }
        }

        @keyframes orbitRotateOne {
          0% {
            transform: rotateX(62deg) rotateZ(0deg);
          }
          100% {
            transform: rotateX(62deg) rotateZ(360deg);
          }
        }

        @keyframes orbitRotateTwo {
          0% {
            transform: rotateX(70deg) rotateY(18deg) rotateZ(0deg);
          }
          100% {
            transform: rotateX(70deg) rotateY(18deg) rotateZ(360deg);
          }
        }

        @keyframes float {
          0%,
          100% {
            transform: translate(0, 0);
          }
          25% {
            transform: translate(30px, -30px);
          }
          50% {
            transform: translate(-20px, 20px);
          }
          75% {
            transform: translate(40px, 10px);
          }
        }

        .menu-container {
          max-width: 1200px;
          width: 100%;
          display: flex;
          flex-direction: column;
          gap: 80px;
          position: relative;
          z-index: 10;
        }

        /* Hero Section */
        .hero-section {
          text-align: center;
          position: relative;
          padding: 72px 40px 58px;
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
          filter: blur(2px);
          box-shadow:
            0 0 28px rgba(6, 182, 212, 0.6),
            0 0 52px rgba(59, 130, 246, 0.34);
          animation: titleAccentPulse 5s ease-in-out infinite;
        }

        .hero-title {
          position: relative;
          margin: 26px 0 0 0;
          font-family:
            "Geist Mono", "SFMono-Regular", "Roboto Mono", "Orbitron",
            monospace;
          font-size: clamp(4.6rem, 13vw, 10.75rem);
          line-height: 0.88;
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
          filter:
            drop-shadow(0 0 24px rgba(125, 249, 255, 0.34))
            drop-shadow(0 18px 46px rgba(2, 8, 23, 0.9));
          text-shadow:
            0 0 18px rgba(125, 249, 255, 0.28),
            0 0 56px rgba(59, 130, 246, 0.28);
          animation:
            titleGradientShift 9s ease-in-out infinite,
            titleFloat 7s ease-in-out infinite;
        }

        .hero-title::before {
          content: "PHYSICS LAB";
          position: absolute;
          inset: 0;
          z-index: -1;
          color: transparent;
          -webkit-text-stroke: 1px rgba(125, 249, 255, 0.18);
          transform: translate3d(0, 10px, 0) scale(1.01);
          filter: blur(12px);
          opacity: 0.62;
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
          animation: titleGradientShift 6s ease-in-out infinite reverse;
        }

        .hero-subtitle {
          margin: 30px 0 0 0;
          font-family:
            "Geist Mono", "SFMono-Regular", "Roboto Mono", monospace;
          font-size: clamp(1rem, 2vw, 1.45rem);
          color: rgba(226, 246, 255, 0.86);
          line-height: 1.5;
          max-width: 700px;
          margin-left: auto;
          margin-right: auto;
          font-weight: 500;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          text-shadow:
            0 0 18px rgba(6, 182, 212, 0.34),
            0 8px 24px rgba(2, 8, 23, 0.72);
          animation: subtitleGlow 6s ease-in-out infinite;
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
          margin: 44px auto 0;
          border-radius: 999px;
          box-shadow: 0 0 26px rgba(6, 182, 212, 0.46);
          animation: dividerBreathe 5.5s ease-in-out infinite;
        }

        @keyframes titleGradientShift {
          0%,
          100% {
            background-position: 0% 50%;
          }
          50% {
            background-position: 100% 50%;
          }
        }

        @keyframes titleFloat {
          0%,
          100% {
            transform: translate3d(0, 0, 0);
          }
          50% {
            transform: translate3d(0, -6px, 0);
          }
        }

        @keyframes subtitleGlow {
          0%,
          100% {
            opacity: 0.78;
          }
          50% {
            opacity: 1;
          }
        }

        @keyframes titleAccentPulse {
          0%,
          100% {
            transform: translateX(-50%) scaleX(0.82);
            opacity: 0.66;
          }
          50% {
            transform: translateX(-50%) scaleX(1.18);
            opacity: 1;
          }
        }

        @keyframes dividerBreathe {
          0%,
          100% {
            width: 60px;
            opacity: 0.72;
          }
          50% {
            width: 140px;
            opacity: 1;
          }
        }

        /* Buttons Section */
        .buttons-section {
          display: flex;
          flex-direction: column;
          gap: 32px;
          padding: 0 20px;
        }

        .launch-button {
          position: relative;
          display: flex;
          align-items: center;
          gap: 28px;
          padding: 36px 40px;
          border: none;
          border-radius: 24px;
          background:
            linear-gradient(
              135deg,
              rgba(255, 255, 255, 0.16) 0%,
              rgba(255, 255, 255, 0.04) 18%,
              rgba(15, 23, 42, 0.7) 44%,
              rgba(3, 7, 18, 0.86) 100%
            ),
            linear-gradient(
              120deg,
              rgba(34, 211, 238, 0.24),
              rgba(99, 102, 241, 0.18),
              rgba(236, 72, 153, 0.12),
              rgba(34, 211, 238, 0.24)
            );
          background-size: 100% 100%, 220% 220%;
          backdrop-filter: blur(26px) saturate(160%);
          -webkit-backdrop-filter: blur(26px) saturate(160%);
          border: 1px solid rgba(179, 229, 252, 0.32);
          color: #f8fafc;
          cursor: pointer;
          transition:
            transform 0.45s cubic-bezier(0.22, 1, 0.36, 1),
            border-color 0.45s ease,
            box-shadow 0.45s ease,
            background-position 5s ease;
          text-align: left;
          overflow: hidden;
          isolation: isolate;
          box-shadow:
            0 24px 70px rgba(2, 8, 23, 0.58),
            0 12px 32px rgba(8, 145, 178, 0.16),
            0 0 34px rgba(59, 130, 246, 0.28),
            inset 0 1px 0 rgba(255, 255, 255, 0.28),
            inset 0 -26px 46px rgba(15, 23, 42, 0.48);
          animation: buttonGradientDrift 8s ease-in-out infinite;
        }

        .launch-button::before {
          content: "";
          position: absolute;
          inset: 0;
          padding: 1px;
          border-radius: inherit;
          background:
            linear-gradient(
              115deg,
              transparent 0%,
              transparent 28%,
              rgba(125, 249, 255, 0.18) 38%,
              rgba(255, 255, 255, 0.92) 50%,
              rgba(236, 72, 153, 0.28) 60%,
              transparent 72%,
              transparent 100%
            ),
            linear-gradient(
              135deg,
              rgba(125, 249, 255, 0.85),
              rgba(99, 102, 241, 0.44),
              rgba(236, 72, 153, 0.42),
              rgba(125, 249, 255, 0.72)
            );
          background-size: 240% 240%, 100% 100%;
          background-position: -140% 0, 0 0;
          opacity: 0.8;
          -webkit-mask:
            linear-gradient(#000 0 0) content-box,
            linear-gradient(#000 0 0);
          -webkit-mask-composite: xor;
          mask-composite: exclude;
          pointer-events: none;
          animation: borderLightSweep 3.8s linear infinite;
          z-index: 1;
        }

        .launch-button::after {
          content: "";
          position: absolute;
          inset: 1px;
          border-radius: inherit;
          background:
            linear-gradient(
              155deg,
              rgba(255, 255, 255, 0.32) 0%,
              rgba(255, 255, 255, 0.08) 18%,
              transparent 36%
            ),
            radial-gradient(
              circle at 18% 12%,
              rgba(255, 255, 255, 0.28),
              transparent 28%
            ),
            radial-gradient(
              circle at 85% 90%,
              rgba(34, 211, 238, 0.22),
              transparent 34%
            );
          opacity: 0.72;
          pointer-events: none;
          mix-blend-mode: screen;
          z-index: 1;
        }

        .launch-button:hover {
          transform: translateY(-8px) scale(1.035);
          border-color: rgba(191, 246, 255, 0.82);
          background-position: 0 0, 100% 50%;
          box-shadow:
            0 34px 92px rgba(2, 8, 23, 0.72),
            0 20px 58px rgba(6, 182, 212, 0.28),
            0 0 44px rgba(59, 130, 246, 0.58),
            0 0 92px rgba(6, 182, 212, 0.34),
            inset 0 1px 0 rgba(255, 255, 255, 0.42),
            inset 0 0 34px rgba(125, 249, 255, 0.18),
            inset 0 -28px 54px rgba(15, 23, 42, 0.54);
        }

        .launch-button:hover::before {
          opacity: 1;
          animation-duration: 1.6s;
        }

        .button-glow {
          position: absolute;
          inset: -30%;
          border-radius: 32px;
          background:
            radial-gradient(
              circle at 50% 45%,
              rgba(125, 249, 255, 0.42),
              transparent 35%
            ),
            radial-gradient(
              circle at 18% 20%,
              rgba(59, 130, 246, 0.38),
              transparent 32%
            ),
            radial-gradient(
              circle at 82% 70%,
              rgba(236, 72, 153, 0.2),
              transparent 30%
            );
          opacity: 0.45;
          filter: blur(18px);
          transform: translate3d(-3%, -2%, 0);
          transition:
            opacity 0.45s ease,
            transform 0.45s ease,
            filter 0.45s ease;
          pointer-events: none;
          animation: glowDrift 7s ease-in-out infinite;
          z-index: 0;
        }

        .launch-button:hover .button-glow {
          opacity: 0.95;
          filter: blur(14px);
          transform: translate3d(3%, 2%, 0) scale(1.08);
        }

        .button-content {
          display: flex;
          align-items: center;
          gap: 28px;
          flex: 1;
          position: relative;
          z-index: 2;
        }

        .button-icon {
          flex-shrink: 0;
          width: 80px;
          height: 80px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 20px;
          background: linear-gradient(
            135deg,
            rgba(255, 255, 255, 0.18),
            rgba(59, 130, 246, 0.2) 42%,
            rgba(6, 182, 212, 0.12)
          );
          border: 1px solid rgba(125, 249, 255, 0.42);
          color: #7dd3fc;
          transition:
            transform 0.45s cubic-bezier(0.22, 1, 0.36, 1),
            border-color 0.45s ease,
            box-shadow 0.45s ease,
            color 0.45s ease;
          box-shadow:
            0 14px 34px rgba(6, 182, 212, 0.16),
            inset 0 1px 0 rgba(255, 255, 255, 0.3),
            inset 0 0 22px rgba(125, 249, 255, 0.08);
        }

        .launch-button:hover .button-icon {
          background: linear-gradient(
            135deg,
            rgba(255, 255, 255, 0.26),
            rgba(59, 130, 246, 0.36),
            rgba(6, 182, 212, 0.24)
          );
          border-color: rgba(191, 246, 255, 0.8);
          color: #e0faff;
          transform: scale(1.12) rotate(-2deg);
          box-shadow:
            0 18px 42px rgba(6, 182, 212, 0.3),
            0 0 32px rgba(125, 249, 255, 0.34),
            inset 0 1px 0 rgba(255, 255, 255, 0.42),
            inset 0 0 28px rgba(125, 249, 255, 0.2);
        }

        .button-text {
          flex: 1;
          min-width: 0;
        }

        .button-title {
          font-size: 1.6rem;
          font-weight: 800;
          margin-bottom: 8px;
          letter-spacing: 0;
          text-shadow:
            0 0 18px rgba(125, 249, 255, 0.28),
            0 2px 18px rgba(2, 8, 23, 0.7);
        }

        .button-subtitle {
          font-size: 0.95rem;
          color: #06b6d4;
          font-weight: 600;
          margin-bottom: 10px;
          text-transform: uppercase;
          letter-spacing: 1px;
        }

        .button-description {
          font-size: 1.05rem;
          color: rgba(248, 250, 252, 0.75);
          line-height: 1.6;
          font-weight: 300;
        }

        .button-arrow {
          flex-shrink: 0;
          width: 48px;
          height: 48px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 16px;
          background: linear-gradient(
            135deg,
            rgba(255, 255, 255, 0.18),
            rgba(6, 182, 212, 0.22),
            rgba(59, 130, 246, 0.12)
          );
          border: 1px solid rgba(125, 249, 255, 0.38);
          color: #67e8f9;
          transition:
            transform 0.45s cubic-bezier(0.22, 1, 0.36, 1),
            border-color 0.45s ease,
            box-shadow 0.45s ease,
            background 0.45s ease;
          position: relative;
          z-index: 2;
          box-shadow:
            0 12px 28px rgba(6, 182, 212, 0.14),
            inset 0 1px 0 rgba(255, 255, 255, 0.26),
            inset 0 0 18px rgba(125, 249, 255, 0.08);
        }

        .button-arrow svg {
          width: 24px;
          height: 24px;
          stroke-width: 2;
        }

        .launch-button:hover .button-arrow {
          background: linear-gradient(
            135deg,
            rgba(255, 255, 255, 0.26),
            rgba(6, 182, 212, 0.42),
            rgba(59, 130, 246, 0.24)
          );
          border-color: rgba(191, 246, 255, 0.78);
          transform: translateX(10px) scale(1.08);
          box-shadow:
            0 16px 36px rgba(6, 182, 212, 0.28),
            0 0 28px rgba(125, 249, 255, 0.34),
            inset 0 1px 0 rgba(255, 255, 255, 0.42),
            inset 0 0 22px rgba(125, 249, 255, 0.18);
        }

        .launch-button:active {
          transform: translateY(-3px) scale(0.995);
        }

        @keyframes buttonGradientDrift {
          0%,
          100% {
            background-position: 0 0, 0% 50%;
          }
          50% {
            background-position: 0 0, 100% 50%;
          }
        }

        @keyframes borderLightSweep {
          0% {
            background-position: -180% 0, 0 0;
          }
          100% {
            background-position: 180% 0, 0 0;
          }
        }

        @keyframes glowDrift {
          0%,
          100% {
            transform: translate3d(-3%, -2%, 0);
          }
          50% {
            transform: translate3d(3%, 2%, 0);
          }
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

        /* Responsive */
        @media (max-width: 1024px) {
          .menu-container {
            gap: 60px;
          }

          .hero-section {
            padding: 40px 20px;
          }

          .launch-button {
            padding: 28px 32px;
            gap: 20px;
          }

          .button-icon {
            width: 70px;
            height: 70px;
          }

          .button-title {
            font-size: 1.4rem;
          }
        }

        @media (max-width: 768px) {
          .menu-root {
            padding: 30px 16px;
          }

          .menu-container {
            gap: 50px;
          }

          .hero-section {
            padding: 30px 16px;
          }

          .hero-title {
            font-size: clamp(3rem, 15vw, 5rem);
          }

          .hero-subtitle {
            font-size: 1rem;
          }

          .buttons-section {
            gap: 24px;
            padding: 0;
          }

          .launch-button {
            flex-direction: column;
            text-align: center;
            padding: 24px 20px;
            gap: 16px;
          }

          .button-content {
            flex-direction: column;
            gap: 16px;
          }

          .button-icon {
            width: 64px;
            height: 64px;
          }

          .button-title {
            font-size: 1.2rem;
          }

          .button-description {
            font-size: 0.95rem;
          }

          .button-arrow {
            width: 40px;
            height: 40px;
          }

          .glow-orb-1,
          .glow-orb-2,
          .glow-orb-3 {
            filter: blur(60px);
            opacity: 0.1;
          }

          .energy-orb-scene {
            width: min(96vw, 560px);
            top: 42%;
            opacity: 0.78;
          }
        }

        @media (max-width: 480px) {
          .menu-root {
            padding: 20px 12px;
          }

          .hero-title {
            font-size: clamp(2.55rem, 14vw, 3.9rem);
          }

          .launch-button {
            padding: 20px 16px;
          }

          .button-icon {
            width: 56px;
            height: 56px;
          }
        }
      `}</style>
    </div>
  );
};

export default MenuScreen;
