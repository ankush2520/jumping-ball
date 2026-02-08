'use client'

export interface Ball {
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  lastCollision?: number
}

export const createBall = (x: number, y: number, vx: number, vy: number, radius: number): Ball => ({
  x,
  y,
  vx,
  vy,
  radius,
  lastCollision: 0,
})

export const updatePosition = (ball: Ball) => {
  ball.x += ball.vx
  ball.y += ball.vy
}

export const applyDrag = (ball: Ball, drag: number) => {
  ball.vx *= drag
  ball.vy *= drag
}

export const clampSpeed = (ball: Ball, maxSpeed: number) => {
  const mag = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy) || 1
  if (mag > maxSpeed) {
    ball.vx = (ball.vx / mag) * maxSpeed
    ball.vy = (ball.vy / mag) * maxSpeed
  }
}

export const reflectBoundary = (
  ball: Ball,
  centerX: number,
  centerY: number,
  circleRadius: number,
  bounceSpeed: number,
  bounceJitter: number,
  tangentialImpulse: number,
  maxSpeed: number,
  drag: number
) => {
  const dx = ball.x - centerX
  const dy = ball.y - centerY
  const distance = Math.sqrt(dx * dx + dy * dy)
  const maxDistance = circleRadius - ball.radius
  if (distance <= maxDistance) return

  const nx = dx / distance
  const ny = dy / distance

  // push back to boundary
  ball.x = centerX + nx * maxDistance
  ball.y = centerY + ny * maxDistance

  // reflect
  const dot = ball.vx * nx + ball.vy * ny
  const reflectX = ball.vx - 2 * dot * nx
  const reflectY = ball.vy - 2 * dot * ny

  // tangential kick
  const tx = -ny
  const ty = nx
  const tangential = (Math.random() - 0.5) * tangentialImpulse

  const jitter = 1 + (Math.random() * 2 - 1) * bounceJitter

  const reflMag = Math.sqrt(reflectX * reflectX + reflectY * reflectY) || 1
  let nvx = (reflectX / reflMag) * bounceSpeed * jitter + tx * tangential
  let nvy = (reflectY / reflMag) * bounceSpeed * jitter + ty * tangential

  // clamp
  const mag = Math.sqrt(nvx * nvx + nvy * nvy) || 1
  if (mag > maxSpeed) {
    nvx = (nvx / mag) * maxSpeed
    nvy = (nvy / mag) * maxSpeed
  }

  ball.vx = nvx
  ball.vy = nvy

  // apply drag frame-wise
  ball.vx *= drag
  ball.vy *= drag
}

// Handle collision between two balls. Returns a new spawned Ball or null.
export const collideBalls = (
  ball1: Ball,
  ball2: Ball,
  bounceSpeed: number,
  bounceJitter: number,
  tangentialImpulse: number,
  maxSpeed: number,
  cooldownMs: number,
  now: number,
  ballsArray: Ball[],
  maxBalls: number,
  ballRadius: number
): { newBall: Ball | null; collided: boolean } | null => {
  const dx = ball2.x - ball1.x
  const dy = ball2.y - ball1.y
  const distance = Math.sqrt(dx * dx + dy * dy)
  const minDistance = ball1.radius + ball2.radius
  if (distance >= minDistance) return null

  const nx = distance === 0 ? 1 : dx / distance
  const ny = distance === 0 ? 0 : dy / distance
  const tx = -ny
  const ty = nx

  // separate
  const overlap = minDistance - distance
  ball1.x -= (overlap / 2) * nx
  ball1.y -= (overlap / 2) * ny
  ball2.x += (overlap / 2) * nx
  ball2.y += (overlap / 2) * ny

  // velocities with jitter and tangential kick
  const jitter1 = 1 + (Math.random() * 2 - 1) * bounceJitter
  const jitter2 = 1 + (Math.random() * 2 - 1) * bounceJitter
  const tangential1 = (Math.random() - 0.5) * tangentialImpulse
  const tangential2 = (Math.random() - 0.5) * tangentialImpulse

  ball1.vx = -nx * bounceSpeed * jitter1 + tx * tangential1
  ball1.vy = -ny * bounceSpeed * jitter1 + ty * tangential1
  ball2.vx = nx * bounceSpeed * jitter2 + tx * tangential2
  ball2.vy = ny * bounceSpeed * jitter2 + ty * tangential2

  // clamp speeds
  clampSpeed(ball1, maxSpeed)
  clampSpeed(ball2, maxSpeed)

  // spawn new ball if allowed
  const canSpawn = (ball1.lastCollision || 0) < now - cooldownMs && (ball2.lastCollision || 0) < now - cooldownMs
  let spawned: Ball | null = null
  if (ballsArray.length < maxBalls && canSpawn) {
    const midX = (ball1.x + ball2.x) / 2 + (Math.random() - 0.5) * 6
    const midY = (ball1.y + ball2.y) / 2 + (Math.random() - 0.5) * 6
    const inheritVx = (ball1.vx + ball2.vx) / 2
    const inheritVy = (ball1.vy + ball2.vy) / 2
    const angle = Math.atan2(inheritVy, inheritVx) + (Math.random() - 0.5) * 0.6
    const speed = bounceSpeed * (0.9 + Math.random() * 0.4)
    spawned = createBall(Math.max(midX, ballRadius), Math.max(midY, ballRadius), Math.cos(angle) * speed, Math.sin(angle) * speed, ballRadius)
    // mark lastCollision to debounce
    ball1.lastCollision = now
    ball2.lastCollision = now
  } else {
    // even if not spawning, mark lastCollision so we don't repeatedly report the same collision
    ball1.lastCollision = now
    ball2.lastCollision = now
  }

  return { newBall: spawned, collided: true }
}
