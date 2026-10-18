import { createData, demoKeys, demos, LookupError, recordedWorld, type Shown } from './data.ts'
import { isViewSecret, listen } from './decrypt.ts'
import { clear, h } from './dom.ts'
import { outcomeLabel, short } from './format.ts'
import { poltergeist } from './poltergeist.ts'
import { explorerLink, renderLeaks, renderPoltergeist, renderReading, renderStranger, renderStrangerEmpty, type Hearing } from './render.ts'

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id)
  if (!el) throw new Error(`missing element #${id}`)
  return el as T
}
const txid = $<HTMLInputElement>('txid')
const demo = $<HTMLSelectElement>('demo')
const status = $('status')
const strangerBody = $('stranger-body')
const strangerCard = $('stranger')
const leaksBody = $('leaks-body')
const keysBox = $('keys')
const ownKey = $<HTMLInputElement>('own-key')
const ownHint = $('own-hint')
const reading = $('reading')
const mediumActions = $('medium-actions')
const modeBadge = $('mode-badge')
const modeText = $('mode-text')
const modeSwitch = $('mode-switch')
const buttons = [$('summon'), $('hold'), $('look')]

const oneColumn = window.matchMedia('(max-width: 959px)') // keep in step with style.css
const calm = window.matchMedia('(prefers-reduced-motion: reduce)')
const data = createData()
let current: Shown | null = null
let busy = false
let loadSeq = 0 // answers that arrive after a newer request are dropped
let hearSeq = 0

const keyNames = Object.keys(demoKeys)
const nameOf = (key: string): string => demoKeys[key].label.split(' (')[0]

function setStatus(text: string, kind: 'info' | 'warn' | 'error' = 'info'): void {
  status.textContent = text
  status.className = `status ${kind}`
}

function reflectMode(): void {
  const recorded = data.mode === 'recorded'
  modeBadge.textContent = recorded ? 'Recorded' : 'Live'
  modeBadge.className = `badge ${data.mode}`
  modeText.textContent = recorded ? 'Replaying answers saved earlier. This page asks nobody.' : 'Asking the Esmeralda indexer for one transaction at a time.'
  modeSwitch.setAttribute('aria-pressed', String(recorded))
}

function setBusy(on: boolean): void {
  busy = on
  for (const b of buttons) b.setAttribute('aria-disabled', String(on)) // not "disabled": keyboard focus must not fall off the button
  strangerBody.setAttribute('aria-busy', String(on))
}

// What the medium hears, from the key currently chosen (a demo key or a pasted one).
function chosenKey(): { secret: string; who: string } | { problem: string } | null {
  const own = ownKey.value.trim().toLowerCase()
  if (own) return isViewSecret(own) ? { secret: own, who: 'your key' } : { problem: `A view secret is 64 hexadecimal characters (0-9 and a-f). You have typed ${own.length}.` }
  const radio = keysBox.querySelector<HTMLInputElement>('input[name=key]:checked')
  return radio ? { secret: demoKeys[radio.value].viewSecret, who: `${nameOf(radio.value)}'s key` } : null
}

async function hear(): Promise<void> {
  const mine = ++hearSeq
  const key = chosenKey()
  ownHint.textContent = key && 'problem' in key ? key.problem : ''
  let hearing: Hearing
  if (!current) hearing = { kind: 'no-tx' }
  else if (!key || 'problem' in key) hearing = { kind: 'no-key' }
  else {
    const all = current.view.outputs
    const readings = await listen(key.secret, all)
    hearing = readings.length ? { kind: 'read', who: key.who, readings, all } : { kind: 'silence' }
  }
  if (mine === hearSeq) renderReading(reading, hearing)
}

function checkRadio(name: string | null): void {
  for (const r of keysBox.querySelectorAll<HTMLInputElement>('input[name=key]')) r.checked = r.value === name
}

function describe(s: Shown): string {
  const what = `Showing transaction ${short(s.view.id, 8)} (${outcomeLabel(s.view)}).`
  if (s.ours) return `Nobody else's private transfer was among the latest transactions, so this is one of the demos we made for this page. ${what}`
  if (s.fellBack) return `The indexer did not answer, so the page switched to recorded data. ${what}`
  if (s.quietChain) return `The latest live transactions held no private transfer, so this one is recorded. ${what}`
  if (demos.find((d) => d.id === s.view.id)?.kind === 'revealed') return `${what} This sender revealed the amount on purpose, so there is nothing sealed to read: compare the Stranger's view with the other demos.`
  return what
}

// The cards sit below the picker, so after a call the page brings the answer (or the error) into view.
function reveal(el: HTMLElement, block: ScrollLogicalPosition): void {
  el.scrollIntoView({ block, behavior: calm.matches ? 'auto' : 'smooth' })
}
const onScreen = (el: HTMLElement): boolean => {
  const r = el.getBoundingClientRect()
  return r.top >= 0 && r.bottom <= window.innerHeight
}
// One column: always bring the Stranger card to the top. Wide: only if the cards are not already in the upper half of the screen.
const cardsFar = (): boolean => {
  const top = strangerCard.getBoundingClientRect().top
  return oneColumn.matches || top < 0 || top > window.innerHeight / 2
}

async function load(job: () => Promise<Shown>, opts: { key?: string; fromUser?: boolean } = {}): Promise<void> {
  if (busy) return
  const mine = ++loadSeq
  setBusy(true)
  setStatus(data.mode === 'live' ? 'Calling the indexer…' : 'Opening the recording…')
  try {
    const shown = await job()
    if (mine !== loadSeq) return
    current = shown
    renderStranger(strangerBody, shown)
    renderLeaks(leaksBody, shown.view)
    mediumActions.replaceChildren(explorerLink(shown.view.id)) // the Medium card has its own link to the same transaction
    txid.value = shown.view.id
    history.replaceState(null, '', `#tx=${shown.view.id}`)
    if (opts.key) {
      checkRadio(opts.key)
      ownKey.value = ''
    }
    reflectMode()
    setStatus(describe(shown), shown.fellBack || shown.quietChain ? 'warn' : 'info')
    if (opts.fromUser && cardsFar()) reveal(strangerCard, 'start')
    await hear()
  } catch (e) {
    if (mine !== loadSeq) return
    current = null
    renderStrangerEmpty(strangerBody)
    renderLeaks(leaksBody, null)
    clear(mediumActions)
    reflectMode()
    if (e instanceof LookupError) setStatus(e.message, 'error')
    else {
      console.error(e)
      setStatus('Something unexpected went wrong. Try again, or switch to recorded data.', 'error')
    }
    if (opts.fromUser && !onScreen(status)) reveal(status, 'center')
    await hear()
  } finally {
    if (mine === loadSeq) setBusy(false)
  }
}

// Wire the page.
for (const d of demos) demo.append(h('option', { value: d.id }, `Demo ${d.n} · ${short(d.id, 6)}${d.kind === 'revealed' ? ' · revealed amount' : ''}`))
for (const key of keyNames) {
  keysBox.append(h('label', { class: 'choice' }, h('input', { type: 'radio', name: 'key', value: key }), h('span', null, demoKeys[key].label)))
}

$('pick').addEventListener('submit', (e) => {
  e.preventDefault()
  void load(() => data.lookup(txid.value), { fromUser: true })
})
$('summon').addEventListener('click', () => void load(() => data.recent(), { fromUser: true }))
$('hold').addEventListener('click', () => {
  const d = demos[demo.selectedIndex]
  void load(() => data.lookup(d.id), { key: d.to, fromUser: true })
})
modeSwitch.addEventListener('click', () => {
  data.setMode(data.mode === 'live' ? 'recorded' : 'live')
  reflectMode()
  setStatus(data.mode === 'recorded' ? 'Switched to recorded data. Nothing will be asked of the indexer.' : 'Switched back to live data.')
})
keysBox.addEventListener('change', () => {
  ownKey.value = ''
  void hear()
})
ownKey.addEventListener('input', () => {
  if (ownKey.value.trim()) checkRadio(null)
  void hear()
})

reflectMode()
renderStrangerEmpty(strangerBody)
renderLeaks(leaksBody, null)
renderPoltergeist($('polt-body'), poltergeist(recordedWorld())) // recorded data only: the same numbers on every visit
void hear()
const fromHash = /^#tx=([0-9a-f]{64})$/.exec(location.hash)
if (fromHash) void load(() => data.lookup(fromHash[1]))
