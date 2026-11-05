import { mkdirSync, writeFileSync } from 'node:fs'
import { isRecord } from '../formats/validate.ts'
import { safeName } from './safety.ts'

export type Reference = { id: string, page: string, author: string, licence: string, licenceNames: string[] }
export type Fetched = { name: string, bytes: number }
export type Download = { files: Fetched[], licenceOnPage: string | undefined }

const AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)'
const MOST_BYTES = 200 * 1024 * 1024
const MOST_PAGE_BYTES = 8 * 1024 * 1024
const MOST_REDIRECTS = 5
const PAGE_MS = 30_000
const DOWNLOAD_MS = 600_000
const TRIES = 5
const PAUSE_MS = 10_000
const CC0 = ['CC0', 'Creative Commons Zero']

export const REFERENCES: Reference[] = [
  { id: 'fantasy-warrior', page: 'https://luizmelo.itch.io/fantasy-warrior', author: 'LuizMelo', licence: 'CC0',
    licenceNames: CC0 },
  { id: 'huntress-2', page: 'https://luizmelo.itch.io/huntress-2', author: 'LuizMelo', licence: 'CC0',
    licenceNames: CC0 },
  { id: 'evil-wizard', page: 'https://luizmelo.itch.io/evil-wizard', author: 'LuizMelo', licence: 'CC0',
    licenceNames: CC0 },
  { id: '8-directional-char', page: 'https://hormelz.itch.io/8-directional-char', author: 'hormelz', licence: 'CC0',
    licenceNames: CC0 }
]

export class HttpError extends Error {
  status: number

  constructor (url: string, status: number) {
    super(`${url}: HTTP ${status}`)
    this.status = status
  }
}

export function isItchHost (host: string): boolean {
  return host === 'itch.io' || host.endsWith('.itch.io')
}

export async function readCapped (response: Response, limit: number): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length'))
  if (declared > limit) {
    await response.body?.cancel()
    throw new Error(`${declared} bytes is over the ${limit} byte limit`)
  }
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of response.body ?? []) {
    total += chunk.length
    if (total > limit) throw new Error(`the body is over the ${limit} byte limit`)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

export class Session {
  cookies = new Map<string, string>()

  private cookieHeader (host: string): Record<string, string> {
    if (!isItchHost(host) || this.cookies.size === 0) return {}
    return { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') }
  }

  private remember (response: Response): void {
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(';')
      const at = pair.indexOf('=')
      this.cookies.set(pair.slice(0, at), pair.slice(at + 1))
    }
  }

  async send (url: string, init: RequestInit = {}, timeoutMs = PAGE_MS): Promise<Response> {
    let [target, request] = [url, init]
    for (let hops = 0; ; hops++) {
      const { host, protocol } = new URL(target)
      if (protocol !== 'https:') throw new Error(`${target}: only https is fetched`)
      const headers = { 'user-agent': AGENT, ...this.cookieHeader(host), ...request.headers as Record<string, string> }
      const response = await fetch(target, {
        ...request, headers, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs)
      })
      if (isItchHost(host)) this.remember(response)
      const location = response.headers.get('location')
      if (response.status < 300 || response.status >= 400 || location === null) return response
      await response.body?.cancel()
      if (hops === MOST_REDIRECTS) throw new Error(`${url}: too many redirects`)
      target = new URL(location, target).href
      if ([301, 302, 303].includes(response.status)) request = {}
    }
  }

  async text (url: string, init?: RequestInit): Promise<string> {
    const response = await this.send(url, init)
    if (!response.ok) throw new HttpError(url, response.status)
    return (await readCapped(response, MOST_PAGE_BYTES)).toString('utf8')
  }
}

function csrfOf (html: string): string {
  const found = /name="csrf_token" value="([^"]+)"/.exec(html)
  if (found === null) throw new Error('no csrf token on the page')
  return found[1]
}

function post (token: string, page: string): RequestInit {
  const body = new URLSearchParams({ csrf_token: token })
  return { method: 'POST', body, headers: { referer: page, origin: new URL(page).origin } }
}

async function urlFrom (session: Session, url: string, token: string, page: string): Promise<string> {
  const parsed: unknown = JSON.parse(await session.text(url, post(token, page)))
  if (!isRecord(parsed) || typeof parsed.url !== 'string') throw new Error(`${url}: no url in the reply`)
  return parsed.url
}

export function uploadsOf (html: string): { id: string, name: string }[] {
  const blocks = html.split('<div class="upload">').slice(1)
  return blocks.map(block => {
    const id = /data-upload_id="(\d+)"/.exec(block)?.[1]
    const name = /class="name">([^<]+)</.exec(block)?.[1]
    if (id === undefined || name === undefined) throw new Error('an upload on the download page has no id or name')
    return { id, name }
  })
}

function textOf (html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
}

export function licenceOf (html: string): string | undefined {
  const rows = [...html.matchAll(/<tr><td>([^<]*)<\/td><td>([\s\S]*?)<\/td><\/tr>/g)]
  const row = rows.find(found => /^(asset )?licen[cs]e$/i.test(textOf(found[1])))
  return row === undefined ? undefined : textOf(row[2])
}

export function licenceMatches (reference: Reference, onPage: string | undefined): boolean {
  const seen = (onPage ?? '').toLowerCase()
  return reference.licenceNames.some(name => seen.includes(name.toLowerCase()))
}

export async function fetchItch (reference: Reference, into: string): Promise<Download> {
  const session = new Session()
  const page = await session.text(reference.page)
  const licenceOnPage = licenceOf(page)
  const downloads = await urlFrom(session, `${reference.page}/download_url`, csrfOf(page), reference.page)
  const listing = await session.text(downloads)
  const token = csrfOf(listing)
  const files: Fetched[] = []
  mkdirSync(into, { recursive: true })
  const uploads = uploadsOf(listing)
  if (uploads.length === 0) throw new Error('the download page lists no files')
  for (const upload of uploads) {
    const api = `${reference.page}/file/${upload.id}?source=game&as_props=1&after_download_lightbox=true`
    const source = await urlFrom(session, api, token, downloads)
    const target = safeName(upload.name, into)
    const response = await session.send(source, {}, DOWNLOAD_MS)
    if (!response.ok) throw new HttpError(upload.name, response.status)
    const bytes = await readCapped(response, MOST_BYTES)
    writeFileSync(target, bytes)
    files.push({ name: upload.name, bytes: bytes.length })
  }
  return { files, licenceOnPage }
}

export function retryable (err: unknown): boolean {
  return err instanceof HttpError && (err.status === 429 || err.status >= 500)
}

export async function withRetry<T> (task: () => Promise<T>, pauseMs = PAUSE_MS): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await task()
    } catch (err) {
      if (attempt === TRIES || !retryable(err)) throw err
      await new Promise(resolve => setTimeout(resolve, pauseMs * attempt))
    }
  }
}

export function fetchWithRetry (reference: Reference, into: string): Promise<Download> {
  return withRetry(() => fetchItch(reference, into))
}
