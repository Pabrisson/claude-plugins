import assert from 'node:assert/strict'
import test from 'node:test'
import { bbox, center, circle, corridor, distance, inGeometry, inZone } from '../lib/geo.js'

// rue Paul Bert (Lyon 3e) runs about 2 km west to east, from the Guillotière to Montchat
const west = [4.8455, 45.7560], east = [4.8720, 45.7568], middle = [4.8590, 45.7564]

test('a street becomes a capsule along it, not a circle around its middle', () => {
  const g = corridor([middle, west, east, [4.852, 45.7562]], 300)
  assert.equal(g.type, 'Polygon')
  assert.deepEqual(g.coordinates[0][0], g.coordinates[0].at(-1))
  // both ends and the middle are in, 250 m past an end too; 400 m off the axis is out
  for (const p of [west, east, middle, [4.8423, 45.7560]]) assert.ok(inGeometry(p, g), String(p))
  for (const p of [[4.8590, 45.7600], [4.8590, 45.7528], [4.8380, 45.7560]]) assert.ok(!inGeometry(p, g), String(p))
  // the circle of 500 m around the middle missed both ends
  assert.ok(distance(middle, west) > 500 && distance(middle, east) > 500)
})

test('a street shorter than its width is a circle', () => {
  const g = corridor([middle, [4.8592, 45.7564]], 300)
  assert.ok(inGeometry([4.8590, 45.7580], g))
  assert.ok(Math.abs(distance([4.8591, 45.7564], g.coordinates[0][0]) - 300) < 5)
})

test('zones: inside, box, center', () => {
  const z = { kind: 'polygon', geometry: corridor([west, east], 300) }
  assert.ok(inZone(middle, z) && !inZone([4.86, 45.77], z))
  const [w, s, e, n] = bbox(z)
  assert.ok(w < west[0] && e > east[0] && s < 45.7560 && n > 45.7568)
  assert.ok(distance(center(z), middle) < 100)
  assert.ok(inZone(middle, { kind: 'radius', center: middle, radius_m: 10 }))
  assert.ok(inGeometry(middle, circle(middle, 50)))
})
