import assert from 'node:assert/strict'
import test from 'node:test'
import { circle, destination, gameScore, haversineKm, parseLatLon } from '../lib/geo.js'

test('distances and shapes on the sphere: Paris–Évora, the world-map score, a destination and back, a closed circle', () => {
  const paris = [48.8584, 2.2945], evora = [38.5725, -7.9075]
  assert.ok(Math.abs(haversineKm(paris, evora) - 1404.57) < 0.05)
  assert.deepEqual([gameScore(0), gameScore(haversineKm(paris, evora)), gameScore(1492.7)], [5000, 1951, 1839])
  const east = destination(evora, 90, 10), back = destination(east, 270, 10)
  assert.ok(Math.abs(haversineKm(evora, east) - 10) < 1e-6)
  assert.ok(haversineKm(evora, back) < 0.02)
  const ring = circle(evora, 500, 32)
  assert.equal(ring.length, 33)
  assert.deepEqual(ring[0], ring.at(-1))
  assert.ok(ring.every(([lon, lat]) => Math.abs(haversineKm(evora, [lat, lon]) - 0.5) < 1e-6))
  assert.deepEqual([parseLatLon('38.5725,-7.9075'), parseLatLon(' -33.8, 151.2 '), parseLatLon('91,0'), parseLatLon('Évora')], [[38.5725, -7.9075], [-33.8, 151.2], null, null])
})
