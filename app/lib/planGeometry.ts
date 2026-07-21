// Extract safe, render-ready geometry from an UNTRUSTED Furnisher plan
// (`Listing.planJson`, arriving via paste or the #plan= handoff). This is the
// MD1 trust boundary for the mini-map: every coordinate is coerced to a finite,
// clamped number and every colour passes through safeColor before it can reach
// an SVG sink. Pure + exhaustively tested — the renderer just draws the output.
import { safeColor } from './sanitize'

export interface SafeRoom {
  id: string
  name: string
  x: number
  y: number
  w: number
  h: number
  points?: { x: number; y: number }[]
  color: string
}

export interface SafeDoor {
  x: number
  y: number
  length: number
  orientation: 'h' | 'v'
  type: 'swing' | 'sliding' | 'window'
}

export interface SafeFurniture {
  x: number
  y: number
  w: number
  h: number
  rotation: number
  color: string
  round: boolean
}

export interface SafePlan {
  rooms: SafeRoom[]
  doors: SafeDoor[]
  furniture: SafeFurniture[]
  bbox: { minX: number; minY: number; maxX: number; maxY: number }
}

// Generous but finite bounds (cm). A real apartment plan is well within this;
// the clamp only exists to defuse Infinity / absurd hostile values.
const LIMIT = 100_000
const MAX_ROOMS = 200
const MAX_DOORS = 400
const MAX_FURNITURE = 600
const MAX_POINTS = 60

function fin(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(-LIMIT, Math.min(LIMIT, v)) : fallback
}
// Non-negative size, clamped; 0 allowed (degenerate rooms just don't draw).
function size(v: unknown): number {
  const n = fin(v, 0)
  return n < 0 ? 0 : n
}
function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object'
}

function extractRoom(raw: unknown, i: number): SafeRoom | null {
  if (!isObj(raw)) return null
  const x = fin(raw.x)
  const y = fin(raw.y)
  const w = size(raw.w)
  const h = size(raw.h)
  let points: { x: number; y: number }[] | undefined
  if (Array.isArray(raw.points)) {
    const pts = raw.points
      .slice(0, MAX_POINTS)
      .filter(isObj)
      .map((p) => ({ x: fin(p.x), y: fin(p.y) }))
    if (pts.length >= 3) points = pts
  }
  return {
    id: typeof raw.id === 'string' ? raw.id.slice(0, 60) : `room-${i}`,
    name: typeof raw.name === 'string' ? raw.name.slice(0, 60) : '',
    x,
    y,
    w,
    h,
    points,
    color: safeColor(raw.color),
  }
}

function extractDoor(raw: unknown): SafeDoor | null {
  if (!isObj(raw)) return null
  const type = raw.type === 'sliding' || raw.type === 'window' ? raw.type : 'swing'
  return {
    x: fin(raw.x),
    y: fin(raw.y),
    length: size(raw.length),
    orientation: raw.orientation === 'v' ? 'v' : 'h',
    type,
  }
}

function extractFurniture(raw: unknown): SafeFurniture | null {
  if (!isObj(raw)) return null
  const w = size(raw.w)
  const h = size(raw.h)
  if (w <= 0 || h <= 0) return null
  return {
    x: fin(raw.x),
    y: fin(raw.y),
    w,
    h,
    rotation: fin(raw.rotation),
    color: safeColor(raw.color),
    round: raw.shape === 'round',
  }
}

// A room's contribution to the bounding box: its polygon extent if present,
// else its rectangle.
function roomBounds(r: SafeRoom): { minX: number; minY: number; maxX: number; maxY: number } {
  if (r.points && r.points.length >= 3) {
    const xs = r.points.map((p) => p.x)
    const ys = r.points.map((p) => p.y)
    return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
  }
  return { minX: r.x, minY: r.y, maxX: r.x + r.w, maxY: r.y + r.h }
}

/**
 * Parse untrusted plan JSON into safe render primitives, or null when there's
 * nothing drawable (no rooms and no furniture). Callers render null as "plan
 * attached, no preview".
 */
export function extractSafePlan(planJson: unknown): SafePlan | null {
  if (!isObj(planJson)) return null

  const rooms = Array.isArray(planJson.rooms)
    ? planJson.rooms.slice(0, MAX_ROOMS).map(extractRoom).filter((r): r is SafeRoom => r !== null)
    : []
  const doors = Array.isArray(planJson.doors)
    ? planJson.doors.slice(0, MAX_DOORS).map(extractDoor).filter((d): d is SafeDoor => d !== null)
    : []
  const furniture = Array.isArray(planJson.furniture)
    ? planJson.furniture.slice(0, MAX_FURNITURE).map(extractFurniture).filter((f): f is SafeFurniture => f !== null)
    : []

  if (rooms.length === 0 && furniture.length === 0) return null

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const grow = (b: { minX: number; minY: number; maxX: number; maxY: number }) => {
    minX = Math.min(minX, b.minX)
    minY = Math.min(minY, b.minY)
    maxX = Math.max(maxX, b.maxX)
    maxY = Math.max(maxY, b.maxY)
  }
  for (const r of rooms) grow(roomBounds(r))
  for (const f of furniture) grow({ minX: f.x, minY: f.y, maxX: f.x + f.w, maxY: f.y + f.h })

  // All zero-size and coincident (e.g. rooms with w=h=0 at the origin): nothing
  // meaningful to draw.
  if (!Number.isFinite(minX) || (maxX - minX <= 0 && maxY - minY <= 0)) return null

  return { rooms, doors, furniture, bbox: { minX, minY, maxX, maxY } }
}
