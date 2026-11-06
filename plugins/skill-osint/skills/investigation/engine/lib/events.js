// lib/events.js — the case's live feed: one JSON line per event in .osint/events.jsonl, written in one append (several
// engine processes may write at once). The dashboard server reads it from a byte offset, the SSE event id.
import fs from 'node:fs'
import path from 'node:path'
import { nowIso } from './util.js'

export const eventsFile = dir => path.join(dir, '.osint', 'events.jsonl')
export function emit(dir, e) {
  const ev = { t: nowIso(), by: process.env.OSINT_BY || 'engine', ...e }
  fs.mkdirSync(path.join(dir, '.osint'), { recursive: true })
  fs.appendFileSync(eventsFile(dir), JSON.stringify(ev) + '\n')
  return ev
}
// the whole lines after offset; a file smaller than offset was reset: read from its start; a last line not ended waits
export function readFrom(dir, offset = 0) {
  let size
  try { size = fs.statSync(eventsFile(dir)).size } catch { return { events: [], end: 0, reset: offset > 0 } }
  const reset = offset > size
  if (reset) offset = 0
  if (size === offset) return { events: [], end: offset, reset }
  const fd = fs.openSync(eventsFile(dir), 'r'), buf = Buffer.alloc(size - offset)
  try { fs.readSync(fd, buf, 0, buf.length, offset) } finally { fs.closeSync(fd) }
  const events = []
  let start = 0
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] !== 10) continue
    try { events.push({ offset: offset + i + 1, ev: JSON.parse(buf.subarray(start, i).toString('utf8')) }) } catch {}
    start = i + 1
  }
  return { events, end: offset + start, reset }
}
export function lastEvents(dir, n = 20) {
  let size
  try { size = fs.statSync(eventsFile(dir)).size } catch { return [] }
  return readFrom(dir, Math.max(0, size - 64 * 1024)).events.slice(-n).map(x => x.ev)
}
