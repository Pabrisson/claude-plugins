// node src/lib/filters.check.ts: the pickers' filters and sorts
import assert from "node:assert/strict"
import type { Job } from "./api.ts"
import { activeFilters, factsOf, NO_FILTERS, passes, ratioOf, resOf, sorted } from "./filters.ts"

const item = (id: string, file: string, meta: { w?: number; h?: number; dur?: number }, favorite = false, tool = "free") => ({ path: `/m/${id}/${file}`, job: { id, label: id, tool, favorite, meta: { [file]: meta } } as unknown as Job })
// newest first, as the engine lists them
const list = [item("d", "a.mp4", { w: 1920, h: 1080, dur: 4 }), item("c", "b.png", { w: 1024, h: 1024 }, true), item("b", "c.mp4", { w: 720, h: 1280, dur: 9 }), item("a", "v.mp3", { dur: 2 })]
const ids = (l: typeof list) => l.map((i) => i.job.id).join("")

assert.deepEqual([ratioOf(1920, 1080), ratioOf(720, 1280), ratioOf(1000, 300), resOf(1920, 1080), resOf(3840, 2160), resOf(640, 360)], ["16:9", "9:16", "other", "1080p", "4K", "≤480p"])
// filters: a medium, a format, a quality, the favorites; a sound has no format, so a format filter leaves it out
assert.equal(ids(list.filter((i) => passes(i, { ...NO_FILTERS, kind: "video" }))), "db")
assert.equal(ids(list.filter((i) => passes(i, { ...NO_FILTERS, ratio: "16:9" }))), "d")
assert.equal(ids(list.filter((i) => passes(i, { ...NO_FILTERS, res: "720p" }))), "b")
assert.equal(ids(list.filter((i) => passes(i, { ...NO_FILTERS, favorites: true }))), "c")
// a sound's type by its tool and its file's format; a picture is no sound of any type
const sounds = [item("s1", "a.mp3", {}, false, "voice"), item("s2", "b.wav", {}, false, "wav"), item("s3", "c.mp3", {}, false, "sound-effect"), item("s4", "d.mp3", {}, false, "import"), list[0]]
assert.equal(ids(sounds.filter((i) => passes(i, { ...NO_FILTERS, type: "voice" }))), "s1")
assert.equal(ids(sounds.filter((i) => passes(i, { ...NO_FILTERS, type: "music" }))), "s2")
assert.equal(ids(sounds.filter((i) => passes(i, { ...NO_FILTERS, type: "sound" }))), "s3")
assert.equal(ids(sounds.filter((i) => passes(i, { ...NO_FILTERS, type: "import" }))), "s4")
assert.equal(ids(sounds.filter((i) => passes(i, { ...NO_FILTERS, format: "mp3" }))), "s1s3s4")
assert.equal(activeFilters({ ...NO_FILTERS, kind: "audio", format: "wav" }), 2)
// sorts: within what is shown; a file without the length or size sorted on goes last
assert.equal(ids(sorted(list, "newest")), "dcba")
assert.equal(ids(sorted(list, "oldest")), "abcd")
assert.equal(ids(sorted(list, "longest")), "bdac")
assert.equal(ids(sorted(list, "shortest")), "adbc")
assert.equal(ids(sorted(list, "sharpest")), "dcba")
assert.equal(ids(sorted(list, "softest")), "bcda")
assert.equal(ids(sorted(list, "name")), "abcd")
// a Windows path, as the engine sends it there, finds its file's facts the same
assert.deepEqual(factsOf({ path: "C:\\proj\\media\\d\\a.mp4", job: list[0].job }), { w: 1920, h: 1080, dur: 4 })
console.log("filters: ok")
