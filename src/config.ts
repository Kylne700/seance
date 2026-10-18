// Single source of truth: the app, the build (CSP) and the scripts all read these.
export const INDEXER_URL = 'https://ootle-indexer-a.tari.com'
export const EXPLORER_URL = 'https://explorer.tari.mw'
// How long one indexer call may take before the page treats the indexer as down and falls back to recorded data.
export const INDEXER_TIMEOUT_MS = 8000
