// The sun's place in the sky by NOAA's formulas (Meeus; about 0.01° from 1950 to 2050, standard refraction), as
// GeoINT's sun.py computes it: azimuth from north clockwise, elevation above the horizon, the shadow of a 1 m stick.
// A local time in an IANA zone becomes UTC by the platform's time-zone data. And the weather of a day at a place
// (Open-Meteo's archive: ERA5 reanalysis, about 9 km, from 1940 to about five days ago).
import { caseLabels } from './case.js'
import { request, SERVICES } from './net.js'
import { clue, source } from './records.js'
import { fill } from './templates.js'
import { fail } from './util.js'

const R = d => (d * Math.PI) / 180, D = r => (r * 180) / Math.PI
function core(ms) {
  const jd = ms / 86400e3 + 2440587.5, t = (jd - 2451545) / 36525
  const l0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t)
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t)
  const c = Math.sin(R(m)) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(R(2 * m)) * (0.019993 - 0.000101 * t) + Math.sin(R(3 * m)) * 0.000289
  const app = l0 + c - 0.00569 - 0.00478 * Math.sin(R(125.04 - 1934.136 * t))
  const ob = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(R(125.04 - 1934.136 * t))
  const decl = D(Math.asin(Math.sin(R(ob)) * Math.sin(R(app)))), y = Math.tan(R(ob / 2)) ** 2
  const eqt = 4 * D(y * Math.sin(2 * R(l0)) - 2 * e * Math.sin(R(m)) + 4 * e * y * Math.sin(R(m)) * Math.cos(2 * R(l0)) - 0.5 * y * y * Math.sin(4 * R(l0)) - 1.25 * e * e * Math.sin(2 * R(m)))
  return { decl, eqt }
}
function refraction(h) {
  if (h > 85) return 0
  const te = Math.tan(R(h))
  const r = h > 5 ? 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5 : h > -0.575 ? 1735 + h * (-518.2 + h * (103.4 + h * (-12.79 + h * 0.711))) : -20.772 / te
  return r / 3600
}
export function sunPosition(lat, lon, date) {
  const { decl, eqt } = core(date.getTime())
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60 + date.getUTCMilliseconds() / 6e4
  const tst = (((minutes + eqt + 4 * lon) % 1440) + 1440) % 1440, ha = tst / 4 - 180
  const cz = Math.sin(R(lat)) * Math.sin(R(decl)) + Math.cos(R(lat)) * Math.cos(R(decl)) * Math.cos(R(ha))
  const zen = D(Math.acos(Math.max(-1, Math.min(1, cz)))), den = Math.cos(R(lat)) * Math.sin(R(zen))
  let azimuth = 180
  if (Math.abs(den) > 1e-9) {
    const ca = Math.max(-1, Math.min(1, (Math.sin(R(lat)) * Math.cos(R(zen)) - Math.sin(R(decl))) / den))
    azimuth = ha > 0 ? (D(Math.acos(ca)) + 180) % 360 : (540 - D(Math.acos(ca))) % 360
  }
  const elevation = 90 - zen + refraction(90 - zen)
  return { azimuth, elevation, shadow_bearing: (azimuth + 180) % 360, shadow_ratio: elevation > 0 ? 1 / Math.tan(R(elevation)) : null }
}

// "2024-07-16T14:30" in Europe/Lisbon → that instant (the zone's offset that day, summer time included)
export function zonedToUtc(local, tz) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(String(local))
  if (!m) return null
  const [y, mo, d, h, mi, s] = m.slice(1).map(x => Number(x ?? 0)), want = Date.UTC(y, mo - 1, d, h, mi, s)
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  let t = want
  for (let i = 0; i < 2; i++) {
    const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map(x => [x.type, x.value]))
    t += want - Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second)
  }
  return new Date(t)
}
// --date: an instant with its zone (2024-07-16T14:30+01:00, …Z), a local time with --tz, or a day
export function parseWhen(date, tz) {
  const s = String(date ?? '').trim()
  if (!s) fail('--date 2024-07-16T14:30+01:00 (or …Z, a local time with --tz Europe/Lisbon, or a day: 2024-07-16)')
  if (tz) { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }) } catch { fail(`--tz ${tz}: an IANA time zone such as Europe/Lisbon`) } }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { day: s, tz: tz ?? 'UTC' }
  if (/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(s) && /T\d{2}:\d{2}/.test(s)) {
    const d = new Date(s)
    if (Number.isNaN(+d)) fail(`--date ${s}: not a date`)
    return { at: d }
  }
  if (!tz) fail(`--date ${s} has no zone: add +01:00 or Z, or give --tz Europe/Lisbon (an EXIF time is the local clock's)`)
  return { at: zonedToUtc(s, tz) ?? fail(`--date ${s}: expected 2024-07-16T14:30`) }
}

const r1 = x => Math.round(x * 10) / 10, r3 = x => Math.round(x * 1000) / 1000
const off = (a, b) => Math.abs(((a - b + 540) % 360) - 180)
export function sunAt([lat, lon], at, { bearing, ratio } = {}) {
  const p = sunPosition(lat, lon, at)
  return {
    at: at.toISOString(), lat, lon, azimuth: r1(p.azimuth), elevation: r1(p.elevation), shadow_bearing: r1(p.shadow_bearing), shadow_ratio: p.shadow_ratio == null ? null : r3(p.shadow_ratio),
    ...(bearing != null && { measured_bearing: Number(bearing), bearing_off: r1(off(p.shadow_bearing, Number(bearing))) }),
    ...(ratio != null && p.shadow_ratio != null && { measured_ratio: Number(ratio), ratio_off_pct: Math.round((Math.abs(p.shadow_ratio - Number(ratio)) / Number(ratio)) * 100) }),
  }
}
export function sunDay([lat, lon], day, tz, { bearing, ratio, tol = 5, step = 15 } = {}) {
  const rows = []
  for (let m = 0; m < 1440; m += step) {
    const local = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
    const s = sunAt([lat, lon], zonedToUtc(`${day}T${local}`, tz), { bearing, ratio })
    if (s.elevation > 0) rows.push({ local, ...s })
  }
  const measured = bearing != null || ratio != null
  const fits = rows.filter(r => (bearing == null || r.bearing_off <= Number(tol)) && (ratio == null || r.ratio_off_pct <= 15)).map(r => r.local)
  return { day, tz, lat, lon, rows, ...(measured && { fits }) }
}

export async function recordSun(dir, r) {
  const L = caseLabels(dir), at = `${r.lat},${r.lon}`, when = r.at ? `${r.at.slice(0, 16).replace('T', ' ')} UTC` : r.day, title = fill(L.sun_title, { at, when })
  const s = await source(dir, { url: `sun:${at}@${r.at ?? r.day}`, body: JSON.stringify(r, null, 2), contentType: 'application/json', title, reliability: 'A' })
  const text = r.at
    ? fill(L.sun_clue, { at, when, az: r.azimuth, el: r.elevation, sb: r.shadow_bearing, ratio: r.shadow_ratio ?? '—' })
      + (r.measured_bearing != null ? fill(L.sun_measured, { b: r.measured_bearing, d: r.bearing_off }) : '')
      + (r.measured_ratio != null ? fill(L.sun_ratio, { r: r.measured_ratio, d: r.ratio_off_pct }) : '')
    : fill(L.sun_fits, { day: r.day, tz: r.tz, at, times: r.fits.length ? r.fits.join(', ') : L.none })
  return { source: s.id, clue: clue(dir, text, { status: 'computed', sources: [s.id], title }).id }
}

const HOURLY = ['cloud_cover', 'sunshine_duration', 'precipitation', 'snowfall', 'weather_code', 'temperature_2m']
export async function weatherDay([lat, lon], day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day ?? ''))) fail('--date 2024-07-16: a day (the archive is hourly, in UTC)')
  const q = `latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&start_date=${day}&end_date=${day}&hourly=${HOURLY.join(',')}&timezone=UTC`
  const r = await request('openmeteo', `/v1/archive?${q}`, { timeout: 30000, retries: 1 })
  if (r.status !== 200) fail(`Open-Meteo answered ${r.status} for ${day} at ${lat},${lon} (its archive lags about five days)`)
  const j = JSON.parse(r.body.toString('utf8')), H = j.hourly
  if (!H?.time?.length) fail(`no weather for ${day} at ${lat},${lon} (the archive lags about five days)`)
  const rows = H.time.map((t, i) => ({ utc: `${t}Z`, hour: Number(t.slice(11, 13)), cloud_cover: H.cloud_cover[i], sunshine_min: Math.round((H.sunshine_duration[i] ?? 0) / 60), precipitation_mm: H.precipitation[i], snowfall_cm: H.snowfall[i], weather_code: H.weather_code[i], temperature_c: H.temperature_2m[i] }))
  return { day, lat, lon, grid: [j.latitude, j.longitude], url: `${SERVICES.openmeteo}/v1/archive?${q}`, body: r.body, rows }
}
// a reanalysis at about 9 km ranks days and hours; it cannot exclude a place: an inferred clue
export async function recordWeather(dir, w, hour) {
  const L = caseLabels(dir), row = w.rows.find(x => x.hour === hour) ?? fail(`--hour ${hour}: 0 to 23 (UTC)`), title = fill(L.weather_title, { at: `${w.lat},${w.lon}`, day: w.day })
  const s = await source(dir, { url: w.url, body: w.body, contentType: 'application/json', title, reliability: 'B' })
  const text = fill(L.weather_clue, { day: w.day, hour: String(hour).padStart(2, '0'), grid: w.grid.map(x => x.toFixed(2)).join(','), cloud: row.cloud_cover, sun: row.sunshine_min, rain: row.precipitation_mm, snow: row.snowfall_cm, temp: row.temperature_c, code: row.weather_code })
  return { source: s.id, clue: clue(dir, text, { status: 'inferred', sources: [s.id], title }).id, row }
}
