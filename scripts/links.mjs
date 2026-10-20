// Do the explorer links resolve? Opens https://explorer.tari.mw/tx/<id> (built with the same function the page uses) in headless
// Chromium for every demo transaction, and checks that the page shows that very id and its outcome. A made-up id is the negative
// control: the check must fail for it. The two footer links are fetched too. Writes evidence/explorer-links.txt.
// Every transaction the README links to is checked: the 11 demo payments, the 4 Auditor transfers and the Auditor set-up steps.
// Usage: node scripts/links.mjs          (needs the network; one page at a time, 1.5 s apart)
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'
import { EXPLORER_URL, explorerTx } from '../src/config.ts'

delete process.env.DISPLAY // headless only, never a real screen
const ledger = JSON.parse(readFileSync(new URL('../ledger.json', import.meta.url), 'utf8'))
const lines = []
const say = (s) => {
  lines.push(s)
  console.log(s)
}
let failed = 0
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const dir = mkdtempSync(join(tmpdir(), 'seance-links-'))
const browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM ?? '/usr/bin/chromium', headless: true, userDataDir: dir, args: ['--no-sandbox', '--disable-dev-shm-usage'] })

/** Opens the explorer page for an id and says what it shows. */
async function look(id) {
  const page = await browser.newPage()
  try {
    const t0 = Date.now()
    const resp = await page.goto(explorerTx(id), { waitUntil: 'networkidle2', timeout: 45000 })
    // the explorer draws the transaction after loading: wait for the id to show up, or give up after 15 s
    await page.waitForFunction((p) => document.body.innerText.includes(p), { timeout: 15000 }, id.slice(0, 10)).catch(() => {})
    const text = await page.evaluate(() => document.body.innerText)
    return { http: resp?.status() ?? 0, title: await page.title(), hasId: text.includes(id), commit: /\bCommit\b/.test(text), ms: Date.now() - t0, head: text.replace(/\s+/g, ' ').slice(0, 120) }
  } finally {
    await page.close()
  }
}

say(`Explorer links, checked ${new Date().toISOString()} against ${EXPLORER_URL}`)
try {
  const linked = [...ledger.txs, ...ledger.hero, ...ledger.setup]
  for (const tx of linked) {
    const r = await look(tx.id)
    const ok = r.http === 200 && r.hasId && r.commit
    if (!ok) failed++
    say(`${ok ? 'ok  ' : 'FAIL'} ${tx.id}  http ${r.http}  shows the id: ${r.hasId}  shows Commit: ${r.commit}  title: ${r.title}  (${r.ms} ms)`)
    await sleep(1500)
  }
  // negative control: an id nobody sent. If the check passed here, it would prove nothing.
  const none = 'ab'.repeat(32)
  const c = await look(none)
  const rejected = !c.commit
  if (!rejected) failed++
  say(`${rejected ? 'ok  ' : 'FAIL'} negative control ${none.slice(0, 12)}...  shows Commit: ${c.commit}  (must be false)  page says: ${c.head}`)
} finally {
  await browser.close()
  rmSync(dir, { recursive: true, force: true })
}

for (const url of [EXPLORER_URL, 'https://ootle.tari.com']) {
  try {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20000) })
    const ok = r.status === 200
    if (!ok) failed++
    say(`${ok ? 'ok  ' : 'FAIL'} footer link ${url}  http ${r.status}`)
  } catch (e) {
    failed++
    say(`FAIL footer link ${url}  ${e?.name}: ${e?.message}`)
  }
}

say(failed === 0 ? 'RESULT: PASS' : `RESULT: FAIL (${failed})`)
mkdirSync(new URL('../evidence/', import.meta.url), { recursive: true })
writeFileSync(new URL('../evidence/explorer-links.txt', import.meta.url), lines.join('\n') + '\n')
process.exit(failed === 0 ? 0 : 1)
