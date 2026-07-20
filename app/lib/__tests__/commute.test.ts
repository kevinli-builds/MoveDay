import { describe, expect, it } from 'vitest'

import { fallbackMinutes, haversineKm, nominatimUrl, osrmUrl, transitDeepLink, walkFallbackMinutes } from '../commute'

describe('haversineKm', () => {
  it('matches a known city-pair distance (NYC ↔ Philadelphia ≈ 130 km)', () => {
    const nyc = { lat: 40.7128, lon: -74.006 }
    const philly = { lat: 39.9526, lon: -75.1652 }
    const km = haversineKm(nyc, philly)
    expect(km).toBeGreaterThan(120)
    expect(km).toBeLessThan(140)
  })

  it('is zero for the same point and symmetric', () => {
    const a = { lat: 40.7, lon: -74 }
    const b = { lat: 40.8, lon: -73.9 }
    expect(haversineKm(a, a)).toBe(0)
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 10)
  })
})

describe('fallbackMinutes', () => {
  it('walking is slower than driving for the same distance', () => {
    expect(fallbackMinutes(3, 'walk')).toBeGreaterThan(fallbackMinutes(3, 'drive'))
  })

  it('never returns less than a minute and scales with distance', () => {
    expect(fallbackMinutes(0, 'drive')).toBeGreaterThanOrEqual(1)
    expect(fallbackMinutes(10, 'drive')).toBeGreaterThan(fallbackMinutes(2, 'drive'))
  })

  it('gives sane urban numbers (2 km walk ≈ half an hour, not hours)', () => {
    const walk2km = fallbackMinutes(2, 'walk')
    expect(walk2km).toBeGreaterThan(15)
    expect(walk2km).toBeLessThan(50)
  })
})

describe('URL builders', () => {
  it('nominatim encodes the address', () => {
    expect(nominatimUrl('123 Main St, NY')).toBe(
      'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=123%20Main%20St%2C%20NY',
    )
  })

  it('osrm uses lon,lat order and only the driving profile', () => {
    // The public demo routes every profile with the car graph, so the app
    // never requests /foot/ — walk estimates are computed locally.
    const url = osrmUrl({ lat: 40.7, lon: -74 }, { lat: 40.8, lon: -73.9 })
    expect(url).toContain('/driving/')
    expect(url).toContain('-74,40.7;-73.9,40.8')
  })

  it('walkFallbackMinutes composes distance × walk factor (ESB → Grand Central ≈ 15–25 min)', () => {
    const esb = { lat: 40.7484, lon: -73.9857 }
    const gct = { lat: 40.7527, lon: -73.9772 }
    const min = walkFallbackMinutes(esb, gct)
    expect(min).toBeGreaterThanOrEqual(10)
    expect(min).toBeLessThanOrEqual(25)
  })

  it('transit deep link is a google maps dir URL with transit mode', () => {
    const url = transitDeepLink('A St 1', 'B Ave 2')
    expect(url).toContain('google.com/maps/dir/')
    expect(url).toContain('travelmode=transit')
    expect(url).toContain(encodeURIComponent('A St 1'))
  })
})
