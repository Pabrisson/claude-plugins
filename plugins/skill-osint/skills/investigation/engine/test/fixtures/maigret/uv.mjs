// A fake uv for the tests (a .mjs: uvCommand runs it with Node, on Windows too): it records its arguments and the names of its environment variables in the output folder,
// prints a found line as Maigret does, and writes the recorded report under the name Maigret gives it. The username
// maigret.fails exits 2 without a report.
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2), out = args[args.indexOf('--folderoutput') + 1], name = args[args.indexOf('--') + 1]
fs.writeFileSync(path.join(out, 'fake-uv.json'), JSON.stringify({ args, env: Object.keys(process.env) }))
if (name === 'maigret.fails') { console.error('maigret: something broke'); process.exit(2) }
console.log(`[+] GitHub: https://github.com/${name}`)
const report = fs.readFileSync(path.join(import.meta.dirname, 'report_simple.json'), 'utf8').replaceAll('durand.bakery', name)
fs.writeFileSync(path.join(out, `report_${name}_simple.json`), report)
