// Datasets the whole cases folder shares (WhatsMyName, disposable email domains, libphonenumber, ARCEP, Tor exits,
// cloud ranges): downloaded once, kept under <home>/.cache/datasets/<id> with <id>.json (from where, when, SHA-256,
// size, what describe() says of it), given from there until it is `hours` old. A failed download with a copy at hand
// gives the copy, marked stale; without one it throws. describe() doubles as a check: a download it cannot read (an
// error page instead of JSON) is refused and the copy stays.
import fs from 'node:fs'
import path from 'node:path'
import { request, SERVICES } from './net.js'
import { fail, nowIso, readJson, sha256, writeAtomic, writeJson } from './util.js'

const MAX = 64e6
export const datasetsDir = home => path.join(home, '.cache', 'datasets')
const publicUrl = (service, rel) => (service === 'web' ? rel : `${SERVICES[service]}${rel}`)

export async function dataset(home, id, { service, path: rel, hours, encoding = 'utf8', describe } = {}) {
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(String(id))) fail(`dataset id ${id}: lowercase letters, digits and -`)
  if (!(hours > 0)) fail(`dataset ${id}: hours must be above 0`)
  const file = path.join(datasetsDir(home), id), metaFile = `${file}.json`
  let meta = null
  try { meta = readJson(metaFile, null) } catch { meta = null } // a damaged <id>.json is no copy: the dataset is downloaded again
  if (meta && !(Number.isFinite(Date.parse(meta.at)) && typeof meta.url === 'string')) meta = null
  const have = !!meta && fs.existsSync(file)
  const copy = extra => ({ text: fs.readFileSync(file).toString(encoding), at: meta.at, url: meta.url, sha256: meta.sha256, size: meta.size, cached: true, ...extra })
  if (have && Date.now() - Date.parse(meta.at) < hours * 3600e3) return copy()
  try {
    const r = await request(service, rel, { timeout: 120000, max: MAX, retries: 1 })
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`)
    if (r.truncated) throw new Error(`larger than ${MAX / 1e6} MB`)
    const text = r.body.toString(encoding), about = describe ? describe(text) : undefined
    writeAtomic(file, r.body)
    const m = { id, url: publicUrl(service, rel), at: nowIso(), sha256: sha256(r.body), size: r.body.length, hours, ...(about != null && { about: String(about) }) }
    writeJson(metaFile, m)
    return { text, at: m.at, url: m.url, sha256: m.sha256, size: m.size, cached: false }
  } catch (e) {
    if (e.userError) throw e // a host net.js refuses is never hidden behind a copy
    if (have) return copy({ stale: true, error: e.message })
    throw new Error(`dataset ${id}: ${e.message}, and no copy in ${datasetsDir(home)}`)
  }
}

// every dataset kept in this folder, for doctor's lines
export function datasetsInfo(home) {
  const d = datasetsDir(home)
  if (!fs.existsSync(d)) return []
  return fs.readdirSync(d).filter(f => f.endsWith('.json')).sort()
    .map(f => { try { return readJson(path.join(d, f), null) } catch { return null } }).filter(m => m?.id && fs.existsSync(path.join(d, m.id)))
}
