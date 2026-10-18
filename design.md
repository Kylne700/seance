# Design decisions

Why the page looks and behaves the way it does, so a reviewer can disagree with a reason rather than a guess. Stage 1 only: the Poltergeist, the full "what still leaks" panel and the result card are not designed here.

## The story

A private payment on Tari is a letter sealed in plain sight. Everyone can pass the envelope around, and only one key opens it. The page makes that literal with three ghosts looking at the same real transaction:

- The **Stranger** has no key. It shows what an indexer shows anyone.
- The **Medium** holds a view key and listens inside the page.
- The **Auditor** is the third ghost (a narrower key). Not built in stage 1, so its card is dashed, labelled "Coming next", and says so in one sentence instead of pretending.

The theme asks for the best demonstration of Tari's privacy. A demonstration beats a claim: the page never says "this is private", it lets you hold the sealed bytes and try keys on them.

## Show the real bytes, then say what they are

Every field of a sealed note is the real value from the chain, in monospace, with one plain sentence under it: the commitment ("a sealed number that locks the amount"), the one-time key, the locked message with its byte length, the spend rule. The length is shown on purpose: a note without a memo is 80 bytes and one with a memo is longer, which is a small leak anyone can see. The fee paid out in the open is labelled as such. Nothing on the Stranger card is a mock-up. The same code renders a live answer and a recorded one, and the smoke test checks that the Stranger card never contains the amount or the memo.

## Silence is the answer to a wrong key

A key that fits nothing gets one calm line, "The spirits are quiet.", with no error colour and no "invalid key". Decryption cannot tell a wrong key from a note meant for someone else, so the page does not pretend to. A pasted string that is not 64 hexadecimal characters is different: that is a typing error, not a guess at a real key, so it gets a hint.

## Layout

- One page, one column on phones. From 960 px wide the three cards sit side by side and the picker is two columns (an id and Summon on the left, the prepared demos on the right).
- At 1280x800 the hero and picker fill the first screen and the cards begin at its foot, so after a call the page scrolls the Stranger card to the top if it is more than half-way down the screen. In one column it always does. On an error it scrolls the message into view. The smoke test caught the first version hiding its own result below the fold.
- No card is sticky. Stage 1 pinned the Medium card, but once the Auditor card and the audit-proof blocks made the cards taller than a 1280x800 screen, the pinned card was cut off at the bottom and could not be scrolled to. Measured at 1280x800: the cards are 2425, 965 and 991 px tall.
- Sealed notes are `<details>`: open by default only from 960 px wide. On a 390x800 phone the Stranger card is 1361 px tall with the notes shut and 2954 px with every note and ciphertext open.
- 44 px tap targets, no horizontal scroll, long hex wraps inside its box. Text fields scroll their own content, so a 64-character id in a narrow field is not treated as clipped.

## Mood

Dark and calm, not loud. Near-black violet ground with a faint glow at the top, amber for the candle (primary buttons, amounts, the flame), pale violet for labels, mint for "live" and rose for errors. Headings use the system serif stack, body text the system sans, bytes the system monospace. No web fonts, no images except three small inline SVG ghosts. Nothing is fetched to draw the page.

Colour is checked by numbers, not by eye. Every text and background pair in the palette reaches 4.5:1 (the lowest is 6.5:1). Text on the bare page sits over a radial gradient that axe cannot judge ("needs review"), so it is bounded by the gradient's lightest colour instead. The borders of fields, selects, outline buttons and key choices use a lighter violet (`--control`) that reaches 3:1 on every surface. The focus ring is a 3 px light amber outline offset by 3 px on every interactive element.

## Motion

The ghost's flame flickers and a reading fades in over 0.9 s, blurred to sharp, like a voice coming through. With `prefers-reduced-motion` all animation and transition is off and scrolling is instant.

## Keyboard and screen readers

A skip link, real labels on every field, native `<details>`, `<select>` and radio buttons (arrow keys move between keys). Polite live regions report results and errors (the status line), the Medium's reading and the hint on the key field. While a call runs the Stranger body says `aria-busy` and the buttons are `aria-disabled`, not `disabled`, so keyboard focus never falls off the button that was pressed. The recorded-data switch is a toggle button with `aria-pressed`; its label does not change. External links say they open in a new tab. The smoke test tabs through the whole page at both widths and checks every stop is visible, outlined and in the expected order.

## Where answers come from

The page asks the indexer for one transaction by id, or for the 40 latest when you press Summon. It never scans the chain. The recorded set (`ledger.json`) is imported as a module, so it needs no request.

- Network error, no answer in 8 s (the SDK has no timeout of its own, so the page races it against a timer), a 5xx or a 429: the page switches to recorded data for good, says so, labels every answer "Recorded", and the switch back to live is one click.
- A 404 for an id that is not one of ours is "the indexer does not know this id", not a fallback. A 404 for an id we hold a recording of means the testnet was reset, so that one falls back.
- A recorded-mode lookup of an id we do not hold says so and points at live mode.
- A quiet live chain (no private transfer among the latest 40) gives a recorded sample, labelled, and the page stays live. Summon prefers a settled transaction to a rejected one.
- A pasted id is trimmed and lower-cased. A malformed one is refused before any request.

## Privacy of the key

A key you paste is read from the field, used for a local decryption call, and forgotten on reload. It is never stored, never in the address or the history, never sent. Defences, none of which is the main one:

- the CSP: `connect-src` allows only the indexer host, `form-action 'none'`, `default-src 'none'`;
- the field is `type=text` on purpose (a view key cannot spend, and seeing what you pasted catches mistakes) with spell-check, auto-complete, auto-correct and password-manager hooks off, so a browser service has nothing to send;
- the smoke test pastes keys and then looks for them in every request (address, headers, body), the address, storage, cookies, history state and the page text.

## Content Security Policy and the wasm

`default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self'; connect-src https://ootle-indexer-a.tari.com; base-uri 'none'; form-action 'none'`, set in a meta tag in the production build (the dev server's reload socket would be blocked by it). There are no inline scripts or styles, so `unsafe-inline` is not needed. `wasm-unsafe-eval` is the narrowest source that lets the browser compile WebAssembly; plain `unsafe-eval` stays off and the smoke test checks that `eval` is refused.

The decryptor ships as WebAssembly. The usual bundler route fetches the `.wasm` file at run time, which would force `'self'` into `connect-src`. A small Vite plugin embeds the bytes in the JavaScript instead. The cost is one chunk of 1.88 MB (717 kB gzipped), nearly all of it the decryptor, which the page cannot work without, so splitting it would save nothing. The chunk size warning limit is raised on purpose.

## Testing approach

`ledger.json` is both the offline data and the oracle: each demo transaction records the indexer's answer and what each key must hear. Unit tests decrypt every demo with every key and compare. The smoke test then drives the production build the way a judge would (summon, paste, hold the seance, wrong key, own key) live and in recorded mode, where every outside host is made unresolvable, so any request the page tried to make would show up as a failure.

## Left for later

- The Auditor lens, the Poltergeist (changing what a sender can do so less leaks) and the full "what still leaks" panel. The page already labels the fee bucket as paid in the open; the panel would say what else is visible (sizes, timing, the fee payer's key).
- A result card to share and its preview image.
- Splitting the chunk if the decryptor ever becomes optional.
