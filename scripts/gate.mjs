// Browser gate harness. Serves the gate page (vite dev on 5273, or the production build on 4273 under /seance/), drives headless
// Chromium and checks (a) wasm loads through the bundler, (b) the page fetches the indexer itself (CORS), (c) the in-page decrypt
// matches the spike's gate-c output. Writes evidence/gate-browser-<mode>.{json,txt}.
//   env -u DISPLAY node scripts/gate.mjs dev|build        (needs ../.keys/bob.json and ../notes/gate-c-*.txt from the spike)
// The view secret is read from disk by path, injected into the page at run time and redacted from every output.
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'
import { serveDir } from './serve.mjs'

const mode = process.argv[2] ?? 'build'
const APP = new URL('..', import.meta.url).pathname
const SPIKE = new URL('../../', import.meta.url).pathname // seance/
const KEYS = process.env.GATE_KEYS ?? join(SPIKE, '.keys/bob.json')
const secret = JSON.parse(readFileSync(KEYS, 'utf8')).viewSecret
const tx = readFileSync(join(SPIKE, 'notes/gate-c-tx.txt'), 'utf8').trim()
const notes = readFileSync(join(SPIKE, 'notes/gate-c-output.txt'), 'utf8')
const expected = { amount: notes.match(/value: '(\d+)'/)?.[1], memo: notes.match(/memo text: "(.*?)"/)?.[1] }
if (!secret || !expected.amount || !expected.memo) throw new Error('could not read the gate inputs')

const redact = (s) => String(s).split(secret).join('<view-secret>').split(APP).join('<app>/')
let child = null, server = null, url
if (mode === 'dev') {
  child = spawn(process.execPath, [join(APP, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5273', '--strictPort'], { cwd: APP, stdio: ['ignore', 'pipe', 'pipe'] })
  await new Promise((ok, fail) => {
    const t = setTimeout(() => fail(new Error('vite did not start')), 30000)
    child.stdout.on('data', (d) => /Local:/.test(String(d)) && (clearTimeout(t), ok()))
    child.on('exit', (c) => fail(new Error(`vite exited ${c} (port 5273 busy?)`)))
  })
  url = 'http://127.0.0.1:5273/gate.html'
} else {
  execFileSync(process.execPath, [join(APP, 'node_modules/vite/bin/vite.js'), 'build', '--mode', 'gate'], { cwd: APP, stdio: 'pipe' })
  server = await serveDir(join(APP, 'dist-gate'), 4273, '/seance/')
  url = 'http://127.0.0.1:4273/seance/gate.html'
}

const profile = mkdtempSync(join(tmpdir(), 'seance-chromium-'))
const browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM ?? '/usr/bin/chromium', headless: true, userDataDir: profile, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const log = { console: [], pageErrors: [], requests: [] }
let result, fail = null, chromium
try {
  const page = await browser.newPage()
  await page.evaluateOnNewDocument((g) => { window.__GATE__ = g }, { tx, viewSecret: secret })
  page.on('console', (m) => log.console.push({ type: m.type(), text: redact(m.text()).slice(0, 300) }))
  page.on('pageerror', (e) => log.pageErrors.push(redact(e.message).slice(0, 300)))
  page.on('requestfailed', (r) => log.requests.push({ url: redact(r.url()), failed: r.failure()?.errorText }))
  page.on('response', (r) => log.requests.push({ url: redact(r.url()).slice(0, 160), status: r.status(), type: r.request().resourceType(), contentType: r.headers()['content-type'], acao: r.headers()['access-control-allow-origin'] }))
  await page.goto(url, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__GATE_RESULT__ !== undefined, { timeout: 60000 })
  result = await page.evaluate(() => window.__GATE_RESULT__)
  chromium = await browser.version()
} catch (e) { fail = redact(e.message) } finally {
  await browser.close(); rmSync(profile, { recursive: true, force: true })
  child?.kill('SIGTERM'); server?.close()
}

const errors = log.console.filter((m) => m.type === 'error').length + log.pageErrors.length + log.requests.filter((r) => r.failed).length
const idx = log.requests.filter((r) => r.url.startsWith('https://ootle-indexer-a.tari.com'))
const dec = result?.decrypt ?? []
const hits = dec.filter((d) => d.plain)
let memoText = hits[0]?.plain?.memo
try { memoText = JSON.parse(memoText).Message ?? memoText } catch { /* plain text already */ }
const checks = {
  'a. wasm loaded through the bundler': !!result?.wasm?.loaded && result.wasm.exports > 20 && log.requests.every((r) => !r.url.endsWith('.wasm')),
  'b. page fetched the indexer itself, CORS ok': !!result?.indexer?.fetched && idx.length > 0 && idx.every((r) => r.status === 200 && r.acao === '*'),
  'c. in-page decrypt matches gate-c output': hits.length === 1 && dec.length === 2 && hits[0].plain.value === expected.amount && memoText === expected.memo,
  'd. 0 console errors, 0 page errors, 0 failed requests': errors === 0,
}
const pass = !fail && Object.values(checks).every(Boolean)
const out = { gate: 'browser', mode, url, when: new Date().toISOString(), chromium, pass, checks, expected, result, requests: log.requests, console: log.console, pageErrors: log.pageErrors, fail }
writeFileSync(join(APP, `evidence/gate-browser-${mode}.json`), redact(JSON.stringify(out, null, 2)) + '\n')
const lines = [`Seance browser gate (${mode}) ${out.when}`, `url ${url}`, `chromium ${chromium}`, `tx ${tx}`, ...Object.entries(checks).map(([k, v]) => `${v ? 'PASS' : 'FAIL'}  ${k}`),
  `decrypt (right key): ${hits.length} of ${dec.length} outputs readable; value ${hits[0]?.plain?.value ?? '-'} uT, memo "${memoText ?? '-'}"; expected ${expected.amount} uT, "${expected.memo}"`,
  `indexer: ${result?.indexer?.ms ?? '-'} ms, outcome ${result?.indexer?.outcome ?? '-'}, requests ${idx.length}, ACAO ${[...new Set(idx.map((r) => r.acao))].join(',') || '-'}`,
  `wasm exports ${result?.wasm?.exports ?? '-'}; no .wasm request: ${log.requests.every((r) => !r.url.endsWith('.wasm'))}; console errors ${errors}`, fail ? `harness error: ${fail}` : '', pass ? 'GATE PASS' : 'GATE FAIL']
writeFileSync(join(APP, `evidence/gate-browser-${mode}.txt`), redact(lines.filter(Boolean).join('\n')) + '\n')
console.log(redact(lines.filter(Boolean).join('\n')))
process.exit(pass ? 0 : 1)
