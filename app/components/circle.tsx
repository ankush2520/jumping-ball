'use client'

import React, { useEffect, useRef, useState } from 'react'
import {
  Ball,
  createBall,
  updatePosition,
  reflectBoundary,
  applyDrag,
  clampSpeed,
  collideBalls,
} from '../scripts/ball'
import {
  CIRCLE_RADIUS,
  BALL_RADIUS,
  GRAVITY,
  BOUNCE_SPEED,
  BOUNCE_JITTER,
  TANGENTIAL_IMPULSE,
  DRAG,
  MAX_SPEED,
  COOLDOWN_MS,
  MAX_BALLS,
} from '../scripts/config'
import TimePanel from './TimePanel'
import StartButton from './StartButton'
import ResetButton from './ResetButton'

const Circle = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ballsRef = useRef<Ball[]>([])
  const animationRef = useRef<number | null>(null)
  const startRef = useRef<number>(0)
  const [gameStarted, setGameStarted] = useState(false)
  const [collisions, setCollisions] = useState<number[]>([])

  // constants are imported from ../scripts/config

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Set canvas size to window size
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight

    // Initialize balls
    ballsRef.current = [
      createBall(canvas.width / 2 - 80, canvas.height / 2 - 100, 4, 0, BALL_RADIUS),
      createBall(canvas.width / 2 + 80, canvas.height / 2 - 80, -4, 0, BALL_RADIUS),
    ]

    const centerX = canvas.width / 2
    const centerY = canvas.height / 2

    const drawCircle = (ctx: CanvasRenderingContext2D) => {
      ctx.strokeStyle = 'red'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(centerX, centerY, CIRCLE_RADIUS, 0, Math.PI * 2)
      ctx.stroke()
    }

    const drawBall = (ctx: CanvasRenderingContext2D, ball: Ball) => {
      ctx.fillStyle = 'red'
      ctx.beginPath()
      ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2)
      ctx.fill()
    }
    const updateBalls = () => {
      // Track which collisions have spawned a ball this frame to avoid duplicates
      const spawnedPairs = new Set<string>()

      // per-ball updates
      ballsRef.current.forEach((ball) => {
        updatePosition(ball)
        reflectBoundary(ball, centerX, centerY, CIRCLE_RADIUS, BOUNCE_SPEED, BOUNCE_JITTER, TANGENTIAL_IMPULSE, MAX_SPEED, DRAG)
        // ensure small speed clamp after drag
        clampSpeed(ball, MAX_SPEED)
      })

      // ball-to-ball collisions and spawning
      const now = Date.now()

      for (let i = 0; i < ballsRef.current.length; i++) {
        for (let j = i + 1; j < ballsRef.current.length; j++) {
          const ball1 = ballsRef.current[i]
          const ball2 = ballsRef.current[j]
          const pairKey = `${i}-${j}`
          const result = collideBalls(ball1, ball2, BOUNCE_SPEED, BOUNCE_JITTER, TANGENTIAL_IMPULSE, MAX_SPEED, COOLDOWN_MS, now, ballsRef.current, MAX_BALLS, BALL_RADIUS)
          if (result) {
            // Only log and add if a NEW BALL was spawned
            if (result.newBall && !spawnedPairs.has(pairKey)) {
              const elapsed = (now - startRef.current) / 1000
              setCollisions((prev) => [...prev, elapsed])
              spawnedPairs.add(pairKey)
              ballsRef.current.push(result.newBall)
            }
          }
        }
      }
    }

    const animate = () => {
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      // Clear canvas
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      // Update and draw only if game has started
      if (gameStarted) {
        updateBalls()
      }
      drawCircle(ctx)
      ballsRef.current.forEach((ball) => drawBall(ctx, ball))

      animationRef.current = requestAnimationFrame(animate)
    }

    animate()

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [gameStarted])

  const handleStartClick = () => {
    startRef.current = Date.now()
    setGameStarted(true)
    setCollisions([])
  }

  const handleResetClick = () => {
    setGameStarted(false)
    setCollisions([])
    startRef.current = 0
    // Recreate initial balls
    const canvas = canvasRef.current
    if (canvas) {
      ballsRef.current = [
        createBall(canvas.width / 2 - 80, canvas.height / 2 - 100, 4, 0, BALL_RADIUS),
        createBall(canvas.width / 2 + 80, canvas.height / 2 - 80, -4, 0, BALL_RADIUS),
      ]
    }
  }

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{ display: 'block' }}
      />
      <StartButton onClick={handleStartClick} disabled={gameStarted} />
      <ResetButton onClick={handleResetClick} />
      <TimePanel startTime={gameStarted ? startRef.current : null} collisions={collisions} />
    </>
  )
}

export default Circle
