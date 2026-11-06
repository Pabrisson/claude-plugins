// File types by extension, links and the <input accept> rule, shared by the engine and the dashboard (pure: no Node
// module, so that the dashboard can import it)
export const MIME = { '.html': 'text/html', '.htm': 'text/html', '.json': 'application/json', '.jsonl': 'application/x-ndjson', '.txt': 'text/plain', '.pdf': 'application/pdf',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.heic': 'image/heic', '.heif': 'image/heif', '.avif': 'image/avif', '.tif': 'image/tiff', '.tiff': 'image/tiff', '.bmp': 'image/bmp',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo', '.3gp': 'video/3gpp' }
const extOf = file => (/\.[^./\\]+$/.exec(String(file ?? ''))?.[0] ?? '').toLowerCase()
export const mimeOf = file => MIME[extOf(file)] ?? 'application/octet-stream'
export const isUrl = s => /^https?:\/\/\S+$/i.test(String(s ?? ''))
// a file name against an <input accept> list ("image/*", "video/mp4", ".jpg", comma-separated), as a browser reads it
export function accepts(accept, file) {
  const ext = extOf(file), mime = mimeOf(file)
  return String(accept).split(',').map(a => a.trim().toLowerCase()).filter(Boolean)
    .some(a => (a.startsWith('.') ? a === ext : a.endsWith('/*') ? mime.startsWith(a.slice(0, -1)) : a === mime))
}
