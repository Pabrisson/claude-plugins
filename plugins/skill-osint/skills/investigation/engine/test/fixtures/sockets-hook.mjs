// Loaded by NODE_OPTIONS=--import=<this file's URL> in the engine and every Node it starts: writes each TCP connection
// opened to OSINT_SOCKET_LOG as host:port, the proof that a case reaches nothing but what it should
import fs from 'node:fs'
import net from 'node:net'
const log = process.env.OSINT_SOCKET_LOG, connect = net.Socket.prototype.connect
net.Socket.prototype.connect = function (...args) {
  const o = Array.isArray(args[0]) ? args[0][0] : typeof args[0] === 'object' ? args[0] : { port: args[0], host: args[1] }
  if (log && o?.port != null) fs.appendFileSync(log, `${o.host ?? 'localhost'}:${o.port}\n`)
  return connect.apply(this, args)
}
