"use client";

import React from "react";

interface Props {
  onClick: () => void;
  disabled?: boolean;
}

const ResetButton: React.FC<Props> = ({ onClick, disabled = false }) => {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        position: "fixed",
        left: 16,
        bottom: 84,
        padding: "14px 24px",
        minWidth: 96,
        fontSize: 16,
        fontWeight: 700,
        background: "linear-gradient(135deg, #6366f1, #4338ca)",
        color: "white",
        border: "none",
        borderRadius: 14,
        boxShadow: "0 18px 40px rgba(67, 56, 202, 0.2)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.65 : 1,
        touchAction: "manipulation",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      Reset
    </button>
  );
};

export default ResetButton;
