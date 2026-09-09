// Minimal static file server for hosting panels that only offer a "Node.js app" slot
// (e.g. cPanel/DirectAdmin's Passenger-based Node.js Selector) rather than plain static
// file hosting. Named .cjs (not .js) so Node treats it as CommonJS regardless of this
// package's "type": "module" in package.json — most Passenger setups expect a CommonJS
// entrypoint.
//
// This app has no server-side logic of its own: everything the browser needs lives in
// the pre-built dist/ folder (run `npm run build` first) and talks to Supabase directly.
// This script's only job is serving those static files, plus falling back to index.html
// for unmatched paths so React Router can handle client-side routes like /auth or
// /app/businesses/... — the same problem public/.htaccess solves for plain Apache hosting.

const http = require('http')
const fs = require('fs')
const path = require('path')

const DIST_DIR = path.join(__dirname, 'dist')
const PORT = process.env.PORT || 3000

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.txt': 'text/plain; charset=utf-8',
}

if (!fs.existsSync(DIST_DIR)) {
  console.error(`dist/ not found at ${DIST_DIR} — run "npm run build" first.`)
  process.exit(1)
}

const server = http.createServer((req, res) => {
  const requestedPath = decodeURIComponent(req.url.split('?')[0])
  const resolved = path.normalize(path.join(DIST_DIR, requestedPath))

  // Refuse to serve anything outside dist/ — normalize() collapses ../ segments, so this
  // catches a path-traversal attempt in the request URL before touching the filesystem.
  if (!resolved.startsWith(DIST_DIR)) {
    res.writeHead(400)
    res.end('Bad request')
    return
  }

  fs.stat(resolved, (statError, stats) => {
    const isRealFile = !statError && stats.isFile()
    const filePath = isRealFile ? resolved : path.join(DIST_DIR, 'index.html')

    fs.readFile(filePath, (readError, contents) => {
      if (readError) {
        res.writeHead(500)
        res.end('Internal server error')
        return
      }
      const contentType = CONTENT_TYPES[path.extname(filePath)] ?? 'application/octet-stream'
      res.writeHead(200, { 'Content-Type': contentType })
      res.end(contents)
    })
  })
})

server.listen(PORT, () => {
  console.log(`Kita Invoice serving dist/ on port ${PORT}`)
})
