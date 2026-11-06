// npm test: every t("…") of the dashboard has its French (same {placeholders}), and every word a type shows has its
// type.json "fr" entry (the fields localize() and own() translate)
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const src = path.join(import.meta.dirname, "src")
const FR = JSON.parse(fs.readFileSync(path.join(src, "lib/fr.json"), "utf8"))
const holes = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(",")

test("every t() key has its French, with the same placeholders", () => {
  const files = fs.readdirSync(src, { recursive: true }).filter(f => /\.tsx?$/.test(f))
  const missing = [], wrong = []
  for (const f of files) {
    const code = fs.readFileSync(path.join(src, f), "utf8")
    for (const m of code.matchAll(/\bt\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1\s*[,)]/g)) {
      if (m[1] === "`" && m[2].includes("${")) continue // a key built from literals: listed in fr.json by hand
      const key = m[2].replace(/\\(.)/g, "$1")
      if (!(key in FR)) missing.push(`${f}: ${key}`)
      else if (holes(key) !== holes(FR[key])) wrong.push(`${f}: ${key} → ${FR[key]}`)
    }
  }
  assert.deepEqual(missing, [], "keys without French")
  assert.deepEqual(wrong, [], "placeholders that differ")
})

test("every shown word of each type has its fr entry", () => {
  const types = path.join(import.meta.dirname, "../../../plugins/skill-osint/skills/investigation/types")
  const SHOWN = new Set(["label", "description", "placeholder", "help", "why", "legal_basis", "high", "medium", "low"])
  const missing = []
  for (const id of fs.readdirSync(types)) {
    const m = JSON.parse(fs.readFileSync(path.join(types, id, "type.json"), "utf8"))
    const walk = (v, k) => {
      if (typeof v === "string") { if (SHOWN.has(k) && !(v in (m.fr ?? {})) && k !== "placeholder") missing.push(`${id}: ${v}`) }
      else if (Array.isArray(v)) v.forEach(x => walk(x, k))
      else if (v && typeof v === "object") for (const [kk, x] of Object.entries(v)) if (kk !== "fr" && kk !== "requires" && kk !== "refresh") walk(x, kk)
    }
    walk(m, "")
  }
  assert.deepEqual(missing, [])
})
