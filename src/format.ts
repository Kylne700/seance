// 1 tTARI = 1,000,000 uT (micro). Amounts come off the chain as integers.
export function tari(uT: bigint | number | string): string {
  const v = BigInt(uT)
  const whole = v / 1_000_000n
  const frac = (v % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '')
  return `${whole}${frac ? '.' + frac : ''} tTARI`
}

/** First and last characters of a long hex string, for tight places. */
export const short = (h: string, n = 8): string => (h.length <= 2 * n + 1 ? h : `${h.slice(0, n)}…${h.slice(-n)}`)

/** A transaction without a summary was rejected before it ran, or is not finalized yet. */
export const outcomeLabel = (v: { outcome: string | null; rejectedReason: string | null }): string => v.outcome ?? (v.rejectedReason ? 'Rejected' : 'Not finalized yet')
