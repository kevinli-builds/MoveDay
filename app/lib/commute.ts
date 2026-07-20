// Commutes without a paid API (FABLE_BRIEF §5): Nominatim geocoding (free,
// 1 req/s, cache results in the entity), OSRM public-demo routing (free, NO
// SLA — every call has a timeout and a straight-line fallback labelled
// "rough est."), and a Google Maps transit deep link + manual minutes field.
// House rule: every number renders with an "est." suffix.

export interface LatLon {
  lat: number
  lon: number
}

export type TravelMode = 'drive' | 'walk'

// ── Pure math (exported for tests) ──────────────────────────────────────────

export function haversineKm(a: LatLon, b: LatLon): number {
  const R = 6371
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLon = rad(b.lon - a.lon)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

// Straight-line fallback when OSRM is down: crow-flies km × an urban mode
// factor. Deliberately conservative; always labelled "rough est.".
export function fallbackMinutes(km: number, mode: TravelMode): number {
  const perKm = mode === 'walk' ? 13 : 2.2 // ~4.6 km/h walking, ~27 km/h city driving
  const overhead = mode === 'walk' ? 2 : 4 // getting out the door / parking
  return Math.max(1, Math.round(km * 1.3 * perKm + overhead)) // 1.3 ≈ street grid vs crow-flies
}

// ── URL builders (exported for tests) ───────────────────────────────────────

export function nominatimUrl(address: string): string {
  return `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(address)}`
}

// ⚠ The public OSRM demo routes EVERY profile with the car graph (verified
// 2026-07-18: driving/foot/bike return identical durations). So OSRM is only
// called for drive; walk estimates always come from walkFallbackMinutes below.
export function osrmUrl(from: LatLon, to: LatLon): string {
  // OSRM takes lon,lat order.
  return `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`
}

/** Walk minutes, always the honest straight-line estimate ("rough est."). */
export function walkFallbackMinutes(from: LatLon, to: LatLon): number {
  return fallbackMinutes(haversineKm(from, to), 'walk')
}

export function transitDeepLink(origin: string, destination: string): string {
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=transit`
}

// ── Network (browser only; every call timeboxed) ────────────────────────────

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`http ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

/** Geocode an address via Nominatim. Callers must pace requests ≥1s apart. */
export async function geocode(address: string): Promise<LatLon | null> {
  try {
    const data = (await fetchJson(nominatimUrl(address), 6000)) as { lat?: string; lon?: string }[]
    const hit = Array.isArray(data) ? data[0] : null
    const lat = hit ? Number(hit.lat) : NaN
    const lon = hit ? Number(hit.lon) : NaN
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null
  } catch {
    return null
  }
}

/**
 * DRIVE minutes via the OSRM public demo (5s timeout, no SLA). Returns the
 * estimate and whether it came from the straight-line fallback.
 */
export async function driveMinutes(
  from: LatLon,
  to: LatLon,
): Promise<{ minutes: number; rough: boolean }> {
  try {
    const data = (await fetchJson(osrmUrl(from, to), 5000)) as {
      routes?: { duration?: number }[]
    }
    const secs = data.routes?.[0]?.duration
    if (typeof secs === 'number' && Number.isFinite(secs) && secs >= 0) {
      return { minutes: Math.max(1, Math.round(secs / 60)), rough: false }
    }
  } catch {
    /* fall through to the rough estimate */
  }
  return { minutes: fallbackMinutes(haversineKm(from, to), 'drive'), rough: true }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
