// What this machine's user armed, kept in dataDir()/watch-ok.json and never in a cases folder: a folder is a thing one
// receives (git, a zip, a share), so nothing written in it may say « run this unattended ». Per cases folder (its
// realpath): the cases whose watch the user set here (a local `watch --every`), and the private types the user said
// yes to, each with the hash of the code that yes covered. The watch and the dashboard (OSINT_BY=watch|dashboard) run a
// private type's engine.js only for that hash; the watch runs a case only if it was armed here.
// ponytail: read-modify-write without a lock (one user, a click or a command at a time); lock it if two ever race
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { dataDir, readJson, writeJson } from './util.js'

const file = () => path.join(dataDir(), 'watch-ok.json')
const key = home => { try { return fs.realpathSync(home) } catch { return path.resolve(home) } }
const load = () => { try { const j = readJson(file(), {}); return j && typeof j === 'object' && !Array.isArray(j) ? j : {} } catch { return {} } }
const mine = (all, home) => ({ types: {}, cases: {}, ...all[key(home)] })
const edit = (home, fn) => { const all = load(), m = mine(all, home); fn(m); all[key(home)] = m; writeJson(file(), all) }

// what a yes covers: the manifest and the code, from the bytes about to run
export const digestOf = (typeJson, engineJs) => {
  const h = createHash('sha256')
  for (const [f, b] of [['type.json', typeJson], ['engine.js', engineJs]]) { h.update(`${f}\0`); if (b) h.update(b) }
  return h.digest('hex')
}
const read = f => { try { return fs.readFileSync(f) } catch { return null } }
export const typeDigest = m => digestOf(read(path.join(m.dir, 'type.json')), read(path.join(m.dir, 'engine.js')))

export const approvedHash = (home, id) => mine(load(), home).types[id] ?? null
export const approveType = (home, m) => edit(home, x => { x.types[m.id] = typeDigest(m) })
export const isArmed = (home, slug, type) => mine(load(), home).cases[slug] === type
export const arm = (home, slug, type) => edit(home, x => { x.cases[slug] = type })
export const disarm = (home, slug) => edit(home, x => { delete x.cases[slug] })
// a process the user is not at (the watch, a dashboard click) runs a private type only for what was approved here
export const unattended = () => ['watch', 'dashboard'].includes(process.env.OSINT_BY)
