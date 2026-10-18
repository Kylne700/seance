// Single source of truth: the app, the build (CSP) and the scripts all read these.
export const INDEXER_URL = 'https://ootle-indexer-a.tari.com'
export const EXPLORER_URL = 'https://explorer.tari.mw'
// How long one indexer call may take before the page treats the indexer as down and falls back to recorded data.
export const INDEXER_TIMEOUT_MS = 8000
// How many of the latest transactions the "summon" button looks at. One request, never a scan of the chain.
export const RECENT_LIMIT = 40
// Verified in headless Chromium: this page renders "Transaction <id> ... Commit" for a real id.
export const explorerTx = (id: string): string => `${EXPLORER_URL}/tx/${id}`
// The demo token (made by template/, with an audit key). scripts/make-hero.mjs records the same address in ledger.json, and a test keeps the two equal.
export const SEANCE_RESOURCE = 'resource_3308e69cbcd47df3fa3e0b2467e50e9ec7502c955822574c3e03c045f37ee2a8'
