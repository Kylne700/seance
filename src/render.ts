// Turns parsed data into DOM. Everything that comes from the chain (ids, hex, memos) goes in as text, never as HTML.
import type { StealthOutput, StealthStatement, TxView } from './chain.ts'
import { explorerTx } from './config.ts'
import type { Shown } from './data.ts'
import type { Reading } from './decrypt.ts'
import { clear, h } from './dom.ts'
import { outcomeLabel, plural, short, tari, when } from './format.ts'
import { leaks, paysFee, type Leak } from './leaks.ts'

const MAX_NOTES = 6 // a transaction with more sealed notes than this is cut here, and says so

const KIND_CAPTION: Record<string, string> = {
  StealthTransfer: 'The private transfer: spends old sealed notes and creates new ones.',
  PutLastInstructionOutputOnWorkspace: 'Keeps the revealed funds at hand for the next step.',
  TakeFromBucket: 'Splits a public amount off the revealed funds.',
  PayFeeFromBucket: 'Pays the network fee, in the open.',
  CreateAccount: 'Opens a public account for a receiver.',
}

const fact = (term: string, ...value: (Node | string)[]): HTMLElement => h('div', { class: 'fact' }, h('dt', null, term), h('dd', null, ...value))
const caption = (text: string): HTMLElement => h('p', { class: 'caption' }, text)
const hex = (value: string): HTMLElement => h('code', { class: 'hex' }, value)
const bytes = (term: string, value: string, text: string): HTMLElement => h('div', { class: 'bytes' }, h('p', { class: 'term' }, term), hex(value), caption(text))

const clip = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n - 1)}…`)
const OUTCOME_CAPTION: Record<string, string> = {
  Commit: 'The network accepted it.',
  FeeIntentCommit: 'Only the fee went through. The rest of the transaction was aborted.',
}
function outcomeFact(v: TxView): HTMLElement {
  const text = v.outcome ? OUTCOME_CAPTION[v.outcome] : v.rejectedReason ? clip(v.rejectedReason, 240) : 'It has no summary yet, so the network has not settled it.'
  return fact('Outcome', outcomeLabel(v), caption(text ?? ''))
}

export function explorerLink(id: string): HTMLElement {
  return h('a', { class: 'btn ghost', href: explorerTx(id), target: '_blank', rel: 'noopener noreferrer' }, 'Open in the explorer', h('span', { class: 'sr-only' }, ' (opens in a new tab)'))
}

// On a phone the sealed notes start closed, so the page does not bury the medium under screens of hex. Keep 960 in step with style.css.
const wide = (): boolean => window.matchMedia('(min-width: 960px)').matches

function note(o: StealthOutput, i: number, total: number): HTMLElement {
  return h(
    'details',
    wide() ? { class: 'note', open: '' } : { class: 'note' },
    h('summary', null, `Sealed note ${i + 1} of ${total}`, h('span', { class: 'peek' }, `${o.ciphertextBytes} bytes`)),
    bytes('Commitment', o.commitment, 'A sealed number that locks the amount. The network can check the books add up without ever seeing it.'),
    bytes('One-time key', o.senderNonce, "Made fresh for this note. It is not an address. With the recipient's view key it opens the note."),
    h(
      'details',
      { class: 'bytes' },
      h('summary', null, 'The locked message ', h('span', { class: 'peek' }, short(o.ciphertext, 10))),
      hex(o.ciphertext),
      caption(`This is the ciphertext, ${o.ciphertextBytes} bytes: the amount and the memo, locked to the recipient. The size leaks a little: a note without a memo is 80 bytes, a note with one is longer.`),
    ),
    h('p', { class: 'term' }, 'Spend rule'),
    caption(o.spendCondition === 'Key' ? 'Key: only the holder of one private key can spend this note.' : `${o.spendCondition}: a rule other than a single key.`),
    h('p', { class: 'veiled' }, h('span', { class: 'bar', 'aria-hidden': 'true' }), 'Amount, memo and receiver: hidden from you'),
  )
}

function statement(st: StealthStatement, n: number, feePaid: number | null): HTMLElement {
  const ro = st.revealedOut
  const isFee = paysFee(st, feePaid)
  const shown = st.outputs.slice(0, MAX_NOTES)
  return h(
    'section',
    { class: 'stmt' },
    h('h4', null, `Private transfer ${n + 1}`),
    h('p', { class: 'sum' }, `It spends ${plural(st.inputCommitments.length, 'earlier note')} and creates ${plural(st.outputs.length, 'new sealed note')}.`),
    h(
      'dl',
      { class: 'facts' },
      st.revealedIn !== '0' ? fact('Taken from the public balance', `${tari(st.revealedIn)}, in the open`) : null,
      ro ? fact(isFee ? 'Revealed to pay the fee' : 'Revealed in the open', `${tari(ro.amount)} for key ${short(ro.receiver, 6)}`, caption(isFee ? 'This is the network fee. The amount, and the key it names, are in the open, unlike the sealed notes below.' : 'Revealed amounts are readable by everyone, unlike the sealed notes below.')) : null,
      st.inputCommitments.length ? fact('Spent notes', ...st.inputCommitments.slice(0, MAX_NOTES).map((c) => h('code', { class: 'hex' }, short(c, 12))), caption('Which old notes were spent is public. What was inside them is not.')) : null,
    ),
    ...shown.map((o, i) => note(o, i, st.outputs.length)),
    st.outputs.length > shown.length ? caption(`${plural(st.outputs.length - shown.length, 'more sealed note')} not shown. The explorer lists them all.`) : null,
  )
}

export function renderStranger(body: HTMLElement, s: Shown): void {
  const v: TxView = s.view
  clear(body)
  body.append(
    h('p', { class: `source ${s.mode}` }, s.mode === 'live' ? 'Live: read from the indexer just now.' : "Recorded: a saved copy of the indexer's answer."),
    h(
      'dl',
      { class: 'facts' },
      fact('Transaction', hex(v.id)),
      outcomeFact(v),
      fact('Fee paid', v.feePaid == null ? 'Not known without a summary' : `${tari(v.feePaid)}, in the clear`),
      fact('Created', when(v.createdAt)),
      fact('Instructions', h('ul', { class: 'instr' }, ...v.instructionKinds.map((k) => h('li', null, h('code', null, k), KIND_CAPTION[k] ? h('span', { class: 'cap' }, KIND_CAPTION[k]) : null)))),
    ),
    h('div', { class: 'actions' }, explorerLink(v.id)),
    ...v.statements.map((st, n) => statement(st, n, v.feePaid)),
    ...(v.statements.length === 0 ? [h('p', { class: 'empty' }, 'This transaction has no private transfer, so nothing in it is sealed.')] : []),
  )
}

export function renderStrangerEmpty(body: HTMLElement): void {
  clear(body)
  body.append(h('p', { class: 'empty' }, 'Nothing on the table yet. Call up a transaction above.'))
}

function leakItem(l: Leak): HTMLElement {
  const shown = l.values.slice(0, MAX_NOTES)
  return h(
    'div',
    { class: 'leak', 'data-leak': l.id },
    h('dt', null, l.term),
    h(
      'dd',
      null,
      ...(shown.length ? shown.map((x) => (l.mono ? hex(x) : h('p', { class: 'val' }, x))) : [h('p', { class: 'val none' }, 'None')]),
      l.values.length > shown.length ? caption(`${l.values.length - shown.length} more not shown. The explorer lists them all.`) : null,
      caption(l.caption),
    ),
  )
}

/** The "What still leaks" panel: the same transaction as the Stranger card, seen as a list of what stays public. */
export function renderLeaks(body: HTMLElement, v: TxView | null): void {
  clear(body)
  body.append(v ? h('dl', { class: 'leak-list' }, ...leaks(v).map(leakItem)) : h('p', { class: 'empty' }, 'Nothing to inspect yet. Call up a transaction above.'))
}

export type Hearing = { kind: 'no-tx' } | { kind: 'no-key' } | { kind: 'silence' } | { kind: 'read'; who: string; readings: Reading[]; all: StealthOutput[] }

export function renderReading(el: HTMLElement, hearing: Hearing): void {
  clear(el)
  switch (hearing.kind) {
    case 'no-tx':
      el.append(h('p', { class: 'empty' }, 'The medium waits for a transaction. Call one up above.'))
      break
    case 'no-key':
      el.append(h('p', { class: 'empty' }, 'Hand the medium a key and it will listen.'))
      break
    case 'silence':
      el.append(h('div', { class: 'silence' }, h('p', { class: 'quiet' }, 'The spirits are quiet.'), caption('A key that does not fit hears nothing at all. It cannot even tell a wrong key from a note meant for someone else.')))
      break
    case 'read': {
      const { who, readings, all } = hearing
      for (const r of readings) {
        el.append(
          h(
            'div',
            { class: 'reading' },
            h('p', { class: 'term' }, `Sealed note ${all.indexOf(r.output) + 1} of ${all.length} opens`),
            h('p', { class: 'amount' }, tari(r.plain.value)),
            r.plain.memo ? h('p', { class: 'memo' }, `\u201C${r.plain.memo}\u201D`) : h('p', { class: 'memo none' }, 'No memo'),
          ),
        )
      }
      const shut = all.length - readings.length
      el.append(caption(`Read inside this page with ${who}. Nothing was sent anywhere.${shut > 0 ? ` The other ${plural(shut, 'sealed note')} ${shut === 1 ? 'stays' : 'stay'} shut for this key.` : ''}`))
      break
    }
  }
}
