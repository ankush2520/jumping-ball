'use client'

import React from 'react'

interface Props {
  onClick: () => void
  disabled?: boolean
}

const StartButton: React.FC<Props> = ({ onClick, disabled = false }) => {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        position: 'fixed',
        left: 12,
        top: 12,
        padding: '10px 20px',
        minWidth: 80,
        fontSize: 14,
        fontWeight: 600,
        backgroundColor: '#ff4444',
        color: 'white',
        border: 'none',
        borderRadius: 6,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      Start
    </button>
  )
}

export default StartButton
