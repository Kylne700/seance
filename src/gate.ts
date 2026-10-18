// Browser gate: does the page (a) load the wasm through the bundler, (b) fetch the indexer itself (CORS), (c) decrypt in the page?
// scripts/gate.mjs injects window.__GATE__ = { tx, viewSecret } and reads window.__GATE_RESULT__. The secret is never shown or stored.
import * as wasm from '@tari-project/ootle-wasm'
import { IndexerClient } from '@tari-project/indexer-client'
import { INDEXER_URL } from './config.ts'
import { parseTransaction } from './chain.ts'
import { decryptOutput } from './decrypt.ts'

declare global {
  interface Window {
    __GATE__?: { tx: string; viewSecret: string }
    __GATE_RESULT__?: unknown
  }
}

const result: Record<string, unknown> = { origin: location.origin, path: location.pathname }
try {
  result.wasm = { loaded: true, exports: Object.keys(wasm).length, hasDecryptElgamal: typeof wasm.decryptElgamalViewableBalance === 'function' }
  const gate = window.__GATE__
  if (!gate) throw new Error('no gate input injected')

  const t0 = performance.now()
  const reply = await IndexerClient.usingFetchTransport(INDEXER_URL).getTransaction(gate.tx)
  const tx = parseTransaction(reply)
  result.indexer = { fetched: true, ms: Math.round(performance.now() - t0), id: tx.id, outcome: tx.outcome, feePaid: tx.feePaid, outputs: tx.outputs.length }

  const t1 = performance.now()
  result.decrypt = []
  for (const o of tx.outputs) {
    const plain = await decryptOutput(gate.viewSecret, o)
    ;(result.decrypt as unknown[]).push({ output: `${o.statement}.${o.index}`, ciphertextBytes: o.ciphertextBytes, plain: plain ? { value: plain.value.toString(), memo: plain.memo } : null })
  }
  result.decryptMs = Math.round(performance.now() - t1)
} catch (e) {
  result.error = String((e as Error)?.message ?? e)
}
window.__GATE_RESULT__ = result
document.getElementById('out')!.textContent = JSON.stringify(result, null, 2)
