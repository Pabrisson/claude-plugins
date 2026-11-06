import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { parseWhen, sunDay, sunPosition, zonedToUtc } from '../lib/sun.js'
import { readNote } from '../lib/vault.js'
import { fakeEnv, startFake } from './fake.mjs'
import { casesFolder, NEW, read, run } from './helpers.js'

const P = ['-p', 'durand-bakery-example']

test('the sun by NOAA formulas: the NREL SPA reference instant, Greenwich at the March equinox, a southern summer noon', () => {
  // Reda & Andreas (NREL, 2003): 2003-10-17 12:30:30 at UTC−7, 39.742476 N 105.1786 W → zenith 50.11162°, azimuth 194.34024°
  const a = sunPosition(39.742476, -105.1786, new Date('2003-10-17T19:30:30Z'))
  assert.ok(Math.abs(a.elevation - (90 - 50.11162)) < 0.02, `${a.elevation}`)
  assert.ok(Math.abs(a.azimuth - 194.34024) < 0.02, `${a.azimuth}`)
  assert.ok(Math.abs(a.shadow_bearing - 14.34024) < 0.05)
  const g = sunPosition(51.4769, 0, new Date('2024-03-20T12:07:00Z'))
  assert.ok(Math.abs(g.azimuth - 180) < 0.5 && Math.abs(g.elevation - 38.7) < 0.3)
  const s = sunPosition(-33.8568, 151.2153, new Date('2024-12-21T01:53:00Z'))
  assert.ok(s.azimuth < 2 || s.azimuth > 358)
  assert.ok(Math.abs(s.elevation - 79.6) < 0.3)
})

test('zonedToUtc: summer time in Lisbon, winter in Shanghai; parseWhen wants a zone with a time', () => {
  assert.equal(zonedToUtc('2024-07-16T14:30', 'Europe/Lisbon').toISOString(), '2024-07-16T13:30:00.000Z')
  assert.equal(zonedToUtc('2024-01-10T09:00', 'Asia/Shanghai').toISOString(), '2024-01-10T01:00:00.000Z')
  assert.deepEqual(parseWhen('2024-07-16'), { day: '2024-07-16', tz: 'UTC' })
  assert.equal(parseWhen('2024-07-16T14:30+01:00').at.toISOString(), '2024-07-16T13:30:00.000Z')
  assert.throws(() => parseWhen('2024-07-16T14:30'), /has no zone/)
  assert.throws(() => parseWhen('2024-07-16T14:30', 'Mars/Olympus'), /IANA time zone/)
})

test('sun over a day finds the times that fit a measured shadow; -p records the computation as a source and a computed clue', async () => {
  assert.deepEqual(sunDay([38.5725, -7.9075], '2024-07-16', 'Europe/Lisbon', { bearing: 45 }).fits, ['14:45'])
  const home = casesFolder(), dir = path.join(home, 'durand-bakery-example')
  await run(home, NEW)
  const r = await run(home, ['sun', '--at', '38.5725,-7.9075', '--date', '2024-07-16T14:30', '--tz', 'Europe/Lisbon', '--shadow-bearing', '40', ...P, '--json'])
  assert.equal(r.status, 0, r.err)
  const o = JSON.parse(r.out)
  assert.deepEqual([o.azimuth, o.elevation, o.shadow_bearing, o.bearing_off], [216.6, 69.3, 36.6, 3.4])
  const [clueFile] = fs.readdirSync(path.join(dir, 'Clues')), c = readNote(path.join(dir, 'Clues', clueFile)).props
  assert.deepEqual([c.status, c.sources.length], ['computed', 1])
  assert.ok(fs.readdirSync(path.join(dir, 'Sources')).includes('S01 Sun at 38.5725,-7.9075, 2024-07-16 13-30 UTC.md'))
  assert.match(read(dir, `Clues/${clueFile}`), /measured shadow bearing 40°, off by 3\.4°/)
  assert.equal((await run(home, ['sun', '--at', '38.5725,-7.9075', '--date', '2024-07-16', ...P])).status, 1)
})

test('weather reads Open-Meteo\'s archive for a day; -p records one hour as an inferred clue; a day without data fails clearly', async () => {
  const fake = await startFake(), home = casesFolder(), dir = path.join(home, 'durand-bakery-example')
  try {
    await run(home, NEW)
    const r = await run(home, ['weather', '--at', '38.5725,-7.9075', '--date', '2024-07-16', '--hour', '14', ...P, '--json'], fakeEnv(fake.url))
    assert.equal(r.status, 0, r.err)
    const o = JSON.parse(r.out)
    assert.equal(o.rows.length, 24)
    assert.deepEqual(o.recorded.row, { utc: '2024-07-16T14:00Z', hour: 14, cloud_cover: 0, sunshine_min: 60, precipitation_mm: 0, snowfall_cm: 0, weather_code: 0, temperature_c: 29 })
    const f = fs.readdirSync(path.join(dir, 'Clues')).find(n => n.includes('Weather'))
    assert.equal(readNote(path.join(dir, 'Clues', f)).props.status, 'inferred')
    assert.match(read(dir, `Clues/${f}`), /cloud cover 0 %, sunshine 60 min/)
    const none = await run(home, ['weather', '--at', '38.5725,-7.9075', '--date', '2024-07-17'], fakeEnv(fake.url))
    assert.equal(none.status, 1)
    assert.match(none.err, /Open-Meteo answered 404/)
  } finally { fake.close() }
})
