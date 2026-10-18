// Pure parsing of one indexer transaction (the JSON from GET /transactions/<id>, or one entry of /transactions/recent).
// No wasm and no network, so the page, the tests and the Node scripts all use the same code.

export class ParseError extends Error {}

export interface StealthOutput {
  statement: number // which StealthTransfer instruction of the transaction
  index: number // position inside that statement
  commitment: string // hex, 32 bytes: a Pedersen commitment, hides the amount
  senderNonce: string // hex, 32 bytes: the sender's one-time public key, needed by the recipient to decrypt
  ciphertext: string // hex: amount and memo, encrypted to the recipient's view key
  ciphertextBytes: number // the length leaks whether a memo exists
  minimumValuePromise: number
  hasViewableBalanceProof: boolean // true only when the resource has an auditor view key
  spendCondition: string // "Key" (one public key may spend) or another variant name
}

export interface StealthStatement {
  where: 'fee_instructions' | 'instructions'
  resource: string
  inputCommitments: string[] // the spent outputs: the spend graph stays public
  revealedIn: string // amount taken from the sender's public (revealed) balance
  revealedOut: { amount: string; receiver: string } | null // amount paid in the clear (here: the fee)
  outputs: StealthOutput[]
}

export interface TxView {
  id: string
  outcome: string | null // null while there is no summary: not finalized yet, or rejected before it ran
  rejectedReason: string | null // the indexer's reason, when it gave one
  feePaid: number | null // micro-tTARI (uT)
  createdAt: string | null
  finalizedAt: string | null
  minEpoch: number | null
  maxEpoch: number | null
  nonce: number | null
  instructionKinds: string[]
  statements: StealthStatement[]
  outputs: StealthOutput[] // all stealth outputs, in order
}

const HEX = /^(?:[0-9a-f]{2})*$/
const obj = (v: unknown, what: string): Record<string, unknown> => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new ParseError(`${what} is not an object`)
  return v as Record<string, unknown>
}
const arr = (v: unknown, what: string): unknown[] => {
  if (!Array.isArray(v)) throw new ParseError(`${what} is not a list`)
  return v
}
const hex = (v: unknown, what: string): string => {
  if (typeof v !== 'string' || !HEX.test(v)) throw new ParseError(`${what} is not hex`)
  return v
}
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

export const isTxId = (s: string): boolean => /^[0-9a-f]{64}$/.test(s)

/** Accepts the reply of getTransaction ({ transaction: item }) or a bare item from listRecentTransactions. */
export function parseTransaction(reply: unknown): TxView {
  const top = obj(reply, 'reply')
  const item = obj('transaction_id' in top ? top : top.transaction, 'transaction item')
  const id = str(item.transaction_id)
  if (!id || !isTxId(id)) throw new ParseError('transaction_id missing')
  const v1 = obj(item.transaction, 'transaction').V1
  if (!v1) throw new ParseError('unsupported transaction version (this page reads V1)')
  const body = obj(obj(obj(v1, 'V1').body, 'body').transaction, 'body.transaction')
  const feeInstr = arr(body.fee_instructions ?? [], 'fee_instructions')
  const instr = arr(body.instructions ?? [], 'instructions')
  const summary = item.summary ? obj(item.summary, 'summary') : null
  const kind = (i: unknown) => Object.keys(obj(i, 'instruction'))[0] ?? '?'

  const statements: StealthStatement[] = []
  const walk = (list: unknown[], where: StealthStatement['where']) => {
    for (const i of list) {
      const st = obj(i, 'instruction').StealthTransfer
      if (!st) continue
      const s = obj(st, 'StealthTransfer')
      const stmt = obj(s.statement, 'statement')
      const ins = obj(stmt.inputs_statement, 'inputs_statement')
      const outs = obj(stmt.outputs_statement, 'outputs_statement')
      const ref = obj(s.resource_address_ref, 'resource_address_ref')
      const ro = outs.revealed_output ? obj(outs.revealed_output, 'revealed_output') : null
      const n = statements.length
      statements.push({
        where,
        resource: str(ref.Address) ?? '(workspace reference)',
        inputCommitments: arr(ins.inputs, 'inputs').map((x) => hex(obj(x, 'input').commitment, 'input commitment')),
        revealedIn: String(ins.revealed_amount ?? '0'),
        revealedOut: ro ? { amount: String(ro.amount), receiver: hex(ro.receiver, 'revealed receiver') } : null,
        outputs: arr(outs.outputs, 'outputs').map((x, index) => {
          const w = obj(x, 'output')
          const o = obj(w.output, 'output.output')
          const ciphertext = hex(o.encrypted_data, 'encrypted_data')
          return {
            statement: n,
            index,
            commitment: hex(o.commitment, 'commitment'),
            senderNonce: hex(o.sender_public_nonce, 'sender_public_nonce'),
            ciphertext,
            ciphertextBytes: ciphertext.length / 2,
            minimumValuePromise: num(o.minimum_value_promise) ?? 0,
            hasViewableBalanceProof: o.viewable_balance_proof != null,
            spendCondition: w.auth && typeof w.auth === 'object' ? (Object.keys(w.auth)[0] ?? '?') : '?',
          }
        }),
      })
    }
  }
  walk(feeInstr, 'fee_instructions')
  walk(instr, 'instructions')

  return {
    id,
    outcome: summary ? str(summary.outcome) : null,
    rejectedReason: str(item.rejected_reason) || null,
    feePaid: summary ? num(summary.total_fees_paid) : null,
    createdAt: str(item.created_at),
    finalizedAt: summary ? str(summary.finalized_at) : null,
    minEpoch: num(body.min_epoch),
    maxEpoch: num(body.max_epoch),
    nonce: num(body.nonce),
    instructionKinds: [...feeInstr.map(kind), ...instr.map(kind)],
    statements,
    outputs: statements.flatMap((s) => s.outputs),
  }
}
