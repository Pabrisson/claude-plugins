// A fake uv for the tests: it records its arguments, its working folder and the names of its environment variables
// in that folder (fake-uv.json), then prints holehe/<address>.txt as holehe prints its list. Without a fixture for
// the address it fails before printing anything, as holehe does offline (its check_update() calls PyPI first).
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
fs.writeFileSync('fake-uv.json', JSON.stringify({ args, cwd: process.cwd(), env: Object.keys(process.env) }))
const f = path.join(import.meta.dirname, `${args.at(-1)}.txt`)
if (!fs.existsSync(f)) { process.stderr.write('httpx.ConnectError: [Errno 8] nodename nor servname provided, or not known\n'); process.exit(1) }
process.stdout.write(fs.readFileSync(f, 'utf8'))
