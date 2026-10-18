# Seance

A seance for a private payment. Pick a real transaction on Tari's Esmeralda test network and watch three ghosts try to read it. A fourth ghost, with no key at all, tries to link payments together.

- **The Stranger** holds no key. It shows what everyone can see: the id, the outcome, the fee, the sealed notes as real bytes, each with a plain caption. Under the cards, **What still leaks** lists what stays public, with this transaction's real values.
- **The Medium** holds a recipient's view key and listens inside the page. With the right key it hears the amount and the memo. With a wrong key it hears nothing: "The spirits are quiet."
- **The Auditor** holds the audit key of a token. It counts the amount of every sealed note of that token. It cannot read a memo, and a view key cannot spend. It works on the four payments in our own demo token (SEANCE), which was made with an audit key. On any other transaction it says there is nothing to count.
- **The Poltergeist** holds no key. It reads only public data and tries four chain-analysis tricks (address reuse, amount matching, timing, fee fingerprint), plus the spend graph as an extra, on the 11 TARI demo payments and on a **synthetic** transparent ledger of the same payments. Some tricks still work on Tari, and the page says which.

Made for the Tari October Build Contest, "Spooky Secrets". Testnet only. Nothing here touches mainnet.

Status: stage 2 of the build. Not published anywhere yet. Not built: a result card to share, a preview image and a screen recording (they need the public address).

## Try it

| Time | Do this | You should see |
|---|---|---|
| 10 s | Press **Summon a recent transaction**, or paste any transaction id and press **Look at it** | The Stranger card with the real public fields of that transaction, the sealed notes as bytes, a link to the same id in the explorer, and the **What still leaks** panel for it. Summon looks at the latest 40 transactions and prefers a private transfer by someone else; when there is none it says so and shows one of ours, or a recorded one |
| 60 s | Leave demo 1 picked and press **Hold the seance** | All three ghosts on one payment. The Stranger sees bytes. The Medium, with Bob's key, reads 0.00031415 SEANCE and "Midnight at the old crypt. Come alone." The Auditor, with the audit key, counts both sealed notes (0.00031415 and 0.00018585 SEANCE) in about two seconds behind a progress bar, and says "Memo: shut." Give either ghost Eve's key and it answers "The spirits are quiet." |
| 5 min | Scroll to **The Poltergeist** and read the table. Then summon or pick any other transaction, paste a view secret into the Medium's field (the demo keys are below, or use your own), and hand the Auditor a different key | The Poltergeist's five tricks on two ledgers, with the real counts. The Medium decrypts in the page: the key is never sent, stored or put in the address, and the page's Content Security Policy only lets it talk to the indexer, which you can check in the page source. On a transaction of an ordinary token the Auditor says there is nothing to count |

If the indexer cannot be reached (network error, no answer in 8 s, a 5xx or a 429), the page switches by itself to recorded data, says so, and labels every answer "Recorded". "Use recorded data" switches by hand. Recorded mode needs no network at all, and the Auditor and the Poltergeist work in it the same way.

## Run it

Needs Node 24 (tested with 24.18; `package.json` also allows 22.18). The scripts import the TypeScript files directly.

```
npm ci
npm run dev                          # http://127.0.0.1:5273
npm test                             # offline, no network
npm run build && npm run preview     # production build at http://127.0.0.1:4273
```

The build uses a relative base path, so `dist/` works from any folder, for example under `/seance/`.

## What still leaks

Sealed notes hide the amount, the memo and the receiver. They do not hide everything. Under the three cards the page lists, for the transaction on screen, what anyone can still read with no key at all. Each item shows this transaction's real value and one plain sentence. The page names no fix for any of them, because none was tested here.

| Item | What it shows | Why it matters |
|---|---|---|
| Token (resource address) | Which token moved | The token is public even when the amount is sealed |
| Audit proofs | How many sealed notes carry an audit proof | Whoever holds the token's audit key can read those amounts. That key cannot read a memo |
| Spent notes (the spend graph) | The commitments of the old notes this transaction spends | Which notes were spent is public, so a note can be followed from one transaction to the next. What was inside is not |
| New sealed notes | How many notes were made | The count is public. Who holds them, and what they hold, is not |
| Amounts in the open | Any amount that moved in or out of a public balance | Readable by everyone, unlike a sealed note (demo 15 shows one on purpose) |
| Spend rule | The kind of lock on each new note | The kind is public. A Key lock means one private key can spend the note |
| Created and finalized | When it was sent and when the network settled it | Payments sent in quick succession can be tied together by their times |
| Epoch window | The span of epochs the sender allowed | One wallet sending in one sitting tends to leave the same window every time |
| Fee | What was paid, in the open | A wallet that always pays the same fee has a habit anyone can see |
| Locked message size | The byte length of each note's locked message | A note with no memo is 80 bytes. More means a memo is inside, and the size hints at how long it is |

## Threat model

Who can read what, on the demo transactions:

| Who | Holds | Can read | Cannot |
|---|---|---|---|
| Anyone (the Stranger, the Poltergeist) | Nothing | The public fields listed above, and patterns across transactions | Amounts, memos or receivers of sealed notes |
| A recipient (the Medium) | The recipient's view key | The amount and memo of the notes made for that recipient | Spend. Read notes made for anyone else |
| An auditor (the Auditor) | The token's audit key | The amount of every sealed note of that token | Read a memo. Spend: it is a view key and the spend key is a separate secret, but we did not try to spend with it |

- **An audited token gives its auditor every amount.** The audit key is named once, when the token is made, and every note of the token carries a proof that key can open: in our four transfers 8 of 8 notes do. That is the point of the demo token. For a real token it is a decision to make knowingly. We did not test whether the key can be changed afterwards.
- **The demo keys are public on purpose.** They are testnet-only view keys. Each reads the demo payments made for it and nothing else, and none can spend. The recipients' spend keys were never saved.
- **Patterns leak even when contents do not.** The Poltergeist below ties all 11 TARI demo payments by timing, fee and spend graph. That is a result about how this demo wallet behaved, not a statement about Tari in general.
- **The page trusts the indexer's answer.** It does not check it against the chain, so an indexer that lied could show you a different transaction. The indexer also sees which transaction id you ask for.
- **Not shown here:** anything about mainnet, and anything about the strength of the cryptography. The page uses the official SDK and was not audited.

## The Poltergeist

A ghost with no keys and only patience. It reads what a stranger reads and asks the question of a chain analyst: were these payments all sent by the same wallet? The answer is known (all 11 TARI demo payments come from one wallet of ours), so each trick can be scored.

**Method.** The code is `src/poltergeist.ts`, pure and deterministic. It is handed no key (a test checks that no demo view secret appears anywhere in the data it reads). For each transaction it reads the keys named in the open, any amount paid out in the open, the created time, the epoch window, the fee and the notes spent and made. The tricks:

- **Address reuse** ties two payments that show the same key as sender or receiver.
- **Amount matching** is handed what each payment was for, like an invoice, and looks for that exact amount on the ledger.
- **Timing** ties payments sent within 60 seconds of each other in the same epoch window.
- **Fee fingerprint** ties payments that paid exactly the same fee.
- **Spend graph** (an extra) ties a payment to the one whose note it spends. A transparent account ledger has no notes, so it is "not applicable" there.

**Metric.** Each count is out of the 11 demo payments. *Tied* is how many of our payments the trick put in a group with another of ours (groups grow by chaining: if A is tied to B and B to C, all three are one group). Amount matching is scored as *found*: a payment counts when exactly one row on the ledger shows its amount. *Mixed up* is how many of our payments ended in a group that also holds a transaction that is not ours. It is 0 for every trick on Tari. The synthetic ledger holds only our payments, so nothing can be mixed up there.

**Two ledgers.** Tari is recorded and real: the 11 payments, read together with 9 recorded transactions that are not ours, taken from a sample of the network's latest transactions (captured 2026-10-18), so there is something to be mixed up with. The **synthetic transparent ledger** is not a real chain. The page builds it from the same 11 payments, written the way an account ledger writes them: one sender, the receiver and the amount in the open. Its times, epoch windows and fees are the real ones. It holds only these payments. It is a model of what a transparent ledger shows, not a measurement of any real chain, and the page says it is synthetic at the top of the section and again beside every number.

| Trick | Synthetic transparent ledger | Tari (recorded, real) |
|---|---|---|
| Address reuse | 11 of 11 tied | 0 of 11 |
| Amount matching | 11 of 11 found | 1 of 11 (demo 15, which reveals its amount on purpose) |
| Timing | 11 of 11 tied | 11 of 11 tied |
| Fee fingerprint | 11 of 11 tied | 11 of 11 tied |
| Spend graph (extra) | not applicable | 11 of 11 tied |

What that says. On Tari no key repeats and 10 of the 11 amounts are sealed, so address reuse and amount matching find almost nothing. Timing, the fee fingerprint and the spend graph still tie all 11, with none of the 9 other transactions mixed in. The reasons are plain: one wallet sent all 11 within 140 seconds (no two further apart than 20 seconds), in one epoch window, each paying exactly 0.1 tTARI, and each after the first spent a note the one before it made. A wallet that behaved differently would likely fare differently. We did not test that, and these numbers do not say how a busy wallet would fare.

**The one number that could be tuned** is the timing gap of 60 seconds. It was fixed before the results were computed. 30 seconds gives the same result. 120 or 300 seconds reach the nearest of the 9 other transactions (120 to 121 seconds from the demo set), and then all 11 payments are mixed up with others. The tests pin all of this (`test/poltergeist.test.ts`).

**Scope.** The Poltergeist covers the 11 TARI demo payments (demos 5 to 15). The four SEANCE transfers are not part of it. It runs on recorded data only, so every visit shows the same numbers, and it asks nobody.

## The Auditor

**Outcome: on chain.** The third ghost reads real transactions of a token made with an audit key on Esmeralda, not a proof built in the page. Evidence: the four transfers below, `ledger.json` (the indexer's recorded answers and what each key must read) and `test/auditor.test.ts`.

**Why a token of our own.** An audit proof exists only on the notes of a token made with an audit (view) key, and the ordinary TARI token has none. So the demo makes one. Its template is `template/`, a 34-line Rust file written for this contest (MIT), using `ResourceBuilder::stealth().with_view_key(..)` from `tari_template_lib`. **Which template we used:** our own, `template/`. We called no template published by anyone else and copied no code from one. The only dependency is `tari_template_lib` 0.34.0 (BSD-3-Clause), and none of the 34 crates in its dependency tree is under the GPL or AGPL (`evidence/template-licences.txt`). The demo token is a toy on a test network: anyone may mint it.

Before it was published, the `.wasm` was built with a path prefix remap and searched for the home folder path, the account name, a private word list and the throwaway wallet's secrets (3 secret values, 22 seed-phrase runs, key and token shapes): 0 matches each, with a planted-copy control that the same counters do catch (`evidence/template-wasm-scan.txt`). To rebuild (needs the `wasm32-unknown-unknown` target): `cd template && RUSTFLAGS="--remap-path-prefix=$HOME=/build" cargo build --release --target wasm32-unknown-unknown`. We did not check that a rebuild is byte-for-byte the published one.

**What was sent** (all on Esmeralda, from one throwaway account, 14 transactions in all: 13 committed and one rejected before it ran; fees add up to 2.98 tTARI, of which the template publish was 0.976):

| Step | Transaction | What it did | Fee |
|---|---|---|---|
| Step 1 | [`e5bfeee19f…10d13c`](https://explorer.tari.mw/tx/e5bfeee19f7f52faffe9e6f191b9ab8a8465e4ac1e10b00c999433070a10d13c) | Made the throwaway account public on chain with 220 tTARI of public balance, so it can pay the fee of the next steps. | 1 tTARI |
| Step 2 | [`0a3a55a422…63b29f`](https://explorer.tari.mw/tx/0a3a55a422ce20a3b4c1148dcf7672d62a09d3b6f99682cdba84d011f963b29f) | Published template/ (our own code, no metadata). | 0.976133 tTARI |
| Step 3, first try | `543d087206…` (rejected, not linked) | First try to make the token. Rejected before it ran: the fee account was missing from its inputs. Nothing was made. | none |
| Step 3 | [`1e75bcf8ce…901180`](https://explorer.tari.mw/tx/1e75bcf8ce9d397c32c902927432c0cbca085a0ec2e8e9c6b05d96ef92901180) | Made the token (a stealth resource with the auditor view key) and its component. | 0.002305 tTARI |
| Step 4 | [`53f03b0966…81610f`](https://explorer.tari.mw/tx/53f03b0966654e72a6d17aae6010658134ac6fb4a1db1e747ce6f8287681610f) | Minted 1,000,000 base units of the token as a public balance of the throwaway account. | 0.003012 tTARI |
| Step 5 | [`13f0e4495f…bb7fea`](https://explorer.tari.mw/tx/13f0e4495f7e1f75e7a699d1eb5934c59bd7fb91de990c082f32d6246bbb7fea) | Turned 50000 base units of the public balance into one sealed note of the throwaway account. Each of demos 1 to 4 is paid from that note, so none of them shows an amount in the open. | 0.1 tTARI |

**The shield step, and four flawed tests.** The first four transfers we sent took their amount from the account's public balance. A transfer paid from a public balance writes its amount in the open ("revealed amount"), so the sealed note hid nothing and the Auditor would have had nothing to show. We found it by reading our own transactions. The fix is the shield step: all 50,000 base units were first moved into one sealed note, and each of demos 1 to 4 spends the note the one before it left (the first spends the sealed 50,000). The four flawed tests stay on chain, are kept in `ledger.json` under `earlier`, and are not demos:

- Test 1 of 4: [`4ace110f25…2d86ca`](https://explorer.tari.mw/tx/4ace110f253ecc7aa7ac7a7f8f5386f22a5f5d0a8d903e58a8149ef6732d86ca)
- Test 2 of 4: [`5e998381ec…7f2ba0`](https://explorer.tari.mw/tx/5e998381ec1b722ca873ab444a6a38fa8d645e4d325b04c9a0810769917f2ba0)
- Test 3 of 4: [`7342534b62…378e63`](https://explorer.tari.mw/tx/7342534b6210a1efc59446858c60e70899b6375a9b16527efa0620a61b378e63)
- Test 4 of 4: [`72409c7c7a…3cec1b`](https://explorer.tari.mw/tx/72409c7c7a6ea10d57ad438c06a7740b7b287fdf71514f661ad15246e13cec1b)

**The four demo payments** (demos 1 to 4). Each spends one sealed note and makes two (the payment and the change), pays 0.1 tTARI of fee from the public TARI balance, and shows no amount in the open. Each spends the change of the one before. Memos are readable by the recipient only.

| Demo | Transaction (explorer link) | Recipient | Amount | Memo | The Auditor counts (payment + change) |
|---|---|---|---|---|---|
| 1 | [`3ca7740a21…0d80d9`](https://explorer.tari.mw/tx/3ca7740a215858dab7f184bd155beb996fb2c0dba863e5b3ad30cf163a0d80d9) | Bob | 0.00031415 SEANCE | "Midnight at the old crypt. Come alone." | 0.00031415 + 0.00018585 SEANCE |
| 2 | [`44e6f915f4…7a22d2`](https://explorer.tari.mw/tx/44e6f915f4deeeb3e45f51f1da930b8fa5426fa4b4c560989d1547ad2b7a22d2) | Carol | 0.00007 SEANCE | "I never told the auditor about the cat." | 0.00007 + 0.00011585 SEANCE |
| 3 | [`c2e0eb0d7a…cf4ce7`](https://explorer.tari.mw/tx/c2e0eb0d7ae3f21622cebbea0b5643dea50fa89c9efe8fd0b1d8778b00cf4ce7) | Bob | 0.00004096 SEANCE | "The books are clean. The house is not." | 0.00004096 + 0.00007489 SEANCE |
| 4 | [`6a11c0f848…96ecfa`](https://explorer.tari.mw/tx/6a11c0f8481023c8de8dd4fdbffa54a18aa497fb086f9270326477fa2c96ecfa) | Carol | 0.0000025 SEANCE | "Salt for the doorstep." | 0.0000025 + 0.00007239 SEANCE |

**In the page.** The Auditor card has its own choice of key: Bob's, Carol's, Eve's or the audit key. With the audit key it counts the amount of each sealed note and shows "Memo: shut. The audit key cannot open it." With any other key it hears nothing: "The spirits are quiet." On a transaction whose token has no audit key it says there is nothing to count. **Hold the seance** on a demo of the first group hands the Medium the recipient's key and the Auditor the audit key.

**How it counts.** An audit proof is the amount, encrypted to the audit key, with a proof that it fits the note's commitment. Opening it has no shortcut: the WebAssembly in the page tries every amount from 0 to 50,000 base units (0.0005 SEANCE) against the proof, a few microseconds each. A larger amount is reported as past the range. The search is cut into slices of about 25 ms and the page is handed back between them, so it never freezes. It needs no Worker, so the Content Security Policy is unchanged. A progress bar shows how far it has got (also for screen readers), and with `prefers-reduced-motion` the fade-ins, the flame and every transition are switched off (the bar still fills, in steps). Measured with headless Chromium on the maintainer's machine: about two seconds for demo 1 with no long task (50 ms or more) reported; with the CPU slowed 4 times, about 8 seconds, again with no long task, so the page keeps answering in between (`evidence/smoke.txt`).

What the Auditor does not claim: it does not read memos, it does not spend, it counts only the demo token's notes, and it searches only the range above.

## Checks

| Command | What it checks |
|---|---|
| `npm test` | 151 tests in 6 files, offline. For every demo transaction the right view key gives the recorded amount and memo and every other key hears nothing; the audit key counts the recorded amount of both notes of every SEANCE transfer, reads no memo, and a key that is not the audit key hears nothing; the search works in slices and can be cancelled; the Poltergeist's numbers are pinned, each trick is shown to read the field it claims, and its sentences are built from the numbers; the "what still leaks" items; tampered ciphertext fails; recorded mode answers with `fetch` replaced by a function that throws; the fallback rules |
| `npm run stranger` | Live. Fetches 3 recent transactions by id from the indexer, parses them with the page's own code, checks the real bytes and that a key that fits nothing hears nothing. Exits 0 only if all three pass |
| `npm run smoke` | Run `npm run build` first. Headless Chromium over the production build served under `/seance/`, at 1280 and 390 px wide, live and in recorded mode (with every outside host made unresolvable): the 10 s and 60 s steps, all 15 demos through the page, the leaks panel, the Poltergeist (live and recorded say the same), the Auditor (all four SEANCE transfers, wrong keys, progress bar, a key changed mid-count, reduced motion, a 4 times slower CPU with a control for the long-task check), key privacy, 0 console errors, axe, overflow, 44 px targets and the focus ring, keyboard use, contrast, the CSP. Writes `evidence/smoke.txt` and the screenshots |
| `npm run links` | Opens the explorer page for each of the 24 transactions this file links to and checks it shows that id and "Commit"; a made-up id is the negative control |
| `npm run scan` | History, tree and `dist/`: throwaway secrets, key and token shapes, a private word list (counts only), home paths |
| `npm run licenses` | Licence of every installed dependency; fails on GPL or AGPL |

Last results (2026-10-18) are in `evidence/`: `smoke.txt`, `explorer-links.txt`, `stranger-recent.txt`, `gate-browser-*.txt`, `template-wasm-scan.txt`, `template-licences.txt`, and the screenshots `seance-<width>-<live|recorded>-*.png` (the three ghosts, the leaks panel, the Poltergeist, the Auditor counting).

Maintainer scripts that need a local Tari wallet daemon and cannot run from a clean clone: `npm run demo` (sent the 11 TARI payments, then recorded the indexer's answers in `ledger.json`), `node scripts/make-hero.mjs` (published the template, made and minted the token, shielded, sent the four SEANCE transfers and recorded them) and `npm run gate` (the browser gate: wasm loads in the bundle, the page reads the indexer itself, in-page decryption matches a known answer).

## The demo transactions

Fifteen real Esmeralda transactions, sent from a throwaway testnet account. The page numbers them as demos 1 to 15. `ledger.json` holds the indexer's answer for each one and the amount and memo each key must read. It is the recorded data the page uses and the oracle the tests check against. Demos 1 to 4 are the SEANCE payments above. Demos 5 to 15 pay in TARI. Demo 11 has no memo. Demo 15 reveals its amount on purpose, so no key reads anything sealed in it.

| Demo | Transaction (explorer link) | Amount | Recipient | Value | Memo |
|---|---|---|---|---|---|
| 5 | [`7c5d35f880…a6a032`](https://explorer.tari.mw/tx/7c5d35f880edc08e5cddb42c63f4aaf821e9465dc34f31215713d33391a6a032) | sealed | Bob | 0.666 tTARI | "The candle went out. Did you do that?" |
| 6 | [`985ef2beb3…989c2a`](https://explorer.tari.mw/tx/985ef2beb38f620257f76856c2692125c12e0507b8b800a59bcab2bb21989c2a) | sealed | Carol | 1.31 tTARI | "Meet at the old well. Midnight." |
| 7 | [`c180599784…e2d5ef`](https://explorer.tari.mw/tx/c1805997848547b24d78cc98e6934ef78bbb83fc5f26d81337b407f6d0e2d5ef) | sealed | Bob | 0.031 tTARI | "Trick or treat" |
| 8 | [`ad5095f9ac…632d78`](https://explorer.tari.mw/tx/ad5095f9ac6f965e939d836640ff1d907fd5923590ddc8f49e62279796632d78) | sealed | Carol | 0.5 tTARI | "Boo!" |
| 9 | [`6fa5e86b97…35468e`](https://explorer.tari.mw/tx/6fa5e86b9796f50178bb9de6e2125670b5c1cf3756b0a4f5d9695d931935468e) | sealed | Bob | 2 tTARI | "Seven candles, one wish." |
| 10 | [`2bbd023b7f…f3f319`](https://explorer.tari.mw/tx/2bbd023b7f27a528e0347ceae4f225c690a24c6cd69d9d6387789b78d2f3f319) | sealed | Carol | 0.013 tTARI | "Mind the third stair." |
| 11 | [`32090261a1…2fcb23`](https://explorer.tari.mw/tx/32090261a197b2f99e4b0a86a6df3b277a5dc4f273576ddf1190509f782fcb23) | sealed | Bob | 0.1 tTARI | none |
| 12 | [`092e8a9587…55473f`](https://explorer.tari.mw/tx/092e8a95877a5882d5f8d3c984dd13ded415ea42080fce1d398a80b2ea55473f) | sealed | Carol | 0.99 tTARI | "Pumpkin pie fund." |
| 13 | [`8ebbfc9c06…1aaab6`](https://explorer.tari.mw/tx/8ebbfc9c06713ebce4edb5bfc2ce6b561cbb90025ddba7eb5e80b843c71aaab6) | sealed | Bob | 0.404 tTARI | "Page not found. Neither is the ghost." |
| 14 | [`c3a126b2c9…39c0e2`](https://explorer.tari.mw/tx/c3a126b2c9177316e3233328394146bbb5920e32e2495776bea2c2fa8a39c0e2) | sealed | Carol | 0.7 tTARI | "Garlic, salt, and a very long walk home." |
| 15 | [`ec71ff7a36…c16031`](https://explorer.tari.mw/tx/ec71ff7a36f591b7982c6874706895dabd87358ca4b9133cad833229c4c16031) | amount revealed | Bob | 0.25 tTARI | none |

## The demo keys

These are the view secrets of the demo identities and of the demo token's audit key. They are published on purpose, for testnet only. Bob's and Carol's read the demo payments made to them (in TARI and in SEANCE) and nothing else. Eve's reads nothing at all. The audit key counts the amounts of the SEANCE demo payments and nothing else. A view key cannot spend. **Never reuse these keys for anything real.**

| Who | View secret |
|---|---|
| Bob (the recipient) | `cd094efe16ad55a188f3f8551dd21a71a2ad0ada03e0760f4fd312ce534c1203` |
| Carol (another recipient) | `68f76ca93c0ffa48eacca00f04b4f8948b6f4661894cb7c74f0d309af1bc4308` |
| Eve (a stranger: a key that fits nothing here) | `b2c2d4cb4841c1ab2d57d712bd28d1cb84aedad00fc14e55e144d55831cea709` |
| The auditor (holds the demo token's audit key) | `713ead2c3c9ee52431b4826898b70874751b27a6780c8428d5f3e4688a89fe06` |

## What the page asks the network

- `GET /transactions/<id>` on the indexer, for the id you give. `GET /transactions/recent?limit=40` when you press Summon. It never scans the chain.
- Nothing else. The leaks panel, the Auditor and the Poltergeist compute in the page from a transaction it already holds (the Poltergeist from the recorded set). The built page carries a Content Security Policy in a meta tag; `connect-src` allows only the indexer host, and the smoke test shows the browser blocking a fetch to anywhere else, `eval` and injected scripts.
- No external fonts, CDNs, analytics or trackers. No cookies, local storage or session storage.
- The explorer and docs links open in a new tab. The page does not call them.
- The address can carry `#tx=<id>`, which is public. A key you paste is never in it.

Design decisions are in [design.md](design.md).

## Reused code

The contest asks for new code. Everything here was written for this contest after 2026-10-01. Two files come from our own experiment of 2026-10-16 to 2026-10-18, the spike that checked the SDK before this build:

- `scripts/wd.mjs`: the walletd JSON-RPC helper, copied unchanged from the spike (`seance/scripts/wd.mjs`) apart from a header comment. Only the maintainer scripts `scripts/make-demo.mjs` and `scripts/make-hero.mjs` use it.
- `scripts/make-demo.mjs`: written for this repo; its way of building and polling a stealth transfer through walletd follows the spike's `gate-c.mjs` (a few lines are the same). `scripts/make-hero.mjs` is new and follows the same pattern.

`template/` is new code written for this contest, from the public `tari_template_lib` API. No code was copied from tari-project example repositories, from other published templates or from other contest entries. The Tari packages below are used as dependencies, not copied.

## Built with

`@tari-project/ootle`, `@tari-project/ootle-indexer`, `@tari-project/ootle-wasm` (the official SDK: indexer client, the view-key decryption and the audit-proof check, in WebAssembly), Vite, TypeScript, vitest, puppeteer-core and axe-core for the checks. The demo token's template is Rust on `tari_template_lib`, compiled to WebAssembly and published on Esmeralda; the page does not need it to run. Third-party licence notices ship in `dist/THIRD-PARTY-LICENSES.md`.

This is not a wallet or an explorer. The parsing of transactions, the four ghosts, the recorded mode and the page are new.

Developed with an AI coding agent (Claude Code).

## Licence

MIT. See [LICENSE](LICENSE).
