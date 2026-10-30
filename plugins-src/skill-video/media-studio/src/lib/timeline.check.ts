// node src/lib/timeline.check.ts: the main track keeps its shots end to end, the others never cover a clip
import assert from "node:assert/strict"
import type { Kind, Timeline, Tool } from "./api.ts"
import { cuts, duplicate, endOf, fits, FREEZE, freeze, lay, marginsTo, move, numbers, offers, place, remove, split, STILL, voiceUnder } from "./timeline.ts"

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
// an edit takes the result's length; a still result keeps the clip's
const w = { workspace: "w", track: "v1", at: 0 }
assert.deepEqual(on(place(t, { path: "/e.mp4", job: "e" }, { ...w, replace: a.id, how: "whole" }, 6), "v1"), [["e", 0, 6], ["b", 6, 9], ["c", 9, 11]])
assert.deepEqual(on(place(t, { path: "/e.png", job: "e" }, { ...w, replace: b.id, how: "whole" }), "v1"), [["a", 0, 4], ["e", 4, 7], ["c", 7, 9]])
// from the frame at 1.5 s of a: a keeps its start, the new shot follows it, then the rest of the edit
const from = place(t, { path: "/f.mp4", job: "f" }, { ...w, at: 1.5, replace: a.id, how: "from", from: 1.5 }, 5)
assert.deepEqual(on(from, "v1"), [["a", 0, 1.5], ["f", 1.5, 6.5], ["b", 6.5, 9.5], ["c", 9.5, 11.5]])
// a stretch of a (1 to 3 s of its file) replaced by a talking avatar of 2 s, its sound off: the tail of a stays
const said = place(t, { path: "/g.mp4", job: "g" }, { ...w, at: 1, replace: a.id, how: "from", from: 1, to: 3, mute: true }, 2)
assert.deepEqual(on(said, "v1"), [["a", 0, 1], ["g", 1, 3], ["a", 3, 4], ["b", 4, 7], ["c", 7, 9]])
assert.deepEqual([said.clips.find((x) => x.job === "g")!.volume, said.clips.filter((x) => x.job === "a").map((x) => [x.in, x.out])], [0, [[0, 1], [3, 4]]])
// a new shot after a clip, or before it, of its own; on an overlay track it pushes the clip it would cover
assert.deepEqual(on(place(t, { path: "/h.mp4", job: "h" }, { ...w, replace: b.id, how: "after" }, 2), "v1"), [["a", 0, 4], ["b", 4, 7], ["h", 7, 9], ["c", 9, 11]])
assert.deepEqual(on(place(t, { path: "/h.mp4", job: "h" }, { ...w, replace: a.id, how: "before" }, 2), "v1"), [["h", 0, 2], ["a", 2, 6], ["b", 6, 9], ["c", 9, 11]])
const x = o.clips.find((c) => c.job === "x")!
assert.deepEqual(on(place(o, { path: "/h.mp4", job: "h" }, { ...w, track: "v2", replace: x.id, how: "before" }, 2), "v2"), [["y", 4, 7], ["h", 7, 9], ["x", 9, 12]])
// a voice at the playhead on a track that is not there yet: a new audio track, the others untouched
const voiced = place(t, { path: "/n.mp3", job: "n" }, { workspace: "w", track: "anew", at: 2 }, 3)
assert.deepEqual([voiced.tracks.filter((x) => x.kind === "audio").length, on(voiced, "a1")], [2, [["v", 0, 10]]])
assert.deepEqual(voiced.clips.filter((c) => c.job === "n").map((c) => [c.at, endOf(c)]), [[2, 5]])
// a freeze frame at 1 s of a: a cut there, the still for FREEZE seconds, the rest of a after it
assert.deepEqual(on(freeze(t, a.id, 1, { path: "/fr.png", job: "fr" }), "v1"), [["a", 0, 1], ["fr", 1, 1 + FREEZE], ["a", 3, 6], ["b", 6, 9], ["c", 9, 11]])
// the voice under a shot: the one at the playhead, else the longest together
assert.deepEqual(voiceUnder(t, b, 0) && [voiceUnder(t, b, 0)!.voice.job, voiceUnder(t, b, 0)!.from, voiceUnder(t, b, 0)!.to], ["v", 4, 7])
assert.equal(voiceUnder({ ...t, tracks: t.tracks.map((x) => (x.kind === "audio" ? { ...x, off: true } : x)) }, b, 0), undefined)
// the edit's format: a 16:9 picture fits 16:9; brought to 9:16 it gets top and bottom margins (at most its height each)
assert.deepEqual([fits(1920, 1080, "16:9"), fits(1080, 1080, "16:9")], [true, false])
assert.deepEqual([marginsTo(1920, 1080, "16:9"), marginsTo(1000, 1000, "16:9"), marginsTo(1000, 1000, "9:16")], [{}, { left: "0.389", right: "0.389" }, { top: "0.389", bottom: "0.389" }])
assert.deepEqual(marginsTo(1920, 1080, "9:16"), { top: "1", bottom: "1" })
// Generate: a shot's edits and its sound's, the tools that start from a frame; a still's edits; a sound's
const tool = (id: string, mode: Tool["mode"], ...inputs: [string, string][]) => ({ id, mode, inputs: inputs.map(([key, kind]) => ({ key, kind })) }) as Tool
const tools: Record<Kind, Tool[]> = {
  image: [tool("free", "create"), tool("restyle", "edit", ["image", "image"]), tool("remove-background", "edit", ["image", "image"])],
  video: [tool("animate", "create", ["first_frame", "image"]), tool("upscale", "edit", ["video", "video"]), tool("extend", "edit", ["video", "video"]), tool("depth-map", "edit", ["video", "video"])],
  audio: [tool("voice", "create"), tool("change-voice", "edit", ["clip", "media"])],
}
const ids = (list: ReturnType<typeof offers>) => list.map((o) => [o.title, o.items.map((i) => i.tool.id)])
assert.deepEqual(ids(offers(tools, a, "video")), [["edit", ["upscale", "change-voice"]], ["frame", ["animate"]]])
assert.deepEqual(ids(offers(tools, b, "video")), [["edit", ["restyle"]], ["frame", ["animate"]]])
assert.deepEqual(ids(offers(tools, t.clips.find((c) => c.job === "v")!, "audio")), [["edit", ["change-voice"]]])
console.log("timeline: ok")
