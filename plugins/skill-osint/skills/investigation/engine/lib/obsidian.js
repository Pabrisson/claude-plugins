// Obsidian opens obsidian://open?path=… only inside a vault it knows: those of its obsidian.json, which it reads once at
// its start and rewrites whole from memory afterwards. « Open in Obsidian » registers the case's investigation there
// (the top case and its sub-cases, each a vault), as « Open folder as vault » would, while Obsidian is not running;
// while it runs, what is written would be lost, so the dashboard says how to add the folder by hand.
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// its obsidian.json, in the first of its config folders that exists (Linux: native, Flatpak, Snap); null: never opened here.
// OSINT_OBSIDIAN_CONFIG names another file (tests and demos never touch the real one)
export function obsidianConfig(env = process.env, home = os.homedir(), platform = process.platform) {
  if (env.OSINT_OBSIDIAN_CONFIG) return env.OSINT_OBSIDIAN_CONFIG
  const dirs = platform === 'darwin' ? [path.join(home, 'Library', 'Application Support', 'obsidian')]
    : platform === 'win32' ? [path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'obsidian')]
    : [path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'obsidian'), path.join(home, '.var', 'app', 'md.obsidian.Obsidian', 'config', 'obsidian'), path.join(home, 'snap', 'obsidian', 'current', '.config', 'obsidian')]
  const dir = dirs.find(d => fs.existsSync(d))
  return dir ? path.join(dir, 'obsidian.json') : null
}

// its main process among this machine's; an unknown answer counts as running (nothing is written then)
export function obsidianRunning(platform = process.platform) {
  try {
    if (platform === 'win32') return /^"obsidian\.exe"/im.test(execFileSync('tasklist', ['/FI', 'IMAGENAME eq Obsidian.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true }))
    return execFileSync('ps', ['-A', '-o', 'comm='], { encoding: 'utf8', windowsHide: true }).split('\n').some(l => /^obsidian$/i.test(path.basename(l.trim())))
  } catch { return true }
}

const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b)
const inside = (dir, vault) => same(dir, vault) || same(dir.slice(0, vault.length + 1), vault + path.sep)

// dirs[0] opens in Obsidian: { ok } when a vault holds it (already, or registered now with the other dirs), else why not:
// { ok: false, running } (Obsidian runs and does not know it), { ok: false, missing } (never opened here), or { ok: false }
// (its file unreadable: left as it is)
export function registerVaults(dirs, { file = obsidianConfig(), running = obsidianRunning } = {}) {
  if (!file) return { ok: false, missing: true }
  let conf
  try { conf = JSON.parse(fs.readFileSync(file, 'utf8')) } catch (e) { if (e.code !== 'ENOENT') return { ok: false }; conf = {} }
  const vaults = conf.vaults && typeof conf.vaults === 'object' ? conf.vaults : {}
  const known = Object.values(vaults).filter(v => typeof v?.path === 'string' && v.path).map(v => path.resolve(v.path))
  const todo = dirs.map(d => path.resolve(d)).filter(d => !known.some(v => inside(d, v)))
  if (!todo.length) return { ok: true, added: 0 }
  if (running()) return { ok: known.some(v => inside(path.resolve(dirs[0]), v)), running: true }
  for (const d of todo) vaults[randomBytes(8).toString('hex')] = { path: d, ts: Date.now() }
  conf.vaults = vaults
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(conf))
  fs.renameSync(tmp, file)
  return { ok: true, added: todo.length }
}
