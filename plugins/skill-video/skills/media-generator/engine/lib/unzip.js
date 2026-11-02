// The files of a ZIP in memory (ElevenLabs' stems, a video's music and effects apart): its central directory read,
// each file stored or deflated. No ZIP64 nor encryption: ElevenLabs sends neither
import zlib from 'node:zlib'

export function unzip(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (end < 0) throw new Error('not a ZIP file')
  const files = []
  for (let n = buf.readUInt16LE(end + 10), at = buf.readUInt32LE(end + 16); n > 0; n--) {
    const method = buf.readUInt16LE(at + 10), size = buf.readUInt32LE(at + 20), nameLen = buf.readUInt16LE(at + 28)
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString('utf8'), local = buf.readUInt32LE(at + 42)
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28), data = buf.subarray(start, start + size)
    if (!name.endsWith('/')) files.push({ name, data: method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data) })
    at += 46 + nameLen + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32)
  }
  return files
}
