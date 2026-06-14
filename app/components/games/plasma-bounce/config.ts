export const CIRCLE_RADIUS = 200; // increased by 20% (140 * 1.2)
export const BALL_RADIUS = 2.8; // decreased by 20% (16 * 0.8)
export const GRAVITY = 0;
export const BOUNCE_SPEED = 10;
export const BALL_SPEED = 10;
export const BOUNCE_JITTER = 0.25; // ±25% random variation (increased for more randomness)
export const TANGENTIAL_IMPULSE = 2.5; // increased tangential kick for more unpredictable paths
export const DRAG = 0.995; // gentle damping per frame
export const MAX_SPEED = 20;

// Coefficient of restitution (0 = perfectly inelastic, 1 = perfectly elastic)
export const RESTITUTION = 0.88;

export const COOLDOWN_MS = 200;
export const MAX_BALLS = 120; // reduced from 200 for performance
