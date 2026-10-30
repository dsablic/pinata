import { createReadStream, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css',
  '.png': 'image/png', '.svg': 'image/svg+xml'
}

/** Serves a folder on localhost for manual viewing and browser tests; prints the URL. */
export function serve (folder: string, port: number): ReturnType<typeof createServer> {
  const root = resolve(folder)
  const server = createServer((request, response) => {
    const path = normalize(decodeURIComponent((request.url ?? '/').split('?')[0]))
    let file = join(root, path)
    if (!file.startsWith(root)) {
      response.writeHead(403).end()
      return
    }
    try {
      if (statSync(file).isDirectory()) file = join(file, 'index.html')
      statSync(file)
    } catch {
      response.writeHead(404).end('not found')
      return
    }
    response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    createReadStream(file).pipe(response)
  })
  server.listen(port, '127.0.0.1')
  return server
}

if (import.meta.main) {
  const folder = process.argv[2] ?? '_site'
  const port = Number(process.argv[3] ?? 8080)
  serve(folder, port).on('listening', () => { console.log(`serving ${folder} at http://127.0.0.1:${port}/`) })
}
