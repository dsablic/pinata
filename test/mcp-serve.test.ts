import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { respondTo, serve } from '../src/tool/mcp.ts'

type Gate = { release: () => void, held: Promise<void> }

function gate (): Gate {
  let release: () => void = () => {}
  const held = new Promise<void>(resolve => { release = resolve })
  return { release, held }
}

const request = (id: number): string => JSON.stringify({ jsonrpc: '2.0', id, method: 'ping' })

test('two concurrent requests are answered under their own ids and the server ends after the last', async () => {
  const slow = gate()
  const written: number[] = []
  const input = new PassThrough()
  const respond = async (line: string): ReturnType<typeof respondTo> => {
    if (JSON.parse(line).id === 1) await slow.held
    return respondTo(line)
  }
  let ended = false
  const done = serve(input, text => written.push(JSON.parse(text).id), () => {}, respond).then(() => { ended = true })
  input.write(`${request(1)}\n${request(2)}\n`)
  input.end()
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.deepEqual(written, [2])
  assert.equal(ended, false)
  slow.release()
  await done
  assert.deepEqual(written, [2, 1])
})

test('a rejected handler and a failing write neither hang the server nor reject it', async () => {
  const input = new PassThrough()
  const logged: string[] = []
  const respond = async (line: string): ReturnType<typeof respondTo> => {
    if (JSON.parse(line).id === 1) throw new Error('boom')
    return respondTo(line)
  }
  const write = (): void => { throw new Error('EPIPE') }
  const done = serve(input, write, line => logged.push(line), respond)
  input.write(`${request(1)}\n${request(2)}\n`)
  input.end()
  await done
  assert.ok(logged.some(line => line.includes('boom')))
  assert.ok(logged.some(line => line.includes('EPIPE')))
})
