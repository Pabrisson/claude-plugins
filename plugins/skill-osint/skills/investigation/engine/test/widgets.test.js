import assert from 'node:assert/strict'
import test from 'node:test'
import { haversineKm } from '../lib/geo.js'
import { accepts, mimeOf } from '../lib/mime.js'
import { accepts as viaUtil } from '../lib/util.js'
import { circlesOf, evidenceItems, mapFeatures } from '../lib/widgets.js'

const note = (path, props, title = path.split('/').pop().replace(/\.md$/, '')) => ({ path, folder: path.split('/')[0], title, props })
const pt = (lon, lat, properties) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties })

test('mapFeatures: the view\'s features, plus the place entities and the hypotheses with a point that no feature cites', () => {
  const view = { type: 'FeatureCollection', features: [pt(-7.9076, 38.5728, { role: 'place', label: 'Temple', ref: 'Entities/Templo Romano.md', group: 'agent' }), pt(-7.9075, 38.5725, { role: 'candidate', label: 'cited', ref: 'H09', group: 'agent' })] }
  const notes = [
    note('Entities/Templo Romano.md', { kind: 'place', value: 'Templo Romano', lat: 38.5728, lon: -7.9076 }),
    note('Entities/Sé de Évora.md', { kind: 'place', value: 'Sé de Évora', lat: '38.5719', lon: '-7.9070' }),
    note('Entities/Lisbon.md', { kind: 'place', value: 'Lisbon' }),
    note('Entities/example.org.md', { kind: 'domain', value: 'example.org', lat: 1, lon: 2 }),
    note('Hypotheses/H01 Portugal.md', { id: 'H01', level: 'country', status: 'active' }, 'Portugal'),
    note('Hypotheses/H02 Évora.md', { id: 'H02', level: 'region', status: 'active', point: [38.5714, -7.9135], radius_m: 3000 }, 'Évora'),
    note('Hypotheses/H03 Mérida.md', { id: 'H03', level: 'region', status: 'excluded', point: [38.9168, -6.3438], radius_m: 2000 }, 'Mérida'),
    note('Hypotheses/H09 Corner.md', { id: 'H09', level: 'point', status: 'retained', point: [38.5725, -7.9075] }, 'Corner'),
  ]
  const f = mapFeatures(view, notes).features
  assert.equal(f.length, 5)
  assert.deepEqual(f.slice(2).map(x => [x.properties.role, x.properties.label, x.properties.ref, x.properties.radius_m ?? null]),
    [['place', 'Sé de Évora', 'Entities/Sé de Évora.md', null], ['candidate', 'H02 Évora', 'H02', 3000], ['excluded', 'H03 Mérida', 'H03', 2000]])
  assert.deepEqual(f[2].geometry.coordinates, [-7.907, 38.5719])
  assert.deepEqual(mapFeatures(null, []).features, [])
})

test('circlesOf: one closed polygon per point with a radius, at that distance from its centre', () => {
  const c = circlesOf(mapFeatures({ features: [pt(-7.9075, 38.5725, { role: 'candidate', radius_m: 500 }), { type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: { role: 'sightline', radius_m: 9 } }] }, []))
  assert.equal(c.length, 1)
  const ring = c[0].geometry.coordinates[0]
  assert.deepEqual(ring[0], ring.at(-1))
  assert.ok(ring.every(([lon, lat]) => Math.abs(haversineKm([38.5725, -7.9075], [lat, lon]) - 0.5) < 1e-6))
  assert.equal(c[0].properties.role, 'candidate')
})

test('evidenceItems: every picture and video of Evidence, in sections, joined with the view by file; a remote image has no file', () => {
  const index = {
    files: ['Case.md', 'Evidence/E01-photo.jpg', 'Evidence/E02-E01-masked.jpg', 'Evidence/frames/walk-001.jpg', 'Evidence/crops/recon/01_sign.jpg', 'Evidence/crops/compare/002.jpg', 'Evidence/crops/compare/001.jpg', 'Evidence/captures/S01.png', 'Evidence/captures/S02.html', 'Evidence/E03-clip.mp4'],
    evidence: [{ id: 'E01', file: 'Evidence/E01-photo.jpg', sha256: 'a'.repeat(64), of: null, kind: 'original' }, { id: 'E02', file: 'Evidence/E02-E01-masked.jpg', sha256: 'b'.repeat(64), of: 'E01', kind: 'masked' }, { id: 'E03', file: 'Evidence/E03-clip.mp4', sha256: 'c'.repeat(64), of: null, kind: 'original' }],
  }
  const view = { items: [
    { group: 'compare', file: 'Evidence/crops/compare/001.jpg', kind: 'candidate', rank: 1, page: 'https://x.example/a', label: '#1 x.example', verdict: 'match' },
    { group: 'compare', file: 'Evidence/crops/compare/002.jpg', kind: 'candidate', rank: 2, label: '#2 y.example' },
    { group: 'ground', url: 'https://panoramax.example/p/1.jpg', label: 'Panoramax 2024-07-16', license: 'CC BY-SA 4.0', author: 'someone' }] }
  const items = evidenceItems(index, view)
  assert.deepEqual(items.map(i => [i.section, i.file ?? i.url]), [
    ['original', 'Evidence/E01-photo.jpg'], ['original', 'Evidence/E03-clip.mp4'], ['masked', 'Evidence/E02-E01-masked.jpg'], ['frame', 'Evidence/frames/walk-001.jpg'],
    ['candidate', 'Evidence/crops/compare/001.jpg'], ['candidate', 'Evidence/crops/compare/002.jpg'], ['crop', 'Evidence/crops/recon/01_sign.jpg'], ['capture', 'Evidence/captures/S01.png'], ['remote', 'https://panoramax.example/p/1.jpg']])
  assert.deepEqual([items[0].id, items[0].sha256.length, items[1].video, items[2].of, items[4].verdict, items[6].label, items[8].license], ['E01', 64, true, 'E01', 'match', '01_sign.jpg', 'CC BY-SA 4.0'])
})

test('mime.js is what util.js exports: the dashboard and the engine read accept lists alike', () => {
  assert.equal(viaUtil, accepts)
  assert.deepEqual([accepts('image/*', 'IMG_0042.HEIC'), accepts('video/*', 'a.txt'), mimeOf('C:\\x\\clip.MOV')], [true, false, 'video/quicktime'])
})
