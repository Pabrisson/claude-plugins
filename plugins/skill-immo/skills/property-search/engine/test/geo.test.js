import assert from 'node:assert/strict'
import test from 'node:test'
import { band, bbox, center, circle, corridor, distance, inGeometry, inZone, thin } from '../lib/geo.js'

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

// a street bent like rue Lepic: 600 m east, 300 m north, 600 m back west (a U), in meters around the Butte
const o = [2.3349, 48.8864], m = ([x, y]) => [o[0] + x / (111320 * Math.cos((o[1] * Math.PI) / 180)), o[1] + y / 111320]
const u = [[[0, 0], [600, 0], [600, 300], [0, 300]].map(m)]

test("a street's band follows its bends: all of it in, within reach only", () => {
  const g = band(u, 100)
  assert.equal(g.type, 'Polygon')
  assert.deepEqual(g.coordinates[0][0], g.coordinates[0].at(-1))
  // along the street, at its far corner, 80 m off each arm: in
  for (const p of [[0, 0], [300, 0], [600, 150], [300, 300], [0, 300], [670, -50], [300, -80], [300, 380], [680, 150]]) assert.ok(inGeometry(m(p), g), String(p))
  // 130 m off, and the middle of the U, 150 m from both arms: out (the capsule of its ends took it)
  for (const p of [[300, -130], [730, 150], [300, 150], [-130, 150]]) assert.ok(!inGeometry(m(p), g), String(p))
  assert.ok(inGeometry(m([300, 150]), corridor(u[0], 100)))
})

test('segments apart make two polygons; a loop keeps its hole', () => {
  const g = band([[[0, 0], [200, 0]].map(m), [[2000, 0], [2200, 0]].map(m)], 50)
  assert.equal(g.type, 'MultiPolygon')
  assert.equal(g.coordinates.length, 2)
  const loop = band([[[0, 0], [400, 0], [400, 400], [0, 400], [0, 0]].map(m)], 100)
  assert.equal(loop.type, 'Polygon')
  assert.equal(loop.coordinates.length, 2, 'the block inside the loop is a hole')
  assert.ok(!inGeometry(m([200, 200]), loop) && inGeometry(m([200, 50]), loop))
})

test('an outline cut to 60 vertices keeps its shape', () => {
  // a corniche: 1.2 km of bends 80 m deep every 200 m, its band 30 m on each side
  const bends = Array.from({ length: 121 }, (_, i) => [i * 10, 80 * Math.sin((i * 10 * Math.PI) / 100)])
  const ring = band([bends.map(m)], 30).coordinates[0]
  assert.ok(ring.length > 60, `${ring.length} vertices`)
  const cut = thin(ring, 60)
  assert.ok(cut.length <= 60 && cut.every(p => ring.includes(p)))
  assert.deepEqual(cut[0], cut.at(-1))
  // the street stays inside it
  for (const p of bends) assert.ok(inGeometry(m(p), { type: 'Polygon', coordinates: [cut] }), String(p))
  assert.equal(thin(ring.slice(0, 10), 60).length, 10)
})
