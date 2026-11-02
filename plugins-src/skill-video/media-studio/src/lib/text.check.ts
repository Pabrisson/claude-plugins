// node src/lib/text.check.ts: what a Text asset is, its tile's preview, a JSON file's colored parts
import assert from "node:assert/strict"
import { textJob, type Job } from "./api.ts"
import { jsonParts, textPreview } from "./text.ts"

const job = (...outputs: string[]) => ({ outputs }) as unknown as Job
// a transcript, timed lyrics, notes are Text; a song with its lyrics stays a sound
assert.deepEqual([job("transcript.txt", "captions.srt").outputs, job("lyrics.srt").outputs, job("notes.json").outputs].map((o) => textJob(job(...o))), [true, true, true])
assert.equal(textJob(job("out-1.mp3", "lyrics.txt")), false)
assert.equal(textJob(job()), false)
// captions lose their numbers and times, a JSON goes on one line, nothing past 400 characters
assert.equal(textPreview("a.srt", "1\n00:00:00,000 --> 00:00:01,000\nHello there\n\n2\n00:00:01,000 --> 00:00:02,000\nGeneral\n"), "Hello there General")
assert.equal(textPreview("a.vtt", "WEBVTT\n\n00:00.000 --> 00:01.000\nBonjour\n"), "Bonjour")
assert.equal(textPreview("n.json", '{\n  "a": 1\n}'), '{ "a": 1 }')
assert.equal(textPreview("t.txt", "x".repeat(900)).length, 400)
// keys and strings told apart, numbers, booleans and null, a quote and digits inside a string kept in it
const parts = jsonParts('{"name":"say \\"7\\"","at":-1.5e2,"ok":true,"none":null,"list":[3]}').filter((p) => p.kind)
assert.deepEqual(parts.map((p) => `${p.kind}:${p.text}`), ['key:"name"', 'string:"say \\"7\\""', "key:\"at\"", "number:-150", 'key:"ok"', "boolean:true", 'key:"none"', "null:null", 'key:"list"', "number:3"])
// laid out over lines, and text that is not JSON shown as it is
assert.ok(jsonParts('{"a":1}').map((p) => p.text).join("").includes('\n  "a": 1\n'))
assert.equal(jsonParts("not json").map((p) => p.text).join(""), "not json")
console.log("text: ok")
