// node src/lib/timeline.check.ts: the main track keeps its shots end to end, the others never cover a clip
import assert from "node:assert/strict"
import type { Timeline } from "./api.ts"
import { cuts, duplicate, endOf, lay, move, numbers, place, remove, split, STILL } from "./timeline.ts"

const empty: Timeline = { ratio: null, tracks: [{ id: "v2", kind: "video" }, { id: "v1", kind: "video" }, { id: "a1", kind: "audio" }], clips: [], placed: [], rev: 0 }
const on = (t: Timeline, track: string) => t.clips.filter((c) => c.track === track).sort((a, b) => a.at - b.at).map((c) => [c.job, c.at, endOf(c)])

// laid: shots after the last one on the main track, a still for 3 s, a sound on the top audio track
let t = lay(lay(lay(empty, { path: "/a.mp4", job: "a" }, 4), { path: "/b.png", job: "b" }), { path: "/v.mp3", job: "v" }, 10)
t = lay(t, { path: "/c.mp4", job: "c" }, 2)
assert.deepEqual(on(t, "v1"), [["a", 0, 4], ["b", 4, 4 + STILL], ["c", 7, 9]])
assert.deepEqual(on(t, "a1"), [["v", 0, 10]])
const [a, b, c] = t.clips.filter((x) => x.track === "v1")
assert.deepEqual(Object.values(numbers(t)), [1, 2, 3])
// a shot dragged before the first: the others move along, no gap
assert.deepEqual(on(move(t, c.id, "v1", 0), "v1"), [["c", 0, 2], ["a", 2, 6], ["b", 6, 9]])
// removed: the gap closes; dropped mid-shot on the main track: into the nearest cut
assert.deepEqual(on(remove(t, a.id), "v1"), [["b", 0, 3], ["c", 3, 5]])
assert.deepEqual(on(lay(t, { path: "/d.png", job: "d" }, undefined, "v1", 3.2), "v1"), [["a", 0, 4], ["d", 4, 7], ["b", 7, 10], ["c", 10, 12]])
// on an overlay track a clip stays where it is put and pushes the ones it would cover
let o = lay(lay(t, { path: "/x.png", job: "x" }, undefined, "v2", 5), { path: "/y.png", job: "y" }, undefined, "v2", 6)
assert.deepEqual(on(o, "v2"), [["x", 5, 8], ["y", 8, 11]])
o = move(o, o.clips.find((x) => x.job === "y")!.id, "v2", 4)
assert.deepEqual(on(o, "v2"), [["y", 4, 7], ["x", 7, 10]])
// a Bridge shot in the cut between a and b: the shots after it move right
const bridged = place(t, { path: "/z.mp4", job: "z" }, { workspace: "w", track: "v1", at: 4 }, 2)
assert.deepEqual(on(bridged, "v1"), [["a", 0, 4], ["z", 4, 6], ["b", 6, 9], ["c", 9, 11]])
assert.deepEqual(cuts(t).map(({ a, b }) => [a.job, b.job]), [["a", "b"], ["b", "c"]])
// a take keeps its place, its length shorter if the file is; the shots after follow
const take = place(t, { path: "/y.mp4", job: "y" }, { workspace: "w", track: "v1", at: 0, replace: a.id }, 2.5)
assert.deepEqual(on(take, "v1"), [["y", 0, 2.5], ["b", 2.5, 5.5], ["c", 5.5, 7.5]])
// split and duplicate: two clips that play on, a copy right after
const cut = split(t, a.id, 1.5)
assert.deepEqual(cut.clips.filter((x) => x.job === "a").map((x) => [x.at, x.in, x.out]), [[0, 0, 1.5], [1.5, 1.5, 4]])
assert.deepEqual(on(duplicate(t, b.id), "v1"), [["a", 0, 4], ["b", 4, 7], ["b", 7, 10], ["c", 10, 12]])
console.log("timeline: ok")
