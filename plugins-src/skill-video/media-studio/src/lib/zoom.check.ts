// node src/lib/zoom.check.ts: the viewers' zoom
import assert from "node:assert/strict"
import { FIT, MAX, panBy, sharp, zoomAt } from "./zoom.ts"

// a 16:9 image filling the width of an 800 × 600 frame
const room = { w: 800, h: 600 }, size = { w: 800, h: 450 }

// the point under the pointer stays under it: 200 px right of the center, at 2× too
const v = zoomAt(FIT, 2, { x: 200, y: 100 }, size, room)
assert.deepEqual(v, { s: 2, x: -200, y: -100 })
assert.equal((200 - v.x) / v.s, 200)
// from 100 % to MAX, never past them; back to 100 % the image is where it was
assert.equal(zoomAt(FIT, 100, { x: 0, y: 0 }, size, room).s, MAX)
assert.deepEqual(zoomAt(v, 0.2, { x: -300, y: 50 }, size, room), FIT)
assert.deepEqual(zoomAt(v, 1, { x: 300, y: 0 }, { w: 801, h: 450 }, room), FIT)
// panning stops at the edges: at 2× the image goes 400 px left or right, 150 px up or down, no further
assert.deepEqual(panBy(v, -10000, 10000, size, room), { s: 2, x: -400, y: 150 })
// a side that still fits stays centered: at 1.2× the image is 540 px high in a 600 px frame
const small = zoomAt(FIT, 1.2, { x: 300, y: 250 }, size, room)
assert.equal(small.y, 0)
assert.equal(panBy(small, 0, 80, size, room).y, 0)
// Pixels: a 2048 px file shown 512 px wide turns sharp at 4× on a plain screen, at 2× on a Retina one; never at 100 %
assert.equal(sharp(3.9, 2048, 512, 1), false)
assert.equal(sharp(4, 2048, 512, 1), true)
assert.equal(sharp(2, 2048, 512, 2), true)
assert.equal(sharp(1, 512, 734, 2), false)
console.log("zoom: ok")
