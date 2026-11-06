// One fake server for every service the engine calls, routed by path prefix (/rdap, /crtsh, /cdx, /spn, /ripestat,
// /internetdb, /web/<host>/…). It answers from test/fixtures and records the host each request was meant for (the
// engine sends it in x-osint-host). fakeEnv(url) points the engine at it, DNS included (a fixture resolver).
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { FIXTURES } from './helpers.js'

export const SERVICES = ['rdap', 'crtsh', 'cdx', 'spn', 'ripestat', 'internetdb', 'web', 'nominatim', 'openmeteo', 'mapillary', 'hf', 'doh', 'raw', 'entreprises', 'bodacc', 'gravatar', 'xon', 'arcep', 'tor', 'aws', 'gcp', 'cloudflare', 'geopf', 'overpass', 'panoramax', 'kartaview', 'esri']
export const fakeEnv = (url, fixtures = FIXTURES) => ({
  ...Object.fromEntries(SERVICES.map(s => [`OSINT_BASE_${s.toUpperCase()}`, `${url}/${s}`])),
  OSINT_DNS: path.join(fixtures, 'dns.json'),
})
const slugOf = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const fileSafe = s => String(s ?? '').replace(/:/g, '_') // an IPv6 address names a fixture on Windows too
export function fixtureOf(service, rest, q) {
  switch (service) {
    case 'rdap': return rest.startsWith('domain/') ? `rdap/domain-${rest.slice(7)}.json` : rest.startsWith('autnum/') ? `rdap/autnum-${rest.slice(7)}.json` : rest.startsWith('ip/') ? `rdap/ip-${fileSafe(rest.slice(3))}.json` : null
    case 'crtsh': return `crtsh/${(q.get('q') ?? '').replace(/^%\./, '')}.json`
    case 'cdx': {
      // a domain keeps its name; a page (an address with a path) becomes a name without ':' or '/' (Windows)
      const u = q.get('url') ?? '', name = u.includes('/') ? `pages/${u.replace(/^https?:\/\//, '').replace(/[^\w.-]+/g, '_')}` : u
      return `cdx/${name}-${q.get('collapse') ? 'changes' : q.get('limit') === '1' ? 'first' : 'last'}.json`
    }
    case 'ripestat': return `ripestat/${rest.split('/')[1]}-${fileSafe(q.get('resource'))}.json`
    case 'internetdb': return `internetdb/${fileSafe(rest)}.json`
    case 'spn': return 'spn/save.html'
    case 'web': return `web/${rest.endsWith('/') || !rest.includes('/') ? `${rest.replace(/\/$/, '')}/index.html` : rest}`
    case 'nominatim': return rest === 'search' ? `nominatim/search-${slugOf(q.get('q'))}.json` : rest === 'reverse' ? `nominatim/reverse-${q.get('lat')},${q.get('lon')}.json` : `nominatim/${rest}.json`
    case 'openmeteo': return `openmeteo/${q.get('latitude')},${q.get('longitude')}-${q.get('start_date')}.json`
    case 'mapillary': return `mapillary/${rest}.json`
    case 'hf': return `hf/${rest}.json`
    case 'raw': return `raw/${rest}`
    case 'entreprises': {
      // the registry's searches: a company by its number or its name, or the companies of an officer
      const slug = slugOf
      if (rest === 'near_point') return `entreprises/near-${q.get('lat')},${q.get('long')}-${q.get('page') ?? 1}.json`
      if (rest !== 'search') return null
      if (q.get('nom_personne')) return `entreprises/person-${slug(q.get('nom_personne'))}-${slug(String(q.get('prenoms_personne') ?? '').trim().split(/\s+/)[0])}.json`
      return `entreprises/search-${slug(q.get('q'))}.json`
    }
    case 'bodacc': {
      const siren = /registre="(\d+)"/.exec(q.get('where') ?? '')?.[1]
      return siren ? `bodacc/${siren}.json` : null
    }
    case 'gravatar': return rest.startsWith('v3/profiles/') ? `gravatar/${rest.slice(12)}.json` : null
    case 'xon': return rest.startsWith('v1/check-email/') ? `xon/${rest.slice(15)}.json` : null
    case 'tor': case 'aws': case 'gcp': case 'cloudflare': { const f = rest.split('/').pop(); return `${service}/${f}${f.includes('.') ? '' : '.txt'}` }
    case 'arcep': return `arcep/${rest}`
    case 'geopf': return rest === 'geocodage/reverse' ? `geopf/reverse-${q.get('lat')},${q.get('lon')}.json` : rest === 'geocodage/search' ? `geopf/search-${slugOf(q.get('q'))}.json` : null
    case 'overpass': {
      if (rest === 'api/status') return 'overpass/status.txt'
      const m = /around:\d+,(-?[\d.]+),(-?[\d.]+)/.exec(q.get('data') ?? '')
      return rest === 'api/interpreter' && m ? `overpass/${m[1]},${m[2]}.json` : null
    }
    case 'panoramax': {
      if (rest === 'api') return 'panoramax/api.json'
      const [lon, lat] = String(q.get('place_position') ?? '').split(',')
      return rest === 'api/search' && lat ? `panoramax/${lat},${lon}.json` : null
    }
    case 'kartaview': return rest.replace(/\/$/, '') === '2.0/photo' ? `kartaview/${q.get('lat')},${q.get('lng')}.json` : null
    case 'esri': return rest === 'config.maptiles.arcgis.com/waybackconfig.json' ? 'esri/waybackconfig.json' : null
    case 'doh': return `doh/${q.get('name')}.json`
    default: return null
  }
}
const TYPE = { '.json': 'application/json', '.html': 'text/html; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.jsonl': 'application/x-ndjson', '.csv': 'text/csv', '.xml': 'application/xml' }
export function startFake({ port = 0, fixtures = FIXTURES } = {}) {
  const seen = [], tunnels = new Map()
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fake'), [, service, ...rest] = url.pathname.split('/')
    if (url.pathname === '/__fake') return res.end('{"fake":true}')
    // the fake cloudflared registers its public name: /web/<that name>/… goes on to the local server it tunnels
    if (url.pathname === '/__tunnel' && req.method === 'POST') {
      let b = ''
      for await (const c of req) b += c
      const { host, target } = JSON.parse(b)
      tunnels.set(host, target)
      return res.end('{}')
    }
    seen.push({ host: req.headers['x-osint-host'] ?? null, service, path: url.pathname, query: url.searchParams, method: req.method })
    if (service === 'web' && tunnels.has(rest[0])) {
      const r = await fetch(`${tunnels.get(rest[0])}/${rest.slice(1).join('/')}${url.search}`, { headers: { 'user-agent': req.headers['user-agent'] ?? '' } }).catch(() => null)
      if (!r) { res.writeHead(502); return res.end() }
      res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') ?? 'application/octet-stream' })
      return res.end(Buffer.from(await r.arrayBuffer()))
    }
    const rel = fixtureOf(service, decodeURIComponent(rest.join('/')), url.searchParams)
    let file = rel && path.join(fixtures, rel), status = 200
    if (file && !fs.existsSync(file) && fs.existsSync(`${file}.html`)) file += '.html'
    // a recorded 404 answer: <fixture>.404.json (Gravatar's « Profile not found »)
    const gone = file && file.replace(/(\.\w+)?$/, '.404$1')
    if (file && !fs.existsSync(file) && fs.existsSync(gone)) { file = gone; status = 404 }
    if (!file || !fs.existsSync(file)) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end('{"errorCode":404}') }
    res.writeHead(status, { 'Content-Type': TYPE[path.extname(file)] ?? 'application/octet-stream' })
    fs.createReadStream(file).pipe(res)
  })
  return new Promise((ok, ko) => {
    server.once('error', ko)
    server.listen(port, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${server.address().port}`, seen, close: () => server.close() }))
  })
}
