import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkContents, MOST_UNPACKED_BYTES, tarContents, unpack, walk, zipContents } from '../src/benchmark/archive.ts'
import {
  HttpError, isItchHost, licenceMatches, licenceOf, readCapped, REFERENCES, Session, uploadsOf, withRetry
} from '../src/benchmark/itch.ts'
import { insideRepository, parseFetchArgs, safeName } from '../src/benchmark/safety.ts'

function inTemp (run: (dir: string) => void | Promise<void>): Promise<void> | void {
  const dir = mkdtempSync(join(tmpdir(), 'pinata-fetch-'))
  const done = (): void => rmSync(dir, { recursive: true, force: true })
  try {
    const result = run(dir)
    if (result instanceof Promise) return result.finally(done)
    done()
  } catch (err) {
    done()
    throw err
  }
}

test('a downloaded file name stays a direct child of the target folder', () => {
  assert.equal(safeName('Fantasy Warrior.zip', '/data/in'), '/data/in/Fantasy Warrior.zip')
  assert.equal(safeName('../../etc/passwd', '/data/in'), '/data/in/.._.._etc_passwd')
  for (const bad of ['..', '.', '', '  ', '...']) assert.throws(() => safeName(bad, '/data/in'), /not a safe file name/)
})

test('the references folder is refused inside the repository, also through a symlink', () => {
  inTemp(dir => {
    const repository = join(dir, 'repo')
    mkdirSync(repository)
    symlinkSync(repository, join(dir, 'link'))
    mkdirSync(join(dir, 'elsewhere'))
    assert.equal(insideRepository(join(repository, 'new', 'deep'), repository), true)
    assert.equal(insideRepository(repository, repository), true)
    assert.equal(insideRepository(join(dir, 'link', 'refs'), repository), true)
    assert.equal(insideRepository(join(dir, 'elsewhere', 'refs'), repository), false)
    assert.equal(insideRepository(join(dir, 'repo-sibling'), repository), false)
  })
})

test('the fetch options accept one folder and --lpc, and refuse anything else', () => {
  assert.deepEqual(parseFetchArgs(['refs']), { root: 'refs' })
  assert.deepEqual(parseFetchArgs(['refs', '--lpc', 'layers']), { root: 'refs', lpc: 'layers' })
  assert.match(String(parseFetchArgs(['refs', '--lcp', 'layers'])), /unknown option --lcp/)
  assert.match(String(parseFetchArgs(['refs', '--lpc'])), /needs a folder/)
  assert.match(String(parseFetchArgs(['refs', '--lpc', '--other'])), /needs a folder/)
  assert.match(String(parseFetchArgs(['refs', '--lpc', 'a', '--lpc', 'b'])), /twice/)
  assert.match(String(parseFetchArgs([])), /exactly one folder/)
  assert.match(String(parseFetchArgs(['a', 'b'])), /exactly one folder/)
})

test('archive listings are read for their size, and refused above the cap or outside the folder', () => {
  const zip = 'Archive:  x.zip\n  Length      Date    Time    Name\n---------  ---------- -----   ----\n' +
    '        3  11-05-2026 21:46   a b.txt\n       40  11-05-2026 21:46   dir/c.png\n' +
    '---------                     -------\n       43                     2 files\n'
  assert.deepEqual(zipContents(zip), { bytes: 43, names: ['a b.txt', 'dir/c.png'] })
  const tar = '-rw-r--r--  0 denis  wheel       3 Nov  5 21:46 a b.txt\n' +
    'lrwxr-xr-x  0 denis  wheel       0 Nov  5 21:46 lnk -> /etc/passwd\n'
  assert.deepEqual(tarContents(tar), { bytes: 3, names: ['a b.txt', 'lnk -> /etc/passwd'] })
  assert.throws(() => tarContents('something else entirely\n'), /cannot be read/)
  assert.throws(() => zipContents('Archive: x.zip\n'), /no total/)
  assert.throws(() => checkContents({ bytes: MOST_UNPACKED_BYTES + 1, names: ['a'] }), /over the limit/)
  assert.throws(() => checkContents({ bytes: 1, names: ['ok', '../out.txt'] }), /outside its folder/)
  assert.throws(() => checkContents({ bytes: 1, names: ['/abs.txt'] }), /outside its folder/)
  assert.doesNotThrow(() => checkContents({ bytes: 1, names: ['dir/..name.txt'] }))
})

test('unpacking lists symbolic links instead of following them', () => {
  inTemp(dir => {
    const source = join(dir, 'source')
    mkdirSync(join(source, 'sub'), { recursive: true })
    writeFileSync(join(source, 'sub', 'a.txt'), 'hello')
    symlinkSync('/etc', join(source, 'etc-link'))
    symlinkSync(join(source, 'sub'), join(source, 'sub-link'))
    const archive = join(dir, 'pack.tar')
    execFileSync('tar', ['-cf', archive, '-C', source, 'sub', 'etc-link', 'sub-link'])
    const found = unpack(archive, join(dir, 'out'))
    assert.deepEqual(found.files, [join(dir, 'out', 'sub', 'a.txt')])
    assert.deepEqual(found.skipped.map(s => [s.path.slice(dir.length + 1), s.reason]), [
      ['out/etc-link', 'symbolic link'], ['out/sub-link', 'symbolic link']
    ])
    assert.deepEqual(walk(join(dir, 'out')).files.length, 1)
  })
})

test('the licence is the License row of the information table, not a mention elsewhere', () => {
  const row = (label: string, value: string): string => `<tr><td>${label}</td><td>${value}</td></tr>`
  const page = (licence: string): string => `<p>CC0 is allowed on opengameart</p><table><tbody>${row('Status', 'x')}` +
    `${licence}</tbody></table>`
  const zero = licenceOf(page(row('Asset license', '<a href="u">Creative Commons Zero v1.0 Universal</a>')))
  assert.equal(zero, 'Creative Commons Zero v1.0 Universal')
  assert.equal(licenceMatches(REFERENCES[0], zero), true)
  const closed = licenceOf(page(row('License', 'All rights reserved')))
  assert.equal(closed, 'All rights reserved')
  assert.equal(licenceMatches(REFERENCES[0], closed), false)
  assert.equal(licenceOf(page('')), undefined)
  assert.equal(licenceMatches(REFERENCES[0], undefined), false)
})

test('uploads pair each id with the name in its own element', () => {
  const upload = (id: string | undefined, name: string | undefined): string => '<div class="upload">' +
    `<a class="button" ${id === undefined ? '' : `data-upload_id="${id}"`}>Download</a>` +
    `<div class="upload_name">${name === undefined ? '' : `<strong class="name">${name}</strong>`}</div></div>`
  assert.deepEqual(uploadsOf(`<div class="uploads">${upload('7', 'a.zip')}${upload('9', 'b.zip')}</div>`), [
    { id: '7', name: 'a.zip' }, { id: '9', name: 'b.zip' }
  ])
  assert.throws(() => uploadsOf(upload('7', undefined) + upload('9', 'b.zip')), /no id or name/)
  assert.throws(() => uploadsOf(upload(undefined, 'a.zip') + upload('9', 'b.zip')), /no id or name/)
})

test('a body over the size cap is refused from its declared length and while it streams', async () => {
  const declared = new Response('x', { headers: { 'content-length': '100' } })
  await assert.rejects(readCapped(declared, 10), /over the 10 byte limit/)
  const stream = new ReadableStream<Uint8Array>({
    start (controller) {
      for (let i = 0; i < 5; i++) controller.enqueue(new Uint8Array(4))
      controller.close()
    }
  })
  await assert.rejects(readCapped(new Response(stream), 10), /over the 10 byte limit/)
  assert.equal((await readCapped(new Response('abcd'), 10)).toString(), 'abcd')
})

test('itch.io cookies go to itch.io hosts only, also after a redirect', async () => {
  assert.deepEqual(['itch.io', 'luizmelo.itch.io', 'itch.io.evil.com', 'notitch.io'].map(isItchHost),
    [true, true, false, false])
  const seen: { url: string, cookie: string | undefined, signal: boolean }[] = []
  const reply = (url: string): Response => {
    if (url === 'https://luizmelo.itch.io/page') {
      return new Response(null, { status: 302, headers: { location: 'https://storage.example.com/file' } })
    }
    return new Response('ok')
  }
  const fetchMock = mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>
    seen.push({ url, cookie: headers.cookie, signal: init.signal instanceof AbortSignal })
    return reply(url)
  })
  try {
    const session = new Session()
    session.cookies.set('itchio', 'secret')
    await session.send('https://luizmelo.itch.io/page')
    assert.deepEqual(seen.map(s => [s.url, s.cookie, s.signal]), [
      ['https://luizmelo.itch.io/page', 'itchio=secret', true],
      ['https://storage.example.com/file', undefined, true]
    ])
    await assert.rejects(session.send('http://luizmelo.itch.io/page'), /only https/)
  } finally {
    fetchMock.mock.restore()
  }
})

test('only a 429 or a server error is retried', async () => {
  const failing = (status: number, times: number) => {
    let calls = 0
    const task = async (): Promise<string> => {
      calls++
      if (calls <= times) throw new HttpError('u', status)
      return 'done'
    }
    return { task, calls: () => calls }
  }
  const server = failing(503, 2)
  assert.equal(await withRetry(server.task, 0), 'done')
  assert.equal(server.calls(), 3)
  const limited = failing(429, 1)
  assert.equal(await withRetry(limited.task, 0), 'done')
  const missing = failing(404, 1)
  await assert.rejects(withRetry(missing.task, 0), /HTTP 404/)
  assert.equal(missing.calls(), 1)
  const broken = failing(500, 99)
  await assert.rejects(withRetry(broken.task, 0), /HTTP 500/)
  assert.equal(broken.calls(), 5)
})
