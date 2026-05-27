"use client";

import React from "react";

interface Props {
  onClick: () => void;
  disabled?: boolean;
}

const StartButton: React.FC<Props> = ({ onClick, disabled = false }) => {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        position: "fixed",
        left: 16,
        bottom: 16,
        padding: "14px 24px",
        minWidth: 96,
        fontSize: 16,
        fontWeight: 700,
        background: "linear-gradient(135deg, #f97316, #ef4444)",
        color: "white",
        border: "none",
        borderRadius: 14,
        boxShadow: "0 18px 40px rgba(239, 68, 68, 0.25)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.65 : 1,
        touchAction: "manipulation",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      Start
    </button>
  );
};

export default StartButton;
