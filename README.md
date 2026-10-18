# Seance

A seance for a private payment. Pick any real transaction on Tari's Esmeralda test network and watch three ghosts try to read it.

- **The Stranger** holds no key. It shows what everyone can see: the id, the outcome, the fee, the sealed notes as real bytes, each with a plain caption.
- **The Medium** holds a recipient's view key and listens inside the page. With the right key it hears the amount and the memo. With a wrong key it hears nothing: "The spirits are quiet."
- **The Auditor** is a slot marked "Coming next" in this stage.

Made for the Tari October Build Contest, "Spooky Secrets". Testnet only. Nothing here touches mainnet.

Status: stage 1 of the build. Not published anywhere yet. The Poltergeist, the full "what still leaks" panel, the result card and the Auditor are not built.

## Try it

| Time | Do this | You should see |
|---|---|---|
| 10 s | Press **Summon a recent transaction**, or paste any transaction id and press **Look at it** | The Stranger card with the real public fields of that transaction, the sealed notes as bytes, and a link to the same id in the explorer |
| 60 s | Pick a prepared demo and press **Hold the seance** | The Medium reads the amount and memo with the demo key. Choose Eve (a key that fits nothing) and it answers "The spirits are quiet." |
| 5 min | Look up a transaction id, then paste a view secret into the Medium's field (the demo keys are below, or use your own) | The Medium decrypts in the page. The key is never sent, stored or put in the address. The page's Content Security Policy only lets it talk to the indexer, so you can check that in the page source |

If the indexer cannot be reached (network error, no answer in 8 s, a 5xx or a 429), the page switches by itself to recorded data, says so, and labels every answer "Recorded". "Use recorded data" switches by hand. Recorded mode needs no network at all.

## Run it

Needs Node 24 (tested with 24.18; `package.json` also allows 22.18). The scripts import the TypeScript files directly.

```
npm ci
npm run dev                          # http://127.0.0.1:5273
npm test                             # offline, no network
npm run build && npm run preview     # production build at http://127.0.0.1:4273
```

The build uses a relative base path, so `dist/` works from any folder, for example under `/seance/`.

## Checks

| Command | What it checks |
|---|---|
| `npm test` | 59 tests, offline. For every demo transaction the right view key gives the recorded amount and memo and every other key hears nothing; tampered ciphertext fails; recorded mode answers with `fetch` replaced by a function that throws; the fallback rules |
| `npm run stranger` | Live. Fetches 3 recent transactions by id from the indexer, parses them with the page's own code, checks the real bytes and that a key that fits nothing hears nothing. Exits 0 only if all three pass |
| `npm run smoke` | Run `npm run build` first. Headless Chromium over the production build served under `/seance/`: the 10 s and 60 s steps live and in recorded mode (with every outside host made unresolvable), all 11 demos through the page, key privacy, 0 console errors, axe, overflow, 44 px targets and the focus ring at 1280 and 390 px wide, keyboard use, reduced motion, contrast, the CSP. Writes `evidence/smoke.txt` and the screenshots |
| `npm run links` | Opens the explorer page for each demo id and checks it shows that id and "Commit"; a made-up id is the negative control |
| `npm run scan` | History, tree and `dist/`: throwaway secrets, key and token shapes, a private word list (counts only), home paths |
| `npm run licenses` | Licence of every installed dependency; fails on GPL or AGPL |

Last results (2026-10-18) are in `evidence/`: `smoke.txt`, `explorer-links.txt`, `stranger-recent.txt`, `gate-browser-*.txt`, and the screenshots `seance-<width>-<live|recorded>-*.png`.

Maintainer scripts that need a local Tari wallet daemon and cannot run from a clean clone: `npm run demo` (sent the demo transactions, then recorded the indexer's answers in `ledger.json`) and `npm run gate` (the browser gate: wasm loads in the bundle, the page reads the indexer itself, in-page decryption matches a known answer).

## The demo transactions

Eleven real Esmeralda transactions, sent from a throwaway testnet account. `ledger.json` holds the indexer's answer for each one and the amount and memo each key must hear. It is the recorded data the page uses and the oracle the tests check against. Transaction 7 has no memo. Transaction 11 reveals its amount on purpose, so no key hears anything sealed in it.

| # | Transaction (explorer link) | Amount | Recipient | Value | Memo |
|---|---|---|---|---|---|
| 1 | [`7c5d35f880…a6a032`](https://explorer.tari.mw/tx/7c5d35f880edc08e5cddb42c63f4aaf821e9465dc34f31215713d33391a6a032) | sealed | Bob | 0.666 tTARI | "The candle went out. Did you do that?" |
| 2 | [`985ef2beb3…989c2a`](https://explorer.tari.mw/tx/985ef2beb38f620257f76856c2692125c12e0507b8b800a59bcab2bb21989c2a) | sealed | Carol | 1.31 tTARI | "Meet at the old well. Midnight." |
| 3 | [`c180599784…e2d5ef`](https://explorer.tari.mw/tx/c1805997848547b24d78cc98e6934ef78bbb83fc5f26d81337b407f6d0e2d5ef) | sealed | Bob | 0.031 tTARI | "Trick or treat" |
| 4 | [`ad5095f9ac…632d78`](https://explorer.tari.mw/tx/ad5095f9ac6f965e939d836640ff1d907fd5923590ddc8f49e62279796632d78) | sealed | Carol | 0.5 tTARI | "Boo!" |
| 5 | [`6fa5e86b97…35468e`](https://explorer.tari.mw/tx/6fa5e86b9796f50178bb9de6e2125670b5c1cf3756b0a4f5d9695d931935468e) | sealed | Bob | 2 tTARI | "Seven candles, one wish." |
| 6 | [`2bbd023b7f…f3f319`](https://explorer.tari.mw/tx/2bbd023b7f27a528e0347ceae4f225c690a24c6cd69d9d6387789b78d2f3f319) | sealed | Carol | 0.013 tTARI | "Mind the third stair." |
| 7 | [`32090261a1…2fcb23`](https://explorer.tari.mw/tx/32090261a197b2f99e4b0a86a6df3b277a5dc4f273576ddf1190509f782fcb23) | sealed | Bob | 0.1 tTARI | none |
| 8 | [`092e8a9587…55473f`](https://explorer.tari.mw/tx/092e8a95877a5882d5f8d3c984dd13ded415ea42080fce1d398a80b2ea55473f) | sealed | Carol | 0.99 tTARI | "Pumpkin pie fund." |
| 9 | [`8ebbfc9c06…1aaab6`](https://explorer.tari.mw/tx/8ebbfc9c06713ebce4edb5bfc2ce6b561cbb90025ddba7eb5e80b843c71aaab6) | sealed | Bob | 0.404 tTARI | "Page not found. Neither is the ghost." |
| 10 | [`c3a126b2c9…39c0e2`](https://explorer.tari.mw/tx/c3a126b2c9177316e3233328394146bbb5920e32e2495776bea2c2fa8a39c0e2) | sealed | Carol | 0.7 tTARI | "Garlic, salt, and a very long walk home." |
| 11 | [`ec71ff7a36…c16031`](https://explorer.tari.mw/tx/ec71ff7a36f591b7982c6874706895dabd87358ca4b9133cad833229c4c16031) | amount revealed | Bob | 0.25 tTARI | none |

## The demo keys

These are the view secrets of the three demo identities. They are published on purpose, for testnet only, and they can read the demo transactions above and nothing else. A view key cannot spend. **Never reuse these keys for anything real.**

| Who | View secret |
|---|---|
| Bob (the recipient) | `cd094efe16ad55a188f3f8551dd21a71a2ad0ada03e0760f4fd312ce534c1203` |
| Carol (another recipient) | `68f76ca93c0ffa48eacca00f04b4f8948b6f4661894cb7c74f0d309af1bc4308` |
| Eve (a stranger: a key that fits nothing here) | `b2c2d4cb4841c1ab2d57d712bd28d1cb84aedad00fc14e55e144d55831cea709` |

## What the page asks the network

- `GET /transactions/<id>` on the indexer, for the id you give. `GET /transactions/recent?limit=40` when you press Summon. It never scans the chain.
- Nothing else. The built page carries a Content Security Policy in a meta tag; `connect-src` allows only the indexer host, and the smoke test shows the browser blocking a fetch to anywhere else, `eval` and injected scripts.
- No external fonts, CDNs, analytics or trackers. No cookies, local storage or session storage.
- The explorer and docs links open in a new tab. The page does not call them.
- The address can carry `#tx=<id>`, which is public. A key you paste is never in it.

Design decisions are in [design.md](design.md).

## Reused code

The contest asks for new code. Everything here was written for this contest after 2026-10-01. Two files come from our own experiment of 2026-10-16 to 2026-10-18, the spike that checked the SDK before this build:

- `scripts/wd.mjs`: the walletd JSON-RPC helper, copied unchanged from the spike (`seance/scripts/wd.mjs`) apart from a header comment. Only the maintainer script `scripts/make-demo.mjs` uses it.
- `scripts/make-demo.mjs`: written for this repo; its way of building and polling a stealth transfer through walletd follows the spike's `gate-c.mjs` (a few lines are the same).

No code was copied from tari-project example repositories or from other contest entries. The Tari packages below are used as dependencies, not copied.

## Built with

`@tari-project/ootle`, `@tari-project/ootle-indexer`, `@tari-project/ootle-wasm` (the official SDK: indexer client and the view-key decryption in WebAssembly), Vite, TypeScript, vitest, puppeteer-core and axe-core for the checks. Third-party licence notices ship in `dist/THIRD-PARTY-LICENSES.md`.

This is not a wallet or an explorer. The parsing of transactions, the three lenses, the recorded mode and the page are new.

Developed with an AI coding agent (Claude Code).

## Licence

MIT. See [LICENSE](LICENSE).
