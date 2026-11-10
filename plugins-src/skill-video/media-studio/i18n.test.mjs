// npm test: every t("…") of the dashboard has its French (same {placeholders}) in src/lib/fr.json, and every word the
// engine's catalogs show (tools, their fields, options, presets and style lists, the models' options, why a model is
// recommended) has its French in the engine's tools/fr.json, read by own()
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const src = path.join(import.meta.dirname, "src")
const engine = path.join(import.meta.dirname, "../../../plugins/skill-video/skills/media-generator/engine")
const read = f => JSON.parse(fs.readFileSync(f, "utf8"))
const holes = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(",")

test("every t() key has its French, with the same placeholders", () => {
  const FR = read(path.join(src, "lib/fr.json"))
  const files = fs.readdirSync(src, { recursive: true }).filter(f => /\.tsx?$/.test(f) && !f.endsWith(".check.ts"))
  const missing = [], wrong = []
  for (const f of files) {
    const code = fs.readFileSync(path.join(src, f), "utf8")
    for (const m of code.matchAll(/\bt\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1\s*[,)]/g)) {
      if (m[1] === "`" && m[2].includes("${")) continue // a key built from literals: listed in fr.json by hand
      const key = m[2].replace(/\\(.)/g, "$1")
      if (!(key in FR)) missing.push(`${f}: ${key}`)
      else if (holes(key) !== holes(FR[key])) wrong.push(`${f}: ${key} → ${FR[key]}`)
    }
    // a plural, or two words by a condition: t(n > 1 ? "…" : "…")
    for (const m of code.matchAll(/\bt\(\s*[^"'`()]*?\?\s*(["'])((?:\\.|(?!\1)[^\\])*)\1\s*:\s*(["'])((?:\\.|(?!\3)[^\\])*)\3\s*[,)]/g))
      for (const key of [m[2], m[4]].map(k => k.replace(/\\(.)/g, "$1"))) {
        if (!(key in FR)) missing.push(`${f}: ${key}`)
        else if (holes(key) !== holes(FR[key])) wrong.push(`${f}: ${key} → ${FR[key]}`)
      }
  }
  assert.deepEqual(missing, [], "keys without French")
  assert.deepEqual(wrong, [], "placeholders that differ")
})

// the words a person reads in the catalogs; a value, a template, a phrase or a rig's words go to the models as written
const SHOWN = new Set(["label", "group", "description", "placeholder", "note", "section", "hint"])
export function shownWords() {
  const words = new Set()
  // an option without a label shows its value as written (a camera body, « close-up », « dolly in »)
  const bare = o => (typeof o === "string" ? o : o && typeof o === "object" && !o.label && typeof o.value === "string" ? o.value : null)
  const walk = (v, k, inWhy) => {
    if (typeof v === "string") { if ((inWhy && k !== "about") || SHOWN.has(k)) words.add(v) }
    else if (Array.isArray(v)) v.forEach(x => walk(x, k, inWhy))
    else if (v && typeof v === "object") for (const [kk, x] of Object.entries(v)) walk(x, kk, inWhy || kk === "why")
  }
  const lists = {}
  for (const f of fs.readdirSync(path.join(engine, "tools")).filter(f => /^(styles|.+-styles|stems)\.json$/.test(f))) {
    lists[f.replace(/\.json$/, "")] = read(path.join(engine, "tools", f))
    // the option lists a field names (styles, music-styles…)
    walk(lists[f.replace(/\.json$/, "")], "", false)
  }
  for (const kind of ["image", "video", "audio"]) {
    const tools = read(path.join(engine, `tools/${kind}.json`))
    walk(tools, "", false)
    for (const x of tools.flatMap(tool => [...tool.fields, ...(tool.inputs ?? [])])) {
      const opts = typeof x.options === "string" ? lists[x.options] : x.options
      for (const o of Array.isArray(opts) ? opts : []) if (bare(o)) words.add(bare(o))
    }
  }
  walk(read(path.join(engine, "tools/why.json")), "", true)
  // the models' own options: their label, hint and values' labels
  for (const f of ["kie-models.json", "openrouter-models.json"]) {
    const list = read(path.join(engine, "providers", f))
    for (const m of [...(list.image ?? []), ...(list.video ?? []), ...(list.speech ?? [])])
      for (const o of m.options ?? []) if (o && typeof o === "object") {
        for (const k of ["label", "hint"]) if (o[k]) words.add(o[k])
        for (const x of o.values ?? []) if (x && typeof x === "object" && x.label) words.add(x.label)
        else if (bare(x)) words.add(bare(x))
      }
  }
  // the options the engine builds in its code (ElevenLabs', the routers' common ones) and its own job labels
  const str = "'((?:\\\\.|[^'\\\\])*)'", unq = x => x.replace(/\\(.)/g, "$1")
  for (const f of ["providers/elevenlabs.js", "lib/options.js"]) {
    const code = fs.readFileSync(path.join(engine, f), "utf8")
    for (const m of code.matchAll(new RegExp(`\\b(?:label|hint):\\s*${str}`, "g"))) words.add(unq(m[1]))
    for (const m of code.matchAll(new RegExp(`\\bslider\\(\\s*${str},\\s*${str}[^)]*?(?:,\\s*${str})?\\s*\\)`, "g"))) [m[2], m[3]].filter(Boolean).forEach(w => words.add(unq(w)))
    for (const m of code.matchAll(new RegExp(`\\byes\\(\\s*${str},\\s*${str},\\s*${str}`, "g"))) [m[2], m[3]].forEach(w => words.add(unq(w)))
  }
  words.add("Imported")
  return words
}

test("every word the catalogs show has its French in the engine's tools/fr.json", () => {
  const FR = read(path.join(engine, "tools/fr.json"))
  const missing = [...shownWords()].filter(w => !(w in FR))
  assert.deepEqual(missing, [], `${missing.length} catalog words without French`)
  const wrong = Object.entries(FR).filter(([en, fr]) => holes(en) !== holes(fr))
  assert.deepEqual(wrong, [], "placeholders that differ")
})
