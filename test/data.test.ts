// Where answers come from: live indexer, recorded set, and the switch between them. fetch is replaced in every test, so no
// test here touches the network. A fetch that throws if it is called stands in for "the network is blocked".
import { afterEach, describe, expect, it, vi } from 'vitest'
import ledger from '../ledger.json'
import { INDEXER_URL, RECENT_LIMIT } from '../src/config.ts'
import { createData, demos, LookupError, type Problem } from '../src/data.ts'
import { decryptOutput, listen } from '../src/decrypt.ts'
import type { TxView } from '../src/chain.ts'

interface Expected {
  outputs: { output: string; reader: string | null; value?: string; memo?: string | null }[]
}
const keys = ledger.keys as Record<string, { viewSecret: string }>
const txs = ledger.txs as unknown as { key: string; id: string; kind: string; reply: unknown; expected: Expected }[]
const bobTx = txs[0] // Bob, 0.666 tTARI, "The candle went out. Did you do that?"
const unknownId = 'ab'.repeat(32)

afterEach(() => vi.unstubAllGlobals())

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, statusText: status === 200 ? 'OK' : 'Error' })
const stubFetch = (impl: (url: string) => Promise<Response> | Response) => {
  const fn = vi.fn(async (url: string | URL | Request) => impl(String(url)))
  vi.stubGlobal('fetch', fn)
  return fn
}
const blocked = () => stubFetch(() => Promise.reject(new TypeError('fetch failed')))
const never = () => stubFetch(() => new Promise<Response>(() => {}))

/** The view reads as the recording says: the expected reader gets the amount and the memo, and nobody else hears anything. */
async function expectsReading(view: TxView, tx: (typeof txs)[number]): Promise<void> {
  expect(view.id).toBe(tx.id)
  for (const e of tx.expected.outputs) {
    const [s, i] = e.output.split('.').map(Number)
    const output = view.statements[s].outputs[i]
    for (const [name, k] of Object.entries(keys)) {
      const plain = await decryptOutput(k.viewSecret, output)
      if (name === e.reader) {
        expect(plain?.value).toBe(BigInt(e.value!))
        expect(plain?.memo ?? null).toBe(e.memo ?? null)
      } else expect(plain).toBeNull()
    }
  }
}

async function fails(p: Promise<unknown>): Promise<Problem> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  )
  expect(e).toBeInstanceOf(LookupError)
  return (e as LookupError).kind
}

describe('recorded mode (the switch is on, or the network is blocked)', () => {
  it('answers every demo transaction without one request, and each one reads as recorded', async () => {
    const fetchSpy = blocked()
    const data = createData()
    data.setMode('recorded')
    for (const tx of txs) {
      const shown = await data.lookup(tx.id)
      expect(shown).toMatchObject({ mode: 'recorded', fellBack: false, quietChain: false })
      await expectsReading(shown.view, tx)
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('the demo list matches the ledger, in order', () => {
    expect(demos.map((d) => d.id)).toEqual(txs.map((t) => t.id))
  })

  it('knows the recent sample too, but says "not recorded" for any other id, with no request', async () => {
    const fetchSpy = blocked()
    const data = createData()
    data.setMode('recorded')
    const sampleId = ledger.recent.transactions[0].transaction_id
    expect((await data.lookup(sampleId)).view.id).toBe(sampleId)
    expect(await fails(data.lookup(unknownId))).toBe('not-recorded')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('summon works from the recorded sample, with no request', async () => {
    const fetchSpy = blocked()
    const data = createData({ pick: () => 0 })
    data.setMode('recorded')
    const shown = await data.recent()
    expect(shown.mode).toBe('recorded')
    expect(shown.view.outputs.length).toBeGreaterThan(0)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('a pasted id is cleaned up (spaces, capitals) and a malformed one is refused before anything else', async () => {
    const fetchSpy = blocked()
    const data = createData()
    data.setMode('recorded')
    expect((await data.lookup(`  ${bobTx.id.toUpperCase()}\n`)).view.id).toBe(bobTx.id)
    for (const bad of ['', 'abc', 'zz'.repeat(32), bobTx.id + '0', bobTx.id.slice(1)]) expect(await fails(data.lookup(bad))).toBe('bad-id')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('live mode', () => {
  it('asks the indexer, and only the indexer, for the one id', async () => {
    const fetchSpy = stubFetch(() => json(bobTx.reply))
    const shown = await createData().lookup(bobTx.id)
    expect(shown).toMatchObject({ mode: 'live', fellBack: false })
    await expectsReading(shown.view, bobTx)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(String(fetchSpy.mock.calls[0][0])).toBe(`${INDEXER_URL}/transactions/${bobTx.id}`)
  })

  it('summon makes one request for the recent list and picks a transaction that has sealed notes', async () => {
    const fetchSpy = stubFetch(() => json({ transactions: ledger.recent.transactions }))
    const data = createData({ pick: () => 0 })
    const shown = await data.recent()
    expect(shown).toMatchObject({ mode: 'live', fellBack: false, quietChain: false })
    expect(shown.view.outputs.length).toBeGreaterThan(0)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const url = new URL(String(fetchSpy.mock.calls[0][0]))
    expect(url.origin).toBe(INDEXER_URL)
    expect(url.pathname).toBe('/transactions/recent')
    expect(url.searchParams.get('limit')).toBe(String(RECENT_LIMIT))
  })

  it('summon prefers a settled transaction over a rejected one', async () => {
    const rejected = structuredClone(ledger.recent.transactions[0]) as unknown as Record<string, unknown>
    rejected.summary = null
    rejected.rejected_reason = 'Execution failure (InsufficientFunds)'
    stubFetch(() => json({ transactions: [rejected, ledger.recent.transactions[1]] }))
    const shown = await createData({ pick: () => 0 }).recent()
    expect(shown.view.id).toBe(ledger.recent.transactions[1].transaction_id)
    expect(shown.view.outcome).toBe('Commit')
  })

  it('a live chain with no private transfer in it: the recorded sample is used, labelled, and the page stays live', async () => {
    stubFetch(() => json({ transactions: [] }))
    const data = createData({ pick: () => 0 })
    const shown = await data.recent()
    expect(shown).toMatchObject({ mode: 'recorded', fellBack: false, quietChain: true })
    expect(shown.view.outputs.length).toBeGreaterThan(0)
    expect(data.mode).toBe('live')
  })

  it('an id the indexer does not know is "not found", not a fallback', async () => {
    stubFetch(() => json({ error: 'not known to this indexer' }, 404))
    const data = createData()
    expect(await fails(data.lookup(unknownId))).toBe('not-found')
    expect(data.mode).toBe('live')
  })

  it('any other client error is "bad id", not a fallback', async () => {
    stubFetch(() => json({ error: 'bad request' }, 400))
    const data = createData()
    expect(await fails(data.lookup(unknownId))).toBe('bad-id')
    expect(data.mode).toBe('live')
  })

  it('an answer in a shape this page does not know is "format", not a fallback', async () => {
    stubFetch(() => json({ transaction: { nothing: 'useful' } }))
    const data = createData()
    expect(await fails(data.lookup(unknownId))).toBe('format')
    expect(data.mode).toBe('live')
  })
})

describe('automatic fallback to recorded data', () => {
  const cases: [string, () => unknown][] = [
    ['the connection is refused', () => blocked()],
    ['the indexer does not answer in time', () => never()],
    ['the indexer answers 500', () => stubFetch(() => json({ error: 'boom' }, 500))],
    ['the indexer answers 503', () => stubFetch(() => json({ error: 'down' }, 503))],
    ['the indexer throttles us (429)', () => stubFetch(() => json({ error: 'slow down' }, 429))],
    ['a demo id answers 404 (the testnet was reset)', () => stubFetch(() => json({ error: 'not known to this indexer' }, 404))],
  ]
  for (const [name, arrange] of cases) {
    it(`${name}: the page switches to recorded, says so, and the demo still reads right`, async () => {
      arrange()
      const data = createData({ timeoutMs: 40 })
      const shown = await data.lookup(bobTx.id)
      expect(shown).toMatchObject({ mode: 'recorded', fellBack: true })
      expect(data.mode).toBe('recorded')
      await expectsReading(shown.view, bobTx)
      // end to end: the very same words reach the medium
      const heard = await listen(keys.bob.viewSecret, shown.view.outputs)
      expect(heard).toHaveLength(1)
      expect(heard[0].plain).toEqual({ value: 666000n, memo: 'The candle went out. Did you do that?' })
    })
  }

  it('the switch sticks: later calls do not ask the indexer again', async () => {
    const fetchSpy = blocked()
    const data = createData()
    await data.lookup(bobTx.id)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const again = await data.lookup(txs[1].id)
    expect(again).toMatchObject({ mode: 'recorded', fellBack: false })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('summon falls back too when the indexer is down', async () => {
    blocked()
    const data = createData({ pick: () => 0 })
    const shown = await data.recent()
    expect(shown).toMatchObject({ mode: 'recorded', fellBack: true })
    expect(data.mode).toBe('recorded')
  })

  it('an id that is neither a demo nor in the sample and cannot be asked for is "not recorded"', async () => {
    blocked()
    expect(await fails(createData().lookup(unknownId))).toBe('not-recorded')
  })

  it('the way back works: switching to live asks the indexer again', async () => {
    const fetchSpy = stubFetch(() => json(bobTx.reply))
    const data = createData()
    data.setMode('recorded')
    await data.lookup(bobTx.id)
    expect(fetchSpy).not.toHaveBeenCalled()
    data.setMode('live')
    expect((await data.lookup(bobTx.id)).mode).toBe('live')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})
