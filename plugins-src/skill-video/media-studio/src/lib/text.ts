// A text result's words: a tile's preview, a JSON file's colored parts in the viewer
// a text file's first words for its tile: captions without their numbers and times, a JSON on one line, at most 400
// characters
export const textPreview = (file: string, t: string) =>
  (/\.(srt|vtt)$/i.test(file)
    ? t.split(/\r?\n/).filter((l) => l.trim() && !/^\d+$/.test(l.trim()) && !l.includes("-->") && l.trim() !== "WEBVTT").join(" ")
    : /\.json$/i.test(file)
      ? t.replace(/\s+/g, " ")
      : t.replace(/\n{3,}/g, "\n\n")
  ).trim().slice(0, 400)

// a JSON file laid out and colored, keys, strings, numbers, booleans and null each their own (on the viewer's black)
const JSON_TOKEN = /("(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b)/g
export function jsonParts(text: string) {
  let pretty = text
  try {
    pretty = JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    /* not JSON after all: colored as it is */
  }
  // the split keeps each token at an odd place; a string followed by a colon is a key
  const parts = pretty.split(JSON_TOKEN)
  return parts.map((p, i) => ({
    text: p,
    kind: i % 2 === 0 ? null : p.startsWith('"') ? (/^\s*:/.test(parts[i + 1] ?? "") ? "key" : "string") : p === "true" || p === "false" ? "boolean" : p === "null" ? "null" : "number",
  }))
}
