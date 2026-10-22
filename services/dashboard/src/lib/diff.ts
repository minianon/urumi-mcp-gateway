export type DiffOp = { type: 'same' | 'add' | 'del'; text: string }

/** Minimal LCS diff over tokens. Inputs here are small (tool descriptions / schemas). */
export function diffTokens(a: string[], b: string[]): DiffOp[] {
  const n = a.length
  const m = b.length
  // Guard against pathological sizes: fall back to "everything changed".
  if (n * m > 400_000) {
    return [
      ...a.map((text) => ({ type: 'del' as const, text })),
      ...b.map((text) => ({ type: 'add' as const, text })),
    ]
  }
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    const row = dp[i]!
    const next = dp[i + 1]!
    for (let j = m - 1; j >= 0; j--) {
      row[j] = a[i] === b[j] ? next[j + 1]! + 1 : Math.max(next[j]!, row[j + 1]!)
    }
  }
  const out: DiffOp[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', text: a[i]! })
      i++
      j++
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ type: 'del', text: a[i++]! })
    } else {
      out.push({ type: 'add', text: b[j++]! })
    }
  }
  while (i < n) out.push({ type: 'del', text: a[i++]! })
  while (j < m) out.push({ type: 'add', text: b[j++]! })
  return out
}

export const diffLines = (a: string, b: string) => diffTokens(a.split('\n'), b.split('\n'))
export const diffWords = (a: string, b: string) => diffTokens(a.split(/(\s+)/), b.split(/(\s+)/))
