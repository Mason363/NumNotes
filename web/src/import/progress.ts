import type { ProgressCallback } from './types'

/**
 * Maps a child task's [0, 1] progress onto the [from, to] slice of `parent`.
 * `prefix`, when given, is prepended to the child's labels.
 */
export function subProgress(
  parent: ProgressCallback | undefined,
  from: number,
  to: number,
  prefix?: string,
): ProgressCallback | undefined {
  if (!parent) return undefined
  return (fraction, label) => {
    const clamped = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0))
    parent(from + (to - from) * clamped, prefix ? `${prefix}: ${label}` : label)
  }
}
