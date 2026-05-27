"use client";

import React, { useState, useEffect } from "react";

interface Props {
  startTime: number | null;
  collisions: number[];
}

const TimePanel: React.FC<Props> = ({ startTime, collisions }) => {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      if (startTime) {
        const now = Date.now();
        const milliseconds = now - startTime;
        setElapsed(milliseconds / 1000);
      } else {
        setElapsed(0);
      }
    }, 10); // Update every 10ms for better precision

    return () => clearInterval(interval);
  }, [startTime]);

  const formatTime = (totalSeconds: number) => {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    const milliseconds = Math.floor((totalSeconds % 1) * 100);
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}:${String(milliseconds).padStart(2, "0")}`;
  };

  return (
    <div
      style={{
        position: "fixed",
        right: 16,
        top: 16,
        background: "rgba(15, 23, 42, 0.78)",
        border: "1px solid rgba(255,255,255,0.12)",
        padding: 16,
        borderRadius: 18,
        fontFamily: "monospace",
        fontSize: 14,
        fontWeight: 600,
        maxHeight: "80vh",
        overflowY: "auto",
        minWidth: 220,
        boxShadow: "0 24px 60px rgba(15, 23, 42, 0.35)",
        backdropFilter: "blur(20px)",
      }}
    >
      <div
        style={{
          marginBottom: 14,
          paddingBottom: 10,
          borderBottom: "1px solid rgba(255,255,255,0.12)",
        }}
      >
        Time: {formatTime(elapsed)}
      </div>
      <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 8 }}>
        Collisions:
      </div>
      <div style={{ fontSize: 12 }}>
        {collisions.length === 0 ? (
          <div style={{ color: "#999" }}>No collisions yet</div>
        ) : (
          collisions.map((collision, idx) => (
            <div key={idx} style={{ marginBottom: 6, paddingLeft: 8 }}>
              collision {idx + 1} : {formatTime(collision)}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default TimePanel;
