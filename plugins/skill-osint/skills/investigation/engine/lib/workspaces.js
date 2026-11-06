// Workspaces: groups of investigations, like media-generator's. A workspace is a name, never a folder: each case stays
// where it is (its vault), its case.json says `workspace` (none: « default »), the whole tree of an investigation
// shares its root's. The list and the current one live in .osint-settings.json; new cases join the current one.
import path from 'node:path'
import { caseDir, descendants, listCases, parents, readCase, rootOf, updateCase } from './case.js'
import { fail, readJson, slugify, writeJson } from './util.js'
import { settingsFile } from './watch.js'

const DEFAULT = { slug: 'default', name: 'Default workspace' }
export function workspaces(home) {
  const w = readJson(settingsFile(home), {}).workspaces ?? {}
  const list = (Array.isArray(w.list) ? w.list : []).filter(x => typeof x?.slug === 'string' && typeof x.name === 'string')
  if (!list.some(x => x.slug === 'default')) list.unshift(DEFAULT)
  return { current: list.some(x => x.slug === w.current) ? w.current : 'default', list }
}
const save = (home, w) => { writeJson(settingsFile(home), { ...readJson(settingsFile(home), {}), workspaces: w }); return workspaces(home) }
const named = name => {
  const n = String(name ?? '').trim()
  if (!n) fail('a workspace needs a name')
  if (n.length > 60) fail('a workspace name takes 60 characters at most')
  return n
}
const known = (w, slug) => w.list.find(x => x.slug === slug) ?? fail(`no workspace ${slug} (${w.list.map(x => x.slug).join(', ')})`)
// a case's workspace: its root's, « default » when that one is gone from the list
export function workspaceOf(home, slug, w = workspaces(home), up = parents(home)) {
  const ws = readCase(path.join(home, rootOf(home, slug, up))).workspace ?? 'default'
  return w.list.some(x => x.slug === ws) ? ws : 'default'
}

// a new workspace becomes the current one
export function newWorkspace(home, name) {
  const w = workspaces(home), n = named(name), base = slugify(n) || 'workspace'
  let slug = base
  for (let i = 2; w.list.some(x => x.slug === slug); i++) slug = `${base}-${i}`
  return { slug, ...save(home, { current: slug, list: [...w.list, { slug, name: n }] }) }
}
export const useWorkspace = (home, slug) => { const w = workspaces(home); known(w, slug); return save(home, { ...w, current: slug }) }
export function renameWorkspace(home, slug, name) {
  const w = workspaces(home), n = named(name)
  known(w, slug)
  return save(home, { ...w, list: w.list.map(x => (x.slug === slug ? { ...x, name: n } : x)) })
}
// its cases go back to the default workspace, never deleted
export function removeWorkspace(home, slug) {
  if (slug === 'default') fail('the default workspace stays (rename it instead)')
  const w = workspaces(home)
  known(w, slug)
  const moved = listCases(home).filter(s => readCase(path.join(home, s)).workspace === slug)
  for (const s of moved) updateCase(path.join(home, s), c => { delete c.workspace })
  return { moved, ...save(home, { current: w.current === slug ? 'default' : w.current, list: w.list.filter(x => x.slug !== slug) }) }
}
// a case moves with its whole investigation: its root and every case below it
export function moveCase(home, slug, to) {
  known(workspaces(home), to)
  caseDir(home, slug)
  const up = parents(home), root = rootOf(home, slug, up), tree = [root, ...descendants(home, root, up).map(x => x.slug)]
  for (const s of tree) updateCase(path.join(home, s), c => { if (to === 'default') delete c.workspace; else c.workspace = to })
  return { root, cases: tree, workspace: to }
}
