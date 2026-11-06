// lib/templates.js — the notes' templates (a type's own file wins over the engine's) and the words the engine writes
// itself, in the case's language (en and fr; English for the others).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { findType } from './types.js'
import { readJson } from './util.js'

export const ENGINE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const LABELS = readJson(path.join(ENGINE, 'labels.json'))
// OSINT_TYPES: the tests' own types folder
// the cases folder's own types (stage 13), versioned with its cases
export const privateTypesDir = home => path.join(home, '.osint-types')
export const typesDir = () => (process.env.OSINT_TYPES ? path.resolve(process.env.OSINT_TYPES) : path.join(ENGINE, '..', 'types'))
export function labels(lang = 'en', typeLabels = {}) {
  const l = String(lang).slice(0, 2).toLowerCase()
  return { ...LABELS.en, ...(typeLabels.en ?? {}), ...(LABELS[l] ?? {}), ...(typeLabels[l] ?? {}) }
}
// What a third party wrote (an EXIF/XMP caption, a C2PA title, a page, a Yandex label, an OCR text) reaches the notes
// through here and nowhere else: markdown that would load an image (![](…)), link, embed or close an engine block
// (%% osint:end … %%, so each % next to another) is escaped, line breaks become spaces. Numbers go as they are.
export const safe = v => (typeof v === 'string' ? v.replace(/\r?\n|\r|\u2028|\u2029/g, ' ').replace(/[\\!\[\]<>`]|%(?=%)|(?<=%)%/g, c => `\\${c}`) : v)
export const fill = (text, vars) => String(text).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? safe(vars[k]) : m))
// every value goes through safe: a third party's title never loads an image from the note's heading
// the type's folder is the loaded one's (the plugin's or the cases folder's), never found by name in types/
export function template(name, type, vars = {}, home) {
  const own = findType(type, home)?.dir
  const file = [own && path.join(own, 'templates', name), path.join(ENGINE, 'templates', name)].find(f => f && fs.existsSync(f))
  return fs.readFileSync(file, 'utf8').replace(/\{\{(\w+)\}\}/g, (_, k) => safe(vars[k] ?? ''))
}
