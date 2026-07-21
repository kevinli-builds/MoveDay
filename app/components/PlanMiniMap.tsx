'use client'

// Read-only SVG thumbnail of a listing's floor plan (FABLE_BRIEF §4/M4 — the
// "reader" to Furnisher's editor). Input is untrusted planJson; all coercion +
// colour sanitizing happens in extractSafePlan, so this file only draws.
import { useMemo } from 'react'
import { extractSafePlan } from '../lib/planGeometry'

const PAD = 30 // cm of breathing room around the bounding box

export function PlanMiniMap({ planJson, maxHeight = 200 }: { planJson: unknown; maxHeight?: number }) {
  const safe = useMemo(() => extractSafePlan(planJson), [planJson])
  if (!safe) return null

  const { rooms, doors, furniture, bbox } = safe
  const vw = bbox.maxX - bbox.minX + PAD * 2
  const vh = bbox.maxY - bbox.minY + PAD * 2
  const ox = bbox.minX - PAD
  const oy = bbox.minY - PAD
  const aspect = vw / vh

  return (
    <svg
      className="plan-mini"
      viewBox={`${ox} ${oy} ${vw} ${vh}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ maxHeight, width: '100%', aspectRatio: `${aspect}` }}
      role="img"
      aria-label="Floor plan preview"
    >
      {/* Rooms: polygon when it has ≥3 points, else the rectangle. */}
      {rooms.map((r) =>
        r.points ? (
          <polygon
            key={r.id}
            points={r.points.map((p) => `${p.x},${p.y}`).join(' ')}
            fill={r.color}
            fillOpacity={0.18}
            stroke="#8a7458"
            strokeWidth={Math.max(vw, vh) / 240}
          />
        ) : (
          r.w > 0 &&
          r.h > 0 && (
            <rect
              key={r.id}
              x={r.x}
              y={r.y}
              width={r.w}
              height={r.h}
              fill={r.color}
              fillOpacity={0.18}
              stroke="#8a7458"
              strokeWidth={Math.max(vw, vh) / 240}
            />
          )
        ),
      )}

      {/* Furniture footprints — subordinate, so the room shell reads first. */}
      {furniture.map((f, i) => {
        const cx = f.x + f.w / 2
        const cy = f.y + f.h / 2
        return f.round ? (
          <ellipse
            key={`f-${i}`}
            cx={cx}
            cy={cy}
            rx={f.w / 2}
            ry={f.h / 2}
            fill={f.color}
            fillOpacity={0.55}
            transform={`rotate(${f.rotation} ${cx} ${cy})`}
          />
        ) : (
          <rect
            key={`f-${i}`}
            x={f.x}
            y={f.y}
            width={f.w}
            height={f.h}
            fill={f.color}
            fillOpacity={0.55}
            transform={`rotate(${f.rotation} ${cx} ${cy})`}
          />
        )
      })}

      {/* Doors: a short accent stroke marking the opening in the wall. Windows
          get a lighter dashed mark. */}
      {doors.map((d, i) => {
        const x2 = d.orientation === 'h' ? d.x + d.length : d.x
        const y2 = d.orientation === 'v' ? d.y + d.length : d.y
        return (
          <line
            key={`d-${i}`}
            x1={d.x}
            y1={d.y}
            x2={x2}
            y2={y2}
            stroke={d.type === 'window' ? '#6f9ec9' : '#3d6b9e'}
            strokeWidth={Math.max(vw, vh) / 130}
            strokeDasharray={d.type === 'window' ? `${Math.max(vw, vh) / 90}` : undefined}
            strokeLinecap="round"
          />
        )
      })}
    </svg>
  )
}
