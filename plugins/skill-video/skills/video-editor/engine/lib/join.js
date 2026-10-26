// The render's raw stream, joined from its chunks.
import fs from 'node:fs'

// the head (IVF's file header, or nothing), then every chunk, one at a time: a long 4K stream outgrows the 2 GiB a
// single write takes
export function joinChunks(dest, files, head = Buffer.alloc(0)) {
  fs.writeFileSync(dest, head)
  for (const x of files) fs.appendFileSync(dest, fs.readFileSync(x))
}
