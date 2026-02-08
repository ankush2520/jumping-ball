'use client'

import React from 'react'

interface Props {
  onClick: () => void
  disabled?: boolean
}

const ResetButton: React.FC<Props> = ({ onClick, disabled = false }) => {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        position: 'fixed',
        left: 12,
        top: 60,
        padding: '10px 20px',
        minWidth: 80,
        fontSize: 14,
        fontWeight: 600,
        backgroundColor: '#4444ff',
        color: 'white',
        border: 'none',
        borderRadius: 6,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      Reset
    </button>
  )
}

export default ResetButton
